/**
 * Evidence adapter boundary (D2 infrastructure, 2026-10-27).
 * The spatial experience and agent tools depend ONLY on this interface,
 * so today's synthetic store can later be replaced by adapters for real
 * eDiscovery platforms without changing investigator-facing behaviour.
 * All methods are async-ready; the fixture adapter resolves immediately.
 */
import { EvidenceStore } from './store.ts';
import type {
  Custodian,
  EvidenceRecord,
  SearchHit,
  TimelineEntry,
} from './types.ts';

export interface EvidenceAdapter {
  readonly name: string;
  search(term: string, limit?: number): Promise<SearchHit[]>;
  /** Complete-match count for the same criterion (defensible totals). */
  searchWithCount(
    term: string,
    limit?: number,
  ): Promise<{ hits: SearchHit[]; totalMatches: number; truncated: boolean }>;
  getRecord(recordId: string): Promise<EvidenceRecord | undefined>;
  timeline(recordIds: string[]): Promise<TimelineEntry[]>;
  related(recordId: string): Promise<string[]>;
  provenanceOf(recordId: string): Promise<EvidenceRecord['provenance'] | undefined>;
  listCustodians(): Promise<Custodian[]>;
  /** Total records addressable through this adapter (scale honesty). */
  corpusSize(): Promise<number>;
}

/** Adapter over the local deterministic EvidenceStore (fixtures today). */
export class StoreEvidenceAdapter implements EvidenceAdapter {
  readonly name = 'local-evidence-store';
  private store: EvidenceStore;
  private custodians: Custodian[];
  constructor(store: EvidenceStore, custodians: Custodian[]) {
    this.store = store;
    this.custodians = custodians;
  }

  async search(term: string, limit?: number): Promise<SearchHit[]> {
    return this.store.search(term, limit);
  }

  async searchWithCount(term: string, limit?: number) {
    return this.store.searchWithCount(term, limit);
  }
  async getRecord(recordId: string): Promise<EvidenceRecord | undefined> {
    return this.store.getRecord(recordId);
  }
  async timeline(recordIds: string[]): Promise<TimelineEntry[]> {
    return this.store.timeline(recordIds);
  }
  async related(recordId: string): Promise<string[]> {
    return this.store.related(recordId);
  }
  async provenanceOf(
    recordId: string,
  ): Promise<EvidenceRecord['provenance'] | undefined> {
    return this.store.provenanceOf(recordId);
  }
  async listCustodians(): Promise<Custodian[]> {
    return [...this.custodians];
  }
  async corpusSize(): Promise<number> {
    return this.store.size;
  }
}
