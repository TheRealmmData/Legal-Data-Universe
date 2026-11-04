/**
 * Generic evidence data layer types (M3 preparation, 2026-10-27).
 * Decision-independent: no case narrative, no D2/D3 content.
 */

export type DateConfidence = 'verified' | 'derived' | 'suspect';

export interface Person {
  id: string;
  displayName: string;
  custodianId?: string;
}

export interface Custodian {
  id: string;
  displayName: string;
}

export interface Provenance {
  /** Producing system or collection, e.g. "synthetic-fixture-generator". */
  sourceSystem: string;
  collectionId: string;
  /** Content hash recorded at ingestion; format is producer-defined. */
  contentHash: string;
  ingestedAt: string;
}

export type ParticipantRole = 'sender' | 'recipient' | 'cc' | 'mentioned' | 'author';

export interface EvidenceRecord {
  id: string;
  kind: 'email' | 'document' | 'note' | 'record';
  title: string;
  body: string;
  /** Stored date verbatim; reliability is carried by dateConfidence. */
  date: string;
  dateConfidence: DateConfidence;
  custodianId: string;
  personIds: string[];
  provenance: Provenance;
  /**
   * Optional role-bearing participants (M3-reopened corpus). When
   * present, directed communication edges may be derived; when
   * absent (original fixture), direction must never be invented.
   */
  participants?: { personId: string; role: ParticipantRole }[];
  organizationIds?: string[];
  /** Authored ground-truth concepts (synthetic corpora only). */
  conceptTags?: string[];
  links?: {
    inReplyToId?: string;
    familyId?: string;
    attachmentIds?: string[];
  };
  /**
   * Relativity-style load-file / processing metadata (optional;
   * populated by corpora that model production processing).
   * Extension/MIME counts are only ever computed when present.
   */
  loadFile?: {
    fileName: string;
    extension: string;
    mimeType: string;
    bates: string;
    familyId?: string;
    parentId?: string;
    threadId?: string;
    md5: string;
    fileSizeKB: number;
    author?: string;
    sourcePath?: string;
    /** SEC Data Delivery Standards fields (see sec-fields.ts). */
    sec?: SecMetadata;
  };
}

/**
 * SEC Data Delivery Standards (.DAT metadata) as extracted from
 * knowledge/SEC Data Delivery Standards.pdf pp.6-8. Bates fields
 * EXIST but stay BLANK pre-production (owner instruction).
 * Fields the standard marks Email-only or Native-only carry ''
 * on the other kind — that is documented inapplicability, not
 * missing data. Page-8 timezone/received field names were only
 * partially legible in extraction; see sec-fields.ts inventory.
 */
export interface SecMetadata {
  firstBates: string; lastBates: string; attachRange: string;
  begAttach: string; endAttach: string; parentBates: string; childBates: string;
  custodian: string;
  from: string; to: string; cc: string; bcc: string;
  subject: string; dateSent: string; timeSent: string;
  link: string; mimeType: string; fileExtension: string;
  author: string; dateCreated: string; timeCreated: string;
  dateModified: string; timeModified: string;
  dateAccessed: string; timeAccessed: string; printedDate: string;
  fileSizeKB: number; pgCount: number;
  path: string; intFilePath: string; intMsgId: string;
  md5: string; extractedText: string;
}

export interface SearchHit {
  recordId: string;
  excerpt: string;
  /** Deterministic rank inputs, exposed for audit. */
  matchedIn: ('title' | 'body' | 'metadata')[];
}

export interface TimelineEntry {
  recordId: string;
  date: string;
  dateConfidence: DateConfidence;
  /** True when this record replies to a record dated after it. */
  repliesBeforeOriginal: boolean;
}
