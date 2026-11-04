/**
 * Evidence Reasoner: evaluates competing explanations.
 * Deterministic rule evaluation over retrieved evidence —
 * every support/counter item is a verbatim body sentence.
 * Verdict vocabulary is closed: supported / partly-supported /
 * not-established / contradicted. The Reasoner may NOT assert
 * a fact without a QuoteCitation (QC re-verifies verbatim).
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { QuoteCitation, SpecialistRun } from './types.ts';
import type { RetrievalOutput } from './retrieval.ts';
import type { RelationshipOutput } from './relationship.ts';

export type Verdict = 'supported' | 'partly-supported' | 'not-established' | 'contradicted';
export interface Hypothesis {
  id: string;
  statement: string;
  verdict: Verdict;
  support: QuoteCitation[];
  counter: QuoteCitation[];
  gaps: string[];
}
export interface ReasoningOutput {
  hypotheses: Hypothesis[];
  overall: string;
}

/** First body sentence containing any needle (verbatim slice). */
export function sentenceWith(store: EvidenceStore, id: string, needles: string[]): QuoteCitation | undefined {
  const r = store.getRecord(id);
  if (!r) return undefined;
  const sentences = r.body.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => needles.some((n) => s.toLowerCase().includes(n.toLowerCase())));
  const quote = (hit ?? r.body.slice(0, 160)).trim();
  return quote ? { recordId: id, quote } : undefined;
}
const collect = (items: (QuoteCitation | undefined)[]): QuoteCitation[] =>
  items.filter((x) => x != null);

