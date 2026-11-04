/**
 * Sequenced investigation leads for the NovaChip trade-secret matter.
 *
 * The story evidence is synthetic and seeded, but these leads are
 * not free-form narration: every step is emitted only when the
 * underlying records, explicit participant roles, family links,
 * dates, and file fingerprints compute from the active store.
 * The live model still plans/synthesises the defined finding on
 * Prepare; deterministic specialists provide the fallback draft.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { EvidenceRecord } from '../evidence/types.ts';
import type { DiscoveryLead } from './leads.ts';

const includes = (record: EvidenceRecord, needle: string) =>
  `${record.title}\n${record.body}`.toLowerCase().includes(needle.toLowerCase());
const sender = (record?: EvidenceRecord) =>
  record?.participants?.find((p) => p.role === 'sender' || p.role === 'author')?.personId;
const recipients = (record?: EvidenceRecord) =>
  (record?.participants ?? []).filter((p) => p.role === 'recipient').map((p) => p.personId);
const unique = (ids: string[]) => [...new Set(ids)];

/**
 * Exactly three sequenced leads when the NovaChip chain is present;
 * fewer (including zero) when a computed link is missing. Each
 * lead changes perspective: chronology, then network, then file
 * types/family. Red herrings are included in focus sets so the
 * model has to distinguish them, not merely repeat a summary.
 */
