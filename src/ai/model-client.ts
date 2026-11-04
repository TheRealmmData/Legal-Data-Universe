/**
 * Live model planner/synthesizer (M4). Talks ONLY to the same-origin
 * /api/chat dev proxy; the proxy holds credentials server-side and
 * routes to the configured provider (Meta Model API or Baseten).
 * The actor names below carry the responding provider+model into
 * the runner audit trail, so a stub/offline run can never be
 * mistaken for a live model run.
 */
import type {
  FindingDraft,
  InvestigationPlan,
  ToolCall,
  ToolName,
} from './contracts.ts';
import type { Planner, SynthesisRecord, Synthesizer } from './runner.ts';
import type { ToolResult } from './contracts.ts';

const ALLOWED_TOOLS: ToolName[] = [
  'search_records',
  'get_record',
  'compare_timeline',
  'trace_relationships',
  'collection_analytics',
];

interface ChatResponse {
  provider: string;
  model: string;
  text: string;
  usage?: unknown;
  error?: string;
}

let currentAbort: AbortController | undefined;

/** Abort any in-flight model request (Stop AI). Safe to call anytime. */
export function abortCurrentChat(): void {
  currentAbort?.abort();
}

const NETWORK_HINT =
  'could not reach the inference proxy (/api/chat) - network failure, not a provider answer. ' +
  'Check: dev server running on the PC, headset on the same Wi-Fi, page reloaded after server restart.';

async function chat(
  messages: { role: string; content: string }[],
  role: 'primary' | 'comparator' = 'primary',
): Promise<ChatResponse> {
  // A hung provider must never wedge the investigation: every call
  // times out (60s) and is abortable via Stop AI. Without this, one
  // stalled fetch left the agent "busy" forever and no follow-up
  // question could start (owner-found defect, 2026-10-27).
  // One retry on network-level failure covers transient PC
  // sleep/wake and Wi-Fi roams (owner incident, 2026-10-29: bare
  // "Failed to fetch" with a misleading key hint; the proxy log
  // showed the request never arrived).
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
    const controller = new AbortController();
    currentAbort = controller;
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, messages }),
        signal: controller.signal,
      });
      // Transient provider 5xx (headset-observed Baseten HTTP 504
      // timeout on first Ask, clean success right after): one
      // automatic retry inside the same attempt loop.
      if (!response.ok && response.status >= 500 && attempt === 0) {
        response = undefined;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('model request stopped (Stop AI or 60s timeout) - no conclusion drawn');
      }
      lastError = error;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    } finally {
      clearTimeout(timer);
      if (currentAbort === controller) currentAbort = undefined;
    }
  }
  if (!response) {
    throw new Error(
      `${lastError instanceof Error ? lastError.message : String(lastError)} - ${NETWORK_HINT}`,
    );
  }
  const data = (await response.json()) as ChatResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error || `inference proxy HTTP ${response.status}`);
  }
  return data;
}