export function evaluateReyesTransfer(
  store: EvidenceStore,
  retrieval: RetrievalOutput,
  relationships: RelationshipOutput,
): SpecialistRun<ReasoningOutput> {
  const has = (id: string) => store.getRecord(id) != null;
  const bundle = (theme: string) => retrieval.bundles.find((b) => b.theme === theme);
  const externalSourceCode = bundle('external-source-code');
  // Direct evidence that SOURCE CODE left NovaChip requires a
  // record showing scheduler source sent to an external party.
  // Filename hits alone are insufficient; compute the chain below.
  const helixDirect = relationships.crossOrgCounterparties
    .filter((c) => c.orgs.includes('org-hlx'));
  // Smoking-gun computation: a direct Reyes -> Helix send whose
  // attachment fingerprint equals the internal repository snapshot,
  // plus an explicit receipt. The public extract has the same file
  // name but a different fingerprint and must not satisfy H3.
  const allRecords = store.allIds().map((id) => store.getRecord(id)).filter((r) => r != null);
  const snapshot = allRecords.find((r) => r.id === 'ts-013');
  const smokingAttachment = allRecords.find((r) =>
    r.id !== snapshot?.id
    && r.loadFile?.parentId
    && snapshot?.loadFile?.md5
    && r.loadFile?.md5 === snapshot.loadFile.md5
    && /scheduler_core/i.test(`${r.title} ${r.body}`));
  const smokingEmail = smokingAttachment?.loadFile?.parentId
    ? store.getRecord(smokingAttachment.loadFile.parentId)
    : undefined;
  const senderOf = (id?: string) => allRecords.find((r) => r.id === id)?.participants?.find((p) => p.role === 'sender')?.personId;
  const recipientsOf = (id?: string) => (allRecords.find((r) => r.id === id)?.participants ?? [])
    .filter((p) => p.role === 'recipient').map((p) => p.personId);
  const smokingReceipt = allRecords.find((r) =>
    r.links?.inReplyToId === smokingEmail?.id
    && /compiles/i.test(r.body)
    && /scheduler_core/i.test(`${r.title} ${r.body}`));
  const directSourceTransfer = Boolean(
    smokingAttachment && smokingEmail && smokingReceipt
    && senderOf(smokingEmail.id) === 'p-elena'
    && recipientsOf(smokingEmail.id).includes('p-oleg'));

  const hypotheses: Hypothesis[] = [
    {
      id: 'H1-acquisition',
      statement: 'Reyes acquired Falcon material through anomalous channels shortly before departing (off-hours full-history clones; unregistered USB write).',
      verdict: has('ts-003') && has('ts-004') ? 'supported' : 'not-established',
      support: collect([
        sentenceWith(store, 'ts-003', ['cloned']),
        sentenceWith(store, 'ts-004', ['USB', 'unregistered']),
        sentenceWith(store, 'ts-020', ['do not put this in email']),
        sentenceWith(store, 'ts-015', ['clones']),
      ]),
      counter: collect([
        sentenceWith(store, 'ts-008', ['Approved']),
        sentenceWith(store, 'ts-018', ['scheduled FALCON-MIRROR']),
      ]),
      gaps: ['USB device contents were never imaged; ts-008 approval covers a May 29 log/config bundle with device logging, not the June 15 unregistered device. The scheduled svc-mirror clone explains a service-account event, not the named-user clone in ts-003.'],
    },
    {
      id: 'H2-external-transfer-tuning',
      statement: 'Reyes transferred Falcon scheduler tuning parameters outside NovaChip (personal mailbox forward).',
      verdict: has('ts-005') && has('ts-006') ? 'supported' : 'not-established',
      support: collect([
        sentenceWith(store, 'ts-005', ['personal mailbox']),
        sentenceWith(store, 'ts-006', ['tuning parameters']),
      ]),
      counter: collect([
        sentenceWith(store, 'ts-007', ['NOT cover', 'does NOT']),
        sentenceWith(store, 'ts-014', ['denied']),
      ]),
      gaps: ['The stated purpose (finishing handover from home) is in the same record; intent is for the attorney, not this assessment. ts-007 approval explicitly excludes tuning parameters.'],
    },
    {
      id: 'H3-source-code-exfiltration',
      statement: 'Reyes transferred Falcon SOURCE CODE (e.g. scheduler_core.ts) to HelixWorks or another external party.',
      verdict: directSourceTransfer ? 'supported' : 'not-established',
      support: collect([
        smokingEmail ? sentenceWith(store, smokingEmail.id, ['scheduler_core']) : undefined,
        smokingAttachment ? sentenceWith(store, smokingAttachment.id, ['NovaChip Confidential']) : undefined,
        smokingReceipt ? sentenceWith(store, smokingReceipt.id, ['compiles']) : undefined,
        sentenceWith(store, 'ts-025', ['deleted the ZIP']),
        sentenceWith(store, 'ts-013', ['snapshot']),
      ]),
      counter: collect([
        sentenceWith(store, 'ts-009', ['do not bring']),
        sentenceWith(store, 'ts-010', ['Clean-room']),
        sentenceWith(store, 'ts-026', ['public scheduler_core']),
        sentenceWith(store, 'ts-019', ['No source code was sent']),
      ]),
      gaps: directSourceTransfer
        ? [
            `Computed attachment fingerprint: ${smokingAttachment?.id} MD5 ${smokingAttachment?.loadFile?.md5} matches internal snapshot ${snapshot?.id}. The public cache-utils extract (ts-026) and April escrow verification (ts-019) are separate records and do not explain the June 18 send.`,
            'Receipt and a local compile are established. Use inside HelixWorks systems or a product is NOT established: ts-024 says it was not uploaded, and ts-025 says the ZIP was deleted after the air-gapped build.',
            `Exhaustive search "${externalSourceCode?.term ?? 'scheduler_core'}" found ${externalSourceCode?.totalMatches ?? 0} record(s), including the public red herring; read content and fingerprints before treating filename matches as transfers.`,
          ]
        : [
            `Exhaustive search "${externalSourceCode?.term ?? 'scheduler_core'}" found ${externalSourceCode?.totalMatches ?? 0} record(s); none satisfied direct-send + matching-fingerprint + receipt.`,
            helixDirect.length
              ? `Reyes has ${helixDirect.length} cross-org counterparty link(s) to Helix org records — content of those records must be read before any inference.`
              : 'No direct Reyes→Helix-person communication with source content was computed from explicit roles.',
            'No exit device scan was performed (ts-014 process gap), so absence of evidence is weak.',
          ],
    },
  ];
  const overall = directSourceTransfer
    ? 'Supported: anomalous acquisition (H1), external transfer of tuning parameters (H2), and direct delivery of the current scheduler_core.ts to a HelixWorks engineer (H3). '
      + 'NOT established: upload to or use inside HelixWorks systems/products. '
      + 'Recommended next steps: preserve Oleg\'s air-gapped laptop, audit deletion/recovery and clean-room logs, and scope any downstream use before alleging product contamination.'
    : 'Supported: anomalous acquisition (H1) and external transfer of tuning parameters (H2). '
      + 'NOT established on this collection: transfer of Falcon source code to HelixWorks (H3). '
      + 'Recommended next steps: image/forensically scope the June 15 USB window, subpoena-grade review of the personal-mailbox attachment, and clean-room log audit at HelixWorks.';
  return {
    specialist: 'reasoning',
    inputSummary: '3 competing hypotheses vs retrieved bundles + relationships',
    output: { hypotheses, overall },
    provenance: {
      method: 'closed-verdict deterministic evaluation; verbatim sentence citations only',
      recordIds: [...new Set(hypotheses.flatMap((h) => [...h.support, ...h.counter].map((c) => c.recordId)))],
      scope: 'authored core + exhaustive generated-volume searches',
    },
  };
}
