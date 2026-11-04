/**
 * SEC Data Delivery Standards field inventory (built BEFORE the
 * TS3000 corpus, per owner instruction 2026-10-31).
 * Source: knowledge/SEC Data Delivery Standards.pdf, metadata
 * (.DAT) table pp.6-8, text-extracted 2026-10-31. Extraction
 * was partially garbled (subset fonts): names below are the
 * legible reconstructions; page-8 timezone/received rows were
 * NOT legible and are flagged `legible:false` rather than
 * invented. Owner/Sparky: confirm against PDF visually.
 */
import type { EvidenceRecord } from './types.ts';

export interface SecFieldSpec {
  secName: string; key: string; appliesTo: 'all' | 'email' | 'native';
  rule: string; legible: boolean;
}

export const SEC_FIELDS: SecFieldSpec[] = [
  ['FIRSTBATES', 'firstBates', 'all', 'BLANK pre-production (owner instruction)', true],
  ['LASTBATES', 'lastBates', 'all', 'BLANK pre-production', true],
  ['ATTACHRANGE', 'attachRange', 'all', 'BLANK pre-production', true],
  ['BEGATTACH', 'begAttach', 'all', 'BLANK pre-production', true],
  ['ENDATTACH', 'endAttach', 'all', 'BLANK pre-production', true],
  ['PARENT_BATES', 'parentBates', 'all', 'BLANK pre-production; family links live in loadFile.familyId/parentId', true],
  ['CHILD_BATES', 'childBates', 'all', 'BLANK pre-production', true],
  ['CUSTODIAN', 'custodian', 'all', 'Individual custodian "Last, First"', true],
  ['FROM', 'from', 'all', 'Email: sender. Native: author(s), semicolon-separated', true],
  ['TO', 'to', 'email', 'Recipient(s), semicolon-separated; native = ""', true],
  ['CC', 'cc', 'email', 'Carbon-copy recipient(s); none = ""', true],
  ['BCC', 'bcc', 'email', 'Blind-copy recipient(s); none = ""', true],
  ['SUBJECT', 'subject', 'all', 'Email subject / native title', true],
  ['DATE_SENT', 'dateSent', 'email', 'Native = ""', true],
  ['TIME_SENT', 'timeSent', 'email', 'Separate field, never combined; native = ""', true],
  ['LINK', 'link', 'all', 'Hyperlink/path to native file', true],
  ['MIME_TYPE', 'mimeType', 'all', 'Content type from header (name partially legible in extract)', false],
  ['FILE_EXTENSION', 'fileExtension', 'all', 'e.g. MSG, DOCX', true],
  ['AUTHOR', 'author', 'native', 'Email = "" per standard extract', true],
  ['DATE_CREATED', 'dateCreated', 'native', 'Email = ""', true],
  ['TIME_CREATED', 'timeCreated', 'native', 'Separate field; email = ""', true],
  ['DATE_MODIFIED', 'dateModified', 'native', 'Email = ""', true],
  ['TIME_MODIFIED', 'timeModified', 'native', 'Separate field; email = ""', true],
  ['DATE_ACCESSED', 'dateAccessed', 'native', 'Email = ""', true],
  ['TIME_ACCESSED', 'timeAccessed', 'native', 'Separate field; email = ""', true],
  ['PRINTED_DATE', 'printedDate', 'native', '"" when never printed (documented, not invented)', true],
  ['FILE_SIZE', 'fileSizeKB', 'all', 'Size in KB', true],
  ['PGCOUNT', 'pgCount', 'all', 'Page count (estimated from extracted text length in synthetic data)', true],
  ['PATH', 'path', 'native', 'Original storage path incl. filename; email = ""', true],
  ['INT_FILE_PATH', 'intFilePath', 'email', 'Original mailbox location; native = ""', true],
  ['INT_ID', 'intMsgId', 'email', 'Unique Message-ID; native = ""', true],
  ['MD5', 'md5', 'all', 'MD5 hash (synthetic corpora: deterministic pseudo-hash, labelled synthetic)', true],
  ['EXTRACTED_TEXT', 'extractedText', 'all', 'Searchable extracted text (record body)', false],
].map(([secName, key, appliesTo, rule, legible]) => ({
  secName: secName as string, key: key as string,
  appliesTo: appliesTo as SecFieldSpec['appliesTo'],
  rule: rule as string, legible: legible as boolean,
}));

/** Fields that must be NON-blank for a record of this kind. */
export function secMissingFields(record: EvidenceRecord): string[] {
  const sec = record.loadFile?.sec;
  if (!sec) return ['sec'];
  const missing: string[] = [];
  for (const f of SEC_FIELDS) {
    if (f.key.endsWith('Bates') || ['attachRange', 'begAttach', 'endAttach'].includes(f.key)) {
      if ((sec as unknown as Record<string, unknown>)[f.key] !== '') missing.push(`${f.secName}:must-be-blank`);
      continue;
    }
    const applicable = f.appliesTo === 'all'
      || (f.appliesTo === 'email' && record.kind === 'email')
      || (f.appliesTo === 'native' && record.kind !== 'email');
    const v = (sec as unknown as Record<string, unknown>)[f.key];
    if (v === undefined) { missing.push(`${f.secName}:absent`); continue; }
    if (!applicable) continue;
    if (['cc', 'bcc', 'printedDate'].includes(f.key)) continue; // genuinely may be empty
    if (typeof v === 'string' && v === '') missing.push(`${f.secName}:empty`);
    if (typeof v === 'number' && !(v > 0)) missing.push(`${f.secName}:nonpositive`);
  }
  return missing;
}
