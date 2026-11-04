/**
 * Fireworks Evidence Reasoner (real integration, owner-
 * directed): receives a BOUNDED evidence packet (IDs, SEC
 * metadata, verbatim excerpts, theory) and returns a
 * structured adversarial assessment. It may cite ONLY packet
 * records; every quote is re-verified verbatim client-side
 * and dropped if unverifiable. Fallback: deterministic
 * reasoning stands alone — failure is reported, never faked.
 * Provider/model (verified live 2026-10-31):
 * fireworks / accounts/fireworks/models/muse-spark-open.
 */
import type { EvidenceStore } from '../evidence/store.ts';

export interface ReasonerAssessment {
  provider: string;
  model: string;
  supporting: { recordId: string; quote: string; note: string }[];
  counterevidence: { recordId: string; quote: string; note: string }[];
  benignAlternatives: string[];
  missingProof: string[];
  followUps: string[];
  droppedUnverified: number;
}

export async function fireworksAssess(
  store: EvidenceStore,
  theory: string,
  packetIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ReasonerAssessment> {
  const packet = packetIds.slice(0, 12).map((id) => {
    const r = store.getRecord(id);
    return r ? `[${r.id}] ${r.date.slice(0, 10)} ${r.loadFile?.sec?.custodian ?? r.custodianId} "${r.title}"\n${r.body.slice(0, 600)}` : '';
  }).filter(Boolean).join('\n---\n');
  const res = await fetchImpl('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'fireworks',
      role: 'primary',
      messages: [
        {
          role: 'system',
          content: 'You are an evidence reasoner for eDiscovery. Use ONLY the packet records. Reply ONLY JSON: {"supporting":[{"recordId":"...","quote":"VERBATIM substring","note":"..."}],"counterevidence":[...same...],"benignAlternatives":["..."],"missingProof":["..."],"followUps":["..."]}. Never invent IDs or quotes. Distinguish suspicion from proof.',
        },
        { role: 'user', content: `THEORY: ${theory}\n\nPACKET:\n${packet}` },
      ],
    }),
  });
  const data = (await res.json()) as { provider?: string; model?: string; text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(`Fireworks reasoner failed: ${data.error ?? res.status}`);
  const parsed = JSON.parse(String(data.text ?? '{}').replace(/^```json\s*|```$/gm, '')) as Partial<ReasonerAssessment>;
  let dropped = 0;
  const verify = (items: ReasonerAssessment['supporting'] | undefined) => (items ?? []).filter((it) => {
    const r = store.getRecord(it.recordId);
    const ok = !!r && packetIds.includes(it.recordId) && r.body.includes(it.quote);
    if (!ok) dropped += 1;
    return ok;
  });
  return {
    provider: data.provider ?? 'fireworks',
    model: data.model ?? 'accounts/fireworks/models/muse-spark-open',
    supporting: verify(parsed.supporting),
    counterevidence: verify(parsed.counterevidence),
    benignAlternatives: parsed.benignAlternatives ?? [],
    missingProof: parsed.missingProof ?? [],
    followUps: parsed.followUps ?? [],
    droppedUnverified: dropped,
  };
}
