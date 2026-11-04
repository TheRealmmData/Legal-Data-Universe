/**
 * Expanded-corpus integration architecture (M3 reopened).
 * One factory turns any generated corpus into the SAME store +
 * adapter the accepted fixture uses, so wiring a future approved
 * corpus (or a platform adapter) into the experience is a data
 * swap, not a rewrite. Live since 2026-10-28 as the selectable
 * Expanded 112 corpus. Startup corpus is Trade Secret since
 * 2026-11-01 (Fixture 8 retired at owner direction).
 */
import { StoreEvidenceAdapter, type EvidenceAdapter } from '../adapter.ts';
import { EvidenceStore } from '../store.ts';
import { buildCorpus, type GeneratedCorpus } from './generator.ts';
import { buildTradeSecretCorpus } from './trade-secret.ts';

export { recordDomainCheck, personEmail, orgDomain } from './trade-secret.ts';

export interface LoadedCorpus {
  corpus: GeneratedCorpus;
  store: EvidenceStore;
  adapter: EvidenceAdapter;
  corpusId: string;
  corpusVersion: string;
}

/** Galaxy-scale corpus: same generator, volume is a parameter.
 * 500 tonight; 1,000 is the same call with a different count. */
export function loadGalaxyCorpus(targetCount = 500, seed = 42): LoadedCorpus {
  const corpus = buildCorpus(seed, Math.max(0, targetCount - 18));
  const store = new EvidenceStore(corpus.people, corpus.custodians, corpus.records);
  return {
    corpus,
    store,
    adapter: new StoreEvidenceAdapter(store, corpus.custodians),
    corpusId: `atlas-galaxy-${corpus.records.length}`,
    corpusVersion: '1',
  };
}

const FILE_MIME: Record<string, string> = {
  html: 'text/html', mp3: 'audio/mpeg', mp4: 'video/mp4', dat: 'application/octet-stream',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown', log: 'text/plain', txt: 'text/plain', png: 'image/png',
  zip: 'application/zip',
};
const hash01 = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};

/**
 * Realistic collected-file mix (owner, 2026-11-01), applied at
 * LOAD time to generated background records only: recognizable
 * extensions plus Teams-chat and text-message exports. The
 * generator (buildTradeSecretCorpus) stays byte-stable for the
 * clustering lane's pinned artifacts; Sparky can fold this
 * into the generator when regenerating artifacts.
 */
function realisticFileMix(corpus: GeneratedCorpus): void {
  const DOC_POOL = ['docx', 'pdf', 'xlsx', 'docx', 'pptx', 'pdf', 'html', 'md', 'log', 'mp4', 'mp3', 'dat'];
  const NOTE_POOL = ['txt', 'md', 'log', 'html', 'mp3', 'mp4', 'txt', 'md', 'png', 'zip'];
  for (const record of corpus.records) {
    if (!record.id.startsWith('bg-') || !record.loadFile) continue;
    const lf = record.loadFile as { fileName: string; extension?: string; mimeType: string };
    const h = hash01(record.id);
    let ext: string | undefined;
    if (record.kind === 'note' && h < 0.07) {
      record.title = `Teams chat - ${record.title}`;
      record.body = `[Teams transcript] ${record.body} [Teams] Acknowledged in channel; export retained for the collection.`;
      ext = 'html';
    } else if (record.kind === 'note' && h < 0.12) {
      record.title = `Text message - ${record.title}`;
      record.body = `[SMS export] ${record.body} [SMS] Got it, will follow up today.`;
      ext = 'txt';
    } else if (record.kind === 'document') {
      ext = DOC_POOL[Math.floor(h * DOC_POOL.length) % DOC_POOL.length];
    } else if (record.kind === 'note') {
      ext = NOTE_POOL[Math.floor(h * NOTE_POOL.length) % NOTE_POOL.length];
    }
    if (!ext) continue;
    // Keep SEC extracted text identical to the (possibly
    // chat-wrapped) body — the SEC test asserts byte equality.
    const sec = (lf as { sec?: { extractedText?: string } }).sec;
    if (sec) sec.extractedText = record.body;
    lf.extension = ext;
    lf.mimeType = FILE_MIME[ext] ?? lf.mimeType;
    lf.fileName = `${lf.fileName.replace(/\.[a-z0-9]+$/i, '')}.${ext}`;
  }
}

/** Primary M4 demo universe: trade-secret investigation, 1,500
 * records with load-file metadata. Atlas corpora remain for
 * regression; accepted M3 baselines are untouched. */
export function loadTradeSecretCorpus(seed = 7, target = 3000): LoadedCorpus {
  const corpus = buildTradeSecretCorpus(seed, target);
  realisticFileMix(corpus);
  const store = new EvidenceStore(corpus.people, corpus.custodians, corpus.records);
  return {
    corpus,
    store,
    adapter: new StoreEvidenceAdapter(store, corpus.custodians),
    corpusId: `novachip-trade-secret-${corpus.records.length}`,
    corpusVersion: '1',
  };
}

export function loadExpandedCorpus(seed = 42): LoadedCorpus {
  const corpus = buildCorpus(seed);
  const store = new EvidenceStore(corpus.people, corpus.custodians, corpus.records);
  return {
    corpus,
    store,
    adapter: new StoreEvidenceAdapter(store, corpus.custodians),
    corpusId: 'atlas-expanded-001',
    corpusVersion: '1',
  };
}
