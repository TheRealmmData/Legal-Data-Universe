/**
 * Investigator-initiated search (D2 phase A infrastructure).
 * Free exploration is first-class: the investigator's own queries run
 * against the same evidence adapter the agent uses, results can be
 * pinned as investigator leads, and relationships can be followed —
 * all recorded in the shared investigation state.
 *
 * Search semantics (locked by regression tests):
 * - A non-empty term is executed verbatim as a case-insensitive
 *   keyword-substring operation and recorded as a SearchExecution
 *   (original query, operation, corpus identity/version, timestamp,
 *   hit count, matched record IDs).
 * - An empty/whitespace term is NOT an executed search: it returns
 *   no hits, records nothing, and leaves the current hit list
 *   untouched. Restoring the full corpus is `clearSearch()`, an
 *   explicit action — never a side effect of an empty string.
 * - Hit navigation (next/prev/current) lives here, independent of
 *   any document viewer, so a future full-text viewer renders
 *   `currentHitId()` without owning search state.
 */
import type { EvidenceAdapter } from '../evidence/adapter.ts';
import type { SearchHit } from '../evidence/types.ts';
import {
  InvestigationState,
  type Lead,
  type SearchExecution,
} from './state.ts';

export interface CorpusDescriptor {
  id: string;
  version: string;
}

export class SearchSession {
  private adapter: EvidenceAdapter;
  private state: InvestigationState;
  private corpus: CorpusDescriptor;
  private hitIds: string[] = [];
  private hitCursor = -1;
  private lastExecution: SearchExecution | undefined;

  constructor(
    adapter: EvidenceAdapter,
    state: InvestigationState,
    corpus: CorpusDescriptor = { id: adapter.name, version: '1' },
  ) {
    this.adapter = adapter;
    this.state = state;
    this.corpus = corpus;
  }

  async query(term: string, limit?: number): Promise<SearchHit[]> {
    const executedQuery = term.trim();
    if (!executedQuery) return [];
    // Investigator search is EXHAUSTIVE by default: every record
    // meeting the declared substring criterion is returned and
    // recorded. Caps exist only where a caller sets one, and the
    // execution record then says so (returnedCount/truncated).
    const corpusSize = await this.adapter.corpusSize();
    const effectiveLimit = limit ?? corpusSize;
    const { hits, totalMatches, truncated } =
      await this.adapter.searchWithCount(executedQuery, effectiveLimit);
    this.state.recordQuery(term);
    this.lastExecution = this.state.recordSearchExecution({
      actor: 'investigator',
      originalQuery: term,
      operation: 'keyword-substring (exhaustive)',
      executedQuery,
      corpusId: this.corpus.id,
      corpusVersion: this.corpus.version,
      corpusSize,
      hitCount: totalMatches,
      matchedRecordIds: hits.map((h) => h.recordId),
      returnedCount: hits.length,
      truncated,
    });
    this.hitIds = hits.map((h) => h.recordId);
    // Nothing is "current" until the investigator navigates or opens a
    // hit, so the first Next lands on hit 1 (not hit 2).
    this.hitCursor = -1;
    hits.forEach((hit) => this.state.markVisited(hit.recordId));
    return hits;
  }

  /** Explicit reset to the full corpus. Not a search; records nothing. */
  clearSearch(): void {
    this.hitIds = [];
    this.hitCursor = -1;
    this.lastExecution = undefined;
  }

  getLastExecution(): SearchExecution | undefined {
    return this.lastExecution;
  }

  // --- Hit navigation (viewer-independent) ---------------------------

  hitList(): readonly string[] {
    return this.hitIds;
  }

  /** 0-based cursor, or -1 when there are no hits. */
  hitIndex(): number {
    return this.hitCursor;
  }

  currentHitId(): string | undefined {
    return this.hitCursor >= 0 ? this.hitIds[this.hitCursor] : undefined;
  }

  nextHit(): string | undefined {
    if (this.hitIds.length === 0) return undefined;
    this.hitCursor =
      this.hitCursor < 0 ? 0 : (this.hitCursor + 1) % this.hitIds.length;
    return this.hitIds[this.hitCursor];
  }

  previousHit(): string | undefined {
    if (this.hitIds.length === 0) return undefined;
    this.hitCursor =
      this.hitCursor < 0
        ? this.hitIds.length - 1
        : (this.hitCursor - 1 + this.hitIds.length) % this.hitIds.length;
    return this.hitIds[this.hitCursor];
  }

  // --- Leads, relationships, source opening ---------------------------

  /** Pin search results as an investigator-originated lead. */
  pinLead(title: string, hits: SearchHit[], rationale: string): Lead {
    return this.state.addLead({
      title,
      source: 'investigator',
      recordIds: [...new Set(hits.map((h) => h.recordId))],
      rationale,
    });
  }

  /** Follow relationships from a record the investigator is examining. */
  async follow(recordId: string): Promise<string[]> {
    this.state.markVisited(recordId);
    const related = await this.adapter.related(recordId);
    related.forEach((id) => this.state.markVisited(id));
    return related;
  }

  async open(recordId: string) {
    this.state.markVisited(recordId);
    // Keep hit navigation honest: manually opening a hit moves the cursor.
    const at = this.hitIds.indexOf(recordId);
    if (at >= 0) this.hitCursor = at;
    const [record, provenance] = await Promise.all([
      this.adapter.getRecord(recordId),
      this.adapter.provenanceOf(recordId),
    ]);
    return { record, provenance };
  }
}