export function buildDemoLeads(store: EvidenceStore): DiscoveryLead[] {
  const records = store.allIds()
    .map((id) => store.getRecord(id))
    .filter((r) => r != null);
  const first = (predicate: (r: EvidenceRecord) => boolean) => records.find(predicate);
  const all = (predicate: (r: EvidenceRecord) => boolean) => records.filter(predicate);
  const leads: DiscoveryLead[] = [];

  const resignation = first((r) => sender(r) === 'p-elena' && includes(r, 'resigning effective'));
  const clone = first((r) => includes(r, 'cloned falcon-scheduler') || includes(r, 'cloned falcon'));
  const usb = first((r) => includes(r, 'unregistered USB'));
  const usbChat = first((r) => includes(r, 'do not put this in email'));
  const mirrorChat = first((r) => includes(r, 'scheduled FALCON-MIRROR'));
  const debugApproval = first((r) => includes(r, 'Falcon debug bundle') && includes(r, 'Approved'));
  if (resignation && clone && usb && resignation.date <= clone.date && clone.date <= usb.date) {
    const focus = unique([
      resignation.id, clone.id, usb.id,
      ...(usbChat ? [usbChat.id] : []),
      ...(mirrorChat ? [mirrorChat.id] : []),
      ...(debugApproval ? [debugApproval.id] : []),
    ]);
    leads.push({
      id: 'demo-lead-1',
      origin: 'discover',
      kind: 'sequenced-investigation',
      priority: 'review_recommended',
      summary: 'Lead 1 — After resigning, Reyes clones the whole Falcon repo at midnight, then an unregistered USB appears',
      whyPrioritized: [
        `Chronology computes ${resignation.id} (${resignation.date}) → ${clone.id} (${clone.date}) → ${usb.id} (${usb.date}).`,
        'The clone is under Reyes\' named account, while the same-night FALCON-MIRROR chat describes a separate svc-mirror service account.',
        usbChat
          ? `A later text (${usbChat.id}) asks Raj not to put the USB explanation in email.`
          : 'The USB serial is absent from approved inventory.',
      ],
      supportingRecordIds: focus,
      featureReferences: ['sequence:resignation-sequence', 'search:cloned', 'search:USB', 'search:do not put this in email'],
      limitations: [
        'The May customer-debug approval and scheduled mirror job are real competing explanations with different dates/accounts/devices.',
        'USB contents were not imaged; this lead proves anomalous acquisition channels, not what left on the device.',
      ],
      suggestedAction: {
        lens: 'chronology',
        focusRecordIds: focus,
        question: 'Did Elena Reyes acquire Falcon material through anomalous channels after resigning? Compare the named-user full-history clones and unregistered USB against the scheduled mirror job and the May customer-debug approval.',
      },
      demoStep: 1,
      hypothesisId: 'H1-acquisition',
      definedFinding: 'Reyes acquired Falcon material through anomalous channels shortly before departing (off-hours full-history clones; unregistered USB write).',
      followUpQuestions: [
        'Was the June 13 clone just the scheduled FALCON-MIRROR job?',
        'What exactly can we prove went onto the unregistered USB?',
        'Why did Reyes tell Raj not to put the USB explanation in email?',
      ],
      searchSuggestions: ['cloned', 'USB', 'do not put this in email', 'FALCON-MIRROR'],
      score: 12,
      scoreBasis: 'computed resignation→clone→USB sequence',
      modelRoute: 'specialist',
      status: 'proposed',
    });
  }

  const personalForward = first((r) => sender(r) === 'p-elena' && includes(r, 'personal mailbox'));
  const tuningDoc = personalForward?.links?.familyId
    ? all((r) => r.links?.familyId === personalForward.links?.familyId && r.id !== personalForward.id
      && includes(r, 'tuning parameters'))[0]
    : undefined;
  const scopeApproval = first((r) => includes(r, 'does NOT cover scheduler tuning parameters'));
  const nightjarChat = first((r) => includes(r, 'Nightjar'));
  if (personalForward && tuningDoc && scopeApproval) {
    const focus = unique([
      personalForward.id, tuningDoc.id, scopeApproval.id,
      ...(nightjarChat ? [nightjarChat.id] : []),
      ...(resignation ? [resignation.id] : []),
    ]);
    leads.push({
      id: 'demo-lead-2',
      origin: 'discover',
      kind: 'sequenced-investigation',
      priority: 'review_recommended',
      summary: 'Lead 2 — Falcon tuning secrets leave NovaChip through Reyes\' personal mailbox',
      whyPrioritized: [
        `${personalForward.id} explicitly forwards Falcon design notes and scheduler tuning parameters to a personal mailbox.`,
        `${tuningDoc.id} is the attached family document containing thresholds, the NUMA pinning matrix, and benchmark deltas.`,
        `${scopeApproval.id} is the trap for a lazy answer: its open-source approval expressly does NOT cover tuning parameters.`,
      ],
      supportingRecordIds: focus,
      featureReferences: ['sequence:personal-mailbox-family', 'search:personal mailbox', 'search:tuning parameters', 'search:Nightjar'],
      limitations: [
        'The stated purpose was finishing handover work from home; transfer and authorization do not by themselves prove intent.',
        'The Nightjar/headhunter chat supplies context and gossip, not proof of transfer.',
      ],
      suggestedAction: {
        lens: 'network',
        focusRecordIds: focus,
        question: 'Did Elena Reyes transfer Falcon scheduler tuning parameters outside NovaChip through her personal mailbox, and was that transfer authorized? Distinguish the handover explanation from the approval that expressly excludes tuning parameters.',
      },
      demoStep: 2,
      hypothesisId: 'H2-external-transfer-tuning',
      definedFinding: 'Reyes transferred Falcon scheduler tuning parameters outside NovaChip (personal mailbox forward).',
      followUpQuestions: [
        'What exactly in the attachment was confidential?',
        'Did the open-source approval authorize any part of this forward?',
        'Do we know whether the personal-mailbox copy went any farther?',
      ],
      searchSuggestions: ['personal mailbox', 'tuning parameters', 'Nightjar', 'Apache-2.0'],
      score: 11,
      scoreBasis: 'computed personal-mailbox send + attachment family + scope exclusion',
      modelRoute: 'specialist',
      status: 'proposed',
    });
  }

  const snapshot = first((r) => includes(r, 'Repository snapshot of scheduler_core'));
  const attachment = snapshot?.loadFile?.md5
    ? all((r) => r.id !== snapshot.id && Boolean(r.loadFile?.parentId) && r.loadFile?.md5 === snapshot.loadFile?.md5
      && includes(r, 'scheduler_core'))[0]
    : undefined;
  const send = attachment?.loadFile?.parentId ? store.getRecord(attachment.loadFile.parentId) : undefined;
  const receipt = send
    ? first((r) => r.links?.inReplyToId === send.id && includes(r, 'compiles'))
    : undefined;
  const helixChat = first((r) => includes(r, 'deleted the ZIP Elena sent'));
  const publicExtract = first((r) => includes(r, 'public scheduler_core')
    && r.loadFile?.md5 !== snapshot?.loadFile?.md5);
  const escrow = first((r) => includes(r, 'escrow verification'));
  if (snapshot && attachment && send && receipt
    && sender(send) === 'p-elena' && recipients(send).includes('p-oleg')) {
    const focus = unique([
      send.id, attachment.id, receipt.id, snapshot.id,
      ...(helixChat ? [helixChat.id] : []),
      ...(publicExtract ? [publicExtract.id] : []),
      ...(escrow ? [escrow.id] : []),
    ]);
    leads.push({
      id: 'demo-lead-3',
      origin: 'discover',
      kind: 'sequenced-investigation',
      priority: 'review_recommended',
      summary: 'Lead 3 — The smoking gun: the actual scheduler_core.ts reaches a HelixWorks engineer, who confirms it compiles',
      whyPrioritized: [
        `${send.id} is an explicit Reyes → Oleg send of the current scheduler_core.ts from the June 13 clone.`,
        `Computed file fingerprint: attachment ${attachment.id} MD5 ${attachment.loadFile?.md5} exactly matches internal snapshot ${snapshot.id}.`,
        `${receipt.id} confirms receipt and an air-gapped compile. Search alone is not enough: ${publicExtract?.id ?? 'another record'} is a same-name public extract with a different fingerprint, and escrow is a separate authorized snapshot.`,
      ],
      supportingRecordIds: focus,
      featureReferences: ['sequence:direct-send', 'sequence:attachment-md5-match', 'sequence:receipt', 'search:scheduler_core', 'search:air-gapped', 'search:escrow'],
      limitations: [
        'Delivery and a local compile are established; upload to or use inside HelixWorks systems/products is not.',
        'Filename matches include red herrings. Content, sender/recipient roles, family links, and MD5 identity do the discriminating work.',
      ],
      suggestedAction: {
        lens: 'filetypes',
        focusRecordIds: focus,
        question: `Did Elena Reyes send the current NovaChip scheduler_core.ts to Oleg Sorin at HelixWorks? Use the computed fact that attachment ${attachment.id} has MD5 ${attachment.loadFile?.md5}, exactly matching internal snapshot ${snapshot.id}. Distinguish the same-name public cache-utils extract and the April escrow verification.`,
      },
      demoStep: 3,
      hypothesisId: 'H3-source-code-exfiltration',
      definedFinding: 'Reyes transferred Falcon SOURCE CODE (scheduler_core.ts) to HelixWorks engineer Oleg Sorin.',
      followUpQuestions: [
        'How do we know the attachment is the internal file rather than the public extract?',
        'Did Oleg upload or use the file inside HelixWorks systems?',
        'What did Nina know, and when did she know it?',
      ],
      searchSuggestions: ['scheduler_core', 'air-gapped', 'escrow', 'public cache-utils'],
      score: 10,
      scoreBasis: 'computed direct send + MD5 identity + receipt',
      modelRoute: 'specialist',
      status: 'proposed',
    });
  }

  return leads.sort((a, b) => (a.demoStep ?? 99) - (b.demoStep ?? 99));
}
