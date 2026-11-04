/**
 * Deterministic evidence store (M3 preparation).
 * Pure, synchronous, no model calls. Same input -> same output, always.
 * Ground-truth data never enters this module.
 */
import type {
  Custodian,
  EvidenceRecord,
  Person,
  SearchHit,
  TimelineEntry,
} from './types.ts';

export class EvidenceStore {
  private records = new Map<string, EvidenceRecord>();
  private people = new Map<string, Person>();
  private custodians = new Map<string, Custodian>();

  personName(id: string): string {
    return this.people.get(id)?.displayName ?? id;
  }

  constructor(people: Person[], custodians: Custodian[], records: EvidenceRecord[]) {
    for (const p of people) {
      if (this.people.has(p.id)) throw new Error(`duplicate person id: ${p.id}`);
      this.people.set(p.id, p);
    }
    for (const c of custodians) {
      if (this.custodians.has(c.id)) throw new Error(`duplicate custodian id: ${c.id}`);
      this.custodians.set(c.id, c);
    }
    for (const r of records) {
      if (this.records.has(r.id)) throw new Error(`duplicate record id: ${r.id}`);
      if (!this.custodians.has(r.custodianId)) {
        throw new Error(`record ${r.id} references unknown custodian ${r.custodianId}`);
      }
      for (const pid of r.personIds) {
        if (!this.people.has(pid)) {
          throw new Error(`record ${r.id} references unknown person ${pid}`);
        }
      }
      this.records.set(r.id, r);
    }
  }

  get size(): number {
    return this.records.size;
  }

  has(recordId: string): boolean {
    return this.records.has(recordId);
  }

  /** Returns undefined for a missing id — callers must handle absence. */
  getRecord(recordId: string): EvidenceRecord | undefined {
    return this.records.get(recordId);
  }

  allIds(): string[] {
    return [...this.records.keys()].sort();
  }

  /**
   * Case-insensitive substring search over title, body, and metadata
   * (record id, kind, stored date, custodian and person names).
   * Ranking is deterministic: title matches first, then stored date
   * ascending, then id. An empty/whitespace term matches NOTHING —
   * "show all" is an explicit UI action, never a search result.
   */
  search(term: string, limit = 25): SearchHit[] {
    return this.searchWithCount(term, limit).hits;
  }

  /**
   * Search with an honest total: `totalMatches` counts EVERY record
   * meeting the criterion; `hits` may be capped by `limit` for the
   * caller, and `truncated` says so. Defensibility requirement
   * (M3 headset report 2026-10-28): a returned count must never
   * silently pose as the complete hit count.
   */
  searchWithCount(
    term: string,
    limit = 25,
  ): { hits: SearchHit[]; totalMatches: number; truncated: boolean } {
    // Matching rules (documented): case-insensitive substring;
    // surrounding quotes stripped (exact phrase = the quoted
    // substring); hyphens and whitespace are equivalent, so
    // "source code" also matches "source-code". No stemming.
    const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    const raw = term.trim().replace(/^["']|["']$/g, '');
    const needle = norm(raw);
    if (!needle) return { hits: [], totalMatches: 0, truncated: false };
    const hits: (SearchHit & { date: string })[] = [];
    for (const record of this.records.values()) {
      const matchedIn: SearchHit['matchedIn'] = [];
      if (norm(record.title).includes(needle)) matchedIn.push('title');
      if (norm(record.body).includes(needle)) matchedIn.push('body');
      if (norm(this.metadataHaystack(record)).includes(needle)) matchedIn.push('metadata');
      if (matchedIn.length === 0) continue;
      hits.push({
        recordId: record.id,
        excerpt: excerptFor(record, needle),
        matchedIn,
        date: record.date,
      });
    }
    hits.sort((a, b) => {
      const titleRank =
        Number(b.matchedIn.includes('title')) - Number(a.matchedIn.includes('title'));
      if (titleRank !== 0) return titleRank;
      return a.date.localeCompare(b.date) || a.recordId.localeCompare(b.recordId);
    });
    const totalMatches = hits.length;
    const capped = hits.slice(0, Math.max(0, limit));
    return {
      hits: capped.map(({ recordId, excerpt, matchedIn }) => ({
        recordId,
        excerpt,
        matchedIn,
      })),
      totalMatches,
      truncated: totalMatches > capped.length,
    };
  }

  /** Stored-date order with confidence and reply-before-original flags. */
  timeline(recordIds: string[]): TimelineEntry[] {
    const entries = recordIds
      .map((id) => this.records.get(id))
      .filter((r): r is EvidenceRecord => r != null)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return entries.map((record) => {
      const parent = record.links?.inReplyToId
        ? this.records.get(record.links.inReplyToId)
        : undefined;
      return {
        recordId: record.id,
        date: record.date,
        dateConfidence: record.dateConfidence,
        repliesBeforeOriginal: parent != null && record.date < parent.date,
      };
    });
  }

  /** Records sharing a person, family, or reply link with the given record. */
  related(recordId: string): string[] {
    const source = this.records.get(recordId);
    if (!source) return [];
    const out = new Set<string>();
    for (const record of this.records.values()) {
      if (record.id === recordId) continue;
      const sharesPerson = record.personIds.some((p) => source.personIds.includes(p));
      const sharesFamily =
        source.links?.familyId != null && record.links?.familyId === source.links.familyId;
      const replyLinked =
        record.links?.inReplyToId === recordId || source.links?.inReplyToId === record.id;
      if (sharesPerson || sharesFamily || replyLinked) out.add(record.id);
    }
    return [...out].sort();
  }

  recordsByCustodian(custodianId: string): string[] {
    return this.allIds().filter((id) => this.records.get(id)?.custodianId === custodianId);
  }

  provenanceOf(recordId: string): EvidenceRecord['provenance'] | undefined {
    return this.records.get(recordId)?.provenance;
  }

  private metadataHaystack(record: EvidenceRecord): string {
    const custodian = this.custodians.get(record.custodianId);
    const people = record.personIds
      .map((id) => this.people.get(id)?.displayName ?? id)
      .join(' ');
    return [
      record.id,
      record.kind,
      record.date,
      record.custodianId,
      custodian?.displayName ?? '',
      people,
    ]
      .join(' ')
      .toLowerCase();
  }
}

function excerptFor(record: EvidenceRecord, needle: string, radius = 42): string {
  const haystack = record.body;
  const at = haystack.toLowerCase().indexOf(needle);
  if (at < 0) return record.title;
  const start = Math.max(0, at - radius);
  const end = Math.min(haystack.length, at + needle.length + radius);
  return `${start > 0 ? '...' : ''}${haystack.slice(start, end)}${end < haystack.length ? '...' : ''}`;
}
