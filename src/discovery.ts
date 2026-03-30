import { EventEmitter } from 'node:events';
import type { QueueAdapter } from './adapters/types.js';
import type { MetricsStore } from './store.js';

export interface DiscoveryEvents {
  'queue:added': (name: string) => void;
  'queue:removed': (name: string) => void;
  'queue:stale': (name: string) => void;
}

const STALE_THRESHOLD = 3; // miss 3 consecutive scans → stale

export class Discovery extends EventEmitter {
  private adapter: QueueAdapter;
  private store: MetricsStore;
  private prefix: string;
  private knownQueues = new Set<string>();
  private missedScans = new Map<string, number>();
  private staleQueues = new Set<string>();

  constructor(adapter: QueueAdapter, store: MetricsStore, prefix: string) {
    super();
    this.adapter = adapter;
    this.store = store;
    this.prefix = prefix;
  }

  async scan(): Promise<string[]> {
    const discovered = await this.adapter.discoverQueues();
    const discoveredSet = new Set(discovered);

    // Persist to SQLite and detect new queues
    for (const name of discovered) {
      this.store.upsertQueue(name, this.prefix);
      this.missedScans.set(name, 0);

      if (this.staleQueues.has(name)) {
        this.staleQueues.delete(name);
      }

      if (!this.knownQueues.has(name)) {
        this.knownQueues.add(name);
        this.emit('queue:added', name);
      }
    }

    // Track missed scans for known queues not found
    for (const name of this.knownQueues) {
      if (!discoveredSet.has(name)) {
        const missed = (this.missedScans.get(name) ?? 0) + 1;
        this.missedScans.set(name, missed);

        if (missed >= STALE_THRESHOLD && !this.staleQueues.has(name)) {
          this.staleQueues.add(name);
          this.emit('queue:stale', name);
        }
      }
    }

    return discovered;
  }

  /** Run initial scan without starting an interval (collector manages the loop) */
  async initialScan(): Promise<string[]> {
    return this.scan();
  }

  /** @deprecated Use initialScan() + collector loop instead. Kept for backward compat. */
  async start(): Promise<string[]> {
    return this.initialScan();
  }

  stop(): void {
    // No-op: the collector now manages the loop
  }

  getQueues(): string[] {
    return Array.from(this.knownQueues).sort();
  }

  getStaleQueues(): string[] {
    return Array.from(this.staleQueues).sort();
  }

  isStale(queue: string): boolean {
    return this.staleQueues.has(queue);
  }
}