export async function inferenceHealth(): Promise<{
  activeProvider: string;
  configured: { meta: boolean; baseten: boolean };
  models: { meta: { primary: string }; baseten: { primary: string } };
}> {
  let response: Response;
  try {
    response = await fetch('/api/health');
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      response = await fetch('/api/health');
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} - ${NETWORK_HINT}`,
      );
    }
  }
  if (!response.ok) throw new Error(`inference health HTTP ${response.status}`);
  return response.json();
}

export function parseModelJson(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model did not return JSON');
  return JSON.parse(fenced.slice(start, end + 1));
}

export const PLANNER_SYSTEM = `TASK:PLAN
You plan a bounded, source-grounded evidence investigation. Reply with ONLY JSON:
{"steps":[{"tool":"search_records","args":{"term":"..."},"reason":"..."}]}
Allowed tools and args:
- search_records {term} - LITERAL substring search over titles, bodies, and
  metadata (names, record IDs, dates). CRITICAL: the term must be ONE
  distinctive word or a short phrase copied from the question or a known
  record. Invented phrases (e.g. "Atlas revised March") match NOTHING.
  Prefer single names/keywords: "March", "Priya", "invoice".
- get_record {recordId} - fetch one record
- compare_timeline {recordIds:[...]} - stored-date order + date confidence
- trace_relationships {recordId} - records sharing people/family/reply links;
  use this AFTER a search finds a seed record, for relationship questions
  (who connects to whom, cross-organization links).
- collection_analytics {personId?} - EXACT collection aggregates computed
  from metadata: totals, counts by kind/custodian/organization, date range,
  and (with personId like "p-priya") that person's counterparties with
  sent/received counts. Use FIRST for any counting/ranking question
  (how many emails, biggest custodian, who did X communicate with).
  Person IDs look like p-priya, p-mara, p-vic.
Rules: 3 to 5 steps maximum. At least one step must actively seek evidence
that points the OTHER way. Name record IDs only if given in the question
or context; otherwise search first. No prose outside the JSON.`;

export const SYNTH_SYSTEM = `TASK:SYNTHESIZE
Answer the QUESTION ACTUALLY ASKED using supplied records and computed
tool facts. Reply with ONLY JSON:
{"findings":[{"claim":"...","groundedBy":"quote","citations":[{"recordId":"fx-001","quote":"exact words"}]}]}
Two grounding kinds:
- "quote" (default): document findings. Every quote VERBATIM from that
  record's title/body (machine-checked; paraphrase rejected), under 25 words.
- "metadata": collection-level answers (counts, rankings, counterparties).
  State ONLY numbers copied exactly from Computed tool facts; cite example
  record IDs from the facts in "citations" with a verbatim quote from one
  of them. Numbers not in the facts are machine-rejected. If facts say a
  count is NOT determinable, say exactly that — never estimate.
Rules: at most 2 findings; answer the asked question first (do not return
unrelated findings just because they are quotable). Cite only supplied
record IDs. If nothing supports an answer, return {"findings":[]}. No
legal conclusions. No prose outside the JSON.`;

export class ModelPlanner implements Planner {
  name = 'model-planner (unresolved provider)';
  private role: 'primary' | 'comparator';
  constructor(role: 'primary' | 'comparator' = 'primary') {
    this.role = role;
  }

  async plan(objective: string): Promise<InvestigationPlan> {
    const reply = await chat(
      [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: `Objective: ${objective}` },
      ],
      this.role,
    );
    this.name = `model-planner [${reply.provider}:${reply.model}]`;
    const parsed = parseModelJson(reply.text) as { steps?: ToolCall[] };
    const steps = (parsed.steps ?? [])
      .filter((s) => ALLOWED_TOOLS.includes(s.tool) && s.args && typeof s.args === 'object')
      .slice(0, 5)
      .map((s) => ({ tool: s.tool, args: s.args, reason: String(s.reason ?? '') }));
    if (steps.length === 0) throw new Error('planner returned no allow-listed steps');
    return { objective, steps };
  }
}

/**
 * Bounded synthesis prompt. The proxy caps each message at
 * 20,000 chars, while five 25-record tool steps can retrieve far
 * more text than that. Records explicitly named in the objective
 * (sequenced-lead focus sets) go first; whole records are included
 * only when they fit, so a quotation is never silently truncated.
 */
export function buildSynthesisPrompt(input: {
  objective: string;
  results: ToolResult[];
  records: SynthesisRecord[];
}, maxChars = 18500): string {
  const mentioned = new Set(input.objective.match(/\b[a-z]{1,4}-\d{2,}\b/g) ?? []);
  const ordered = [...input.records].sort((a, b) =>
    Number(mentioned.has(b.id)) - Number(mentioned.has(a.id)));
  const header = `Objective: ${input.objective}\n\nComputed tool facts (deterministic; copy any numbers EXACTLY, never recount or estimate):\n`;
  let facts = '';
  let omittedFacts = 0;
  for (const line of input.results.flatMap((r) => r.facts.map((f) => `[${r.tool}] ${f}`))) {
    const next = facts ? `${facts}\n${line}` : line;
    if (next.length > 3500) { omittedFacts += 1; continue; }
    facts = next;
  }
  if (omittedFacts) facts += `\n[${omittedFacts} tool fact line(s) omitted for prompt budget; retrieved record text below is the citation source.]`;
  let prompt = `${header}${facts}\n\nRecords retrieved by the tools:\n`;
  let included = 0;
  for (const record of ordered) {
    const block = `${included ? '\n\n' : ''}[${record.id}] (${record.date}, ${record.dateConfidence}) ${record.title}\n${record.body}`;
    if (prompt.length + block.length > maxChars - 220) continue;
    prompt += block;
    included += 1;
  }
  const omitted = ordered.length - included;
  if (omitted > 0) {
    const note = `\n\n[${omitted} retrieved record(s) omitted for prompt budget. Cite only records shown above; if they do not support a finding, return {"findings":[]}.]`;
    if (prompt.length + note.length <= maxChars) prompt += note;
  }
  return prompt;
}

export class ModelSynthesizer implements Synthesizer {
  name = 'model-synthesizer (unresolved provider)';
  private role: 'primary' | 'comparator';
  constructor(role: 'primary' | 'comparator' = 'primary') {
    this.role = role;
  }

  async synthesize(input: {
    objective: string;
    results: ToolResult[];
    records: SynthesisRecord[];
  }): Promise<FindingDraft[]> {
    const reply = await chat(
      [
        { role: 'system', content: SYNTH_SYSTEM },
        { role: 'user', content: buildSynthesisPrompt(input) },
      ],
      this.role,
    );
    this.name = `model-synthesizer [${reply.provider}:${reply.model}]`;
    const parsed = parseModelJson(reply.text) as {
      findings?: {
        claim?: string;
        groundedBy?: string;
        citations?: { recordId?: string; quote?: string }[];
      }[];
    };
    return (parsed.findings ?? [])
      .filter((f) => typeof f.claim === 'string' && Array.isArray(f.citations))
      .map((f) => {
        const citations = (f.citations ?? [])
          .filter((c) => typeof c.recordId === 'string' && typeof c.quote === 'string')
          .map((c) => ({ recordId: c.recordId as string, quote: c.quote as string }));
        return {
          claim: f.claim as string,
          citationIds: [...new Set(citations.map((c) => c.recordId))],
          citations,
          status: 'draft' as const,
          groundedBy: f.groundedBy === 'metadata' ? ('metadata' as const) : ('quote' as const),
        };
      });
  }
}
