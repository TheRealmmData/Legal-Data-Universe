/**
 * Question-driven investigative leads (Controlling Owner
 * Vision): the attorney's OWN question interrogates metadata,
 * text, and patterns. Different questions MUST produce
 * different leads — persons, topic terms, and intents
 * (late-night, sentiment, who-knew-when, external) are parsed
 * from the question, then computed against the active corpus.
 * Deterministic; every lead carries IDs, verbatim quotes, a
 * benign alternative, and limitations. Leads are NOT findings.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { EvidenceRecord } from '../evidence/types.ts';
import { sentenceWith } from './reasoning.ts';
import type { QuoteCitation } from './types.ts';

export interface InvestigativeLead {
  title: string;
  why: string[];
  recordIds: string[];
  totalInSet: number;
  citations: QuoteCitation[];
  benignAlternative: string;
  limitations: string[];
  draftQuestion: string;
}
export interface InvestigationLeads {
  parsed: { persons: string[]; terms: string[]; intents: string[] };
  leads: InvestigativeLead[];
  scope: string;
}

const STOP = new Set(['what', 'when', 'where', 'which', 'about', 'there', 'their', 'them', 'they', 'this', 'that', 'with', 'from', 'have', 'were', 'was', 'did', 'does', 'any', 'are', 'the', 'and', 'for', 'who', 'how', 'many', 'much', 'show', 'find', 'list', 'tell', 'give', 'please', 'email', 'emails', 'emailing', 'documents', 'records', 'communications', 'discuss', 'discusses', 'discussed', 'talking', 'talk', 'sent', 'send', 'people', 'person', 'knew', 'know', 'knows', 'first', 'late', 'night']);
const EXCITEMENT = ['great', 'excellent', 'excited', 'fantastic', 'love', 'awesome', 'thrilled'];
const DEFENSIVE = ['denied', 'deny', 'not my', 'unfair', 'declined', 'refuse', 'complaint', 'frustrated', 'angry', 'badly', 'terrible', 'hate', 'worst', 'resigning', 'resignation'];

function recordsOf(store: EvidenceStore): EvidenceRecord[] {
  return store.allIds().map((id) => store.getRecord(id)).filter((r) => r != null);
}
function hourOf(r: EvidenceRecord): number | undefined {
  const t = r.loadFile?.sec?.timeSent || r.loadFile?.sec?.timeCreated;
  const m = t ? /(\d{1,2}):\d{2}\s*(AM|PM)/i.exec(t) : null;
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[2])) h += 12;
  return h;
}

export function investigateQuestion(store: EvidenceStore, question: string): InvestigationLeads {
  const q = question.toLowerCase();
  const records = recordsOf(store);
  const personIds = [...new Set(records.flatMap((r) => r.personIds))];
  const persons = personIds.filter((pid) => {
    const name = store.personName(pid).toLowerCase();
    return name && name.split(' ').some((p) => p.length > 2 && q.includes(p));
  });
  const personNames = new Set(persons.flatMap((p) => store.personName(p).toLowerCase().split(' ')));
  const terms = [...new Set(q.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/))]
    .filter((w) => w.length > 3 && !STOP.has(w) && !personNames.has(w))
    .slice(0, 4);
  const intents: string[] = [];
  if (/late.?night|after hours|midnight|2 ?am|overnight/.test(q)) intents.push('late-night');
  if (/sentiment|excit|defensiv|badly|unhappy|angry|tone|feel/.test(q)) intents.push('sentiment');
  if (/who knew|when did|first (know|learn|hear)|timeline/.test(q)) intents.push('who-knew-when');
  if (/external|outside|competitor|personal/.test(q)) intents.push('external');
  if (/steal|stole|theft|misappropriat|exfiltrat/.test(q)) intents.push('misappropriation');

  const byPerson = (set: EvidenceRecord[]) => persons.length
    ? set.filter((r) => r.personIds.some((p) => persons.includes(p)))
    : set;
  const leads: InvestigativeLead[] = [];
  const cite = (set: EvidenceRecord[], needles: string[]) =>
    set.slice(0, 3).map((r) => sentenceWith(store, r.id, needles)).filter((c) => c != null);

  // Lead A: question's topic evidence (person-scoped when named).
  if (terms.length || persons.length) {
    let set = records;
    if (terms.length) {
      const ids = new Set<string>();
      for (const t of terms) for (const h of store.searchWithCount(t, 100000).hits) ids.add(h.recordId);
      set = set.filter((r) => ids.has(r.id));
    }
    set = byPerson(set);
    if (set.length) {
      leads.push({
        title: `${persons.map((p) => store.personName(p)).join(', ') || 'Collection'} — ${terms.join(' / ') || 'activity'} evidence (${set.length})`,
        why: [
          `${set.length} record(s) match your question's ${persons.length ? 'person + ' : ''}topic terms (${terms.join(', ') || 'person activity'}) across all ${records.length}.`,
          `Date span ${set.map((r) => r.date).sort()[0]?.slice(0, 10)} → ${set.map((r) => r.date).sort()[set.length - 1]?.slice(0, 10)}.`,
        ],
        recordIds: set.slice(0, 25).map((r) => r.id), totalInSet: set.length,
        citations: cite(set, terms.length ? terms : ['the']),
        benignAlternative: 'Volume on a work topic is expected for active custodians; relevance needs content review.',
        limitations: ['Keyword/topic matching only; no semantic inference.'],
        draftQuestion: `What do these ${set.length} records establish about: ${question}`,
      });
    }
  }
  // Lead B: intent-specific pattern.
  if (intents.includes('late-night') || intents.includes('external') || intents.includes('misappropriation')) {
    const late = records.filter((r) => { const h = hourOf(r); return h != null && (h >= 22 || h <= 5); });
    const set = byPerson(late);
    leads.push({
      title: `Off-hours activity pattern (${set.length} of ${late.length} late-night records${persons.length ? ' for named person(s)' : ''})`,
      why: [`SEC TIME_SENT/TIME_CREATED between 22:00–05:59 on ${set.length} record(s).`, 'Off-hours bulk activity is a classic collection-review prompt, not proof of intent.'],
      recordIds: set.slice(0, 25).map((r) => r.id), totalInSet: set.length,
      citations: cite(set, terms.length ? terms : ['the']),
      benignAlternative: 'Deadlines, time zones, and on-call work routinely produce late-night records.',
      limitations: ['Synthetic times are generated metadata; pattern is a review prompt only.'],
      draftQuestion: `Assess the off-hours records in context of: ${question}`,
    });
  } else if (intents.includes('sentiment')) {
    const words = [...EXCITEMENT, ...DEFENSIVE];
    const set = byPerson(records.filter((r) => words.some((w) => r.body.toLowerCase().includes(w))));
    leads.push({
      title: `Tone-bearing communications (${set.length})`,
      why: [`Lexical tone screen (${words.length} terms) matched ${set.length} record(s)${persons.length ? ' for named person(s)' : ''}.`, 'Word presence is a screen, not a sentiment finding — read in context.'],
      recordIds: set.slice(0, 25).map((r) => r.id), totalInSet: set.length,
      citations: cite(set, words),
      benignAlternative: 'Words like "great" or "denied" are routine in business and HR records.',
      limitations: ['No trained sentiment model; lexical screen only.'],
      draftQuestion: `What do the tone-bearing records actually show about: ${question}`,
    });
  } else if (intents.includes('who-knew-when') && terms.length) {
    const ids = new Set<string>();
    for (const t of terms) for (const h of store.searchWithCount(t, 100000).hits) ids.add(h.recordId);
    const set = records.filter((r) => ids.has(r.id)).sort((a, b) => a.date.localeCompare(b.date));
    const firstBy = new Map<string, EvidenceRecord>();
    for (const r of set) for (const p of r.personIds) if (!firstBy.has(p)) firstBy.set(p, r);
    leads.push({
      title: `Who-knew-when: first "${terms[0]}" appearances (${firstBy.size} people)`,
      why: [...firstBy.entries()].slice(0, 5).map(([p, r]) => `${store.personName(p)} first appears ${r.date.slice(0, 10)} (${r.id})`),
      recordIds: [...firstBy.values()].slice(0, 25).map((r) => r.id), totalInSet: set.length,
      citations: cite([...firstBy.values()], terms),
      benignAlternative: 'Earliest surviving record ≠ first knowledge; collection completeness bounds this.',
      limitations: ['Dates rely on stored metadata; suspect dates would be flagged in Chronology.'],
      draftQuestion: `Reconstruct who knew what, and when, about: ${question}`,
    });
  }
  // Lead C: counterevidence / authorization check (always).
  {
    const approvals = byPerson(records.filter((r) => /approv|authoriz|permission|permitted/i.test(r.body))
      .filter((r) => !terms.length || terms.some((t) => r.body.toLowerCase().includes(t) || r.title.toLowerCase().includes(t))));
    leads.push({
      title: `Counterevidence check: approvals & authorizations (${approvals.length})`,
      why: ['Before suspecting transfer or misuse, test the authorized explanation on the same evidence base.', `${approvals.length} approval-bearing record(s) intersect your question.`],
      recordIds: approvals.slice(0, 25).map((r) => r.id), totalInSet: approvals.length,
      citations: cite(approvals, ['approv', 'authoriz']),
      benignAlternative: 'This IS the benign-explanation lead: approved conduct must be separated from unapproved conduct by scope and date.',
      limitations: ['An approval covers only its stated scope; compare dates, devices, and data classes.'],
      draftQuestion: `Which parts of the activity in "${question}" were authorized, and which were not?`,
    });
  }
  return {
    parsed: { persons: persons.map((p) => store.personName(p)), terms, intents },
    leads: leads.slice(0, 3),
    scope: `all ${records.length} records (deterministic, question-parsed)`,
  };
}
