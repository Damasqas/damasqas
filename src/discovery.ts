import { EventEmitter } from 'node:events';
import type { QueueAdapter } from './adapters/types.js';

export interface DiscoveryEvents {
  'queue:added': (name: string) => void;
  'queue:removed': (name: string) => void;
}

export class Discovery extends EventEmitter {
  private adapter: QueueAdapter;
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private knownQueues = new Set<string>();

  constructor(adapter: QueueAdapter, intervalSeconds: number) {
    super();
    this.adapter = adapter;
    this.interval = intervalSeconds * 1000;
  }

  async scan(): Promise<string[]> {
    const discovered = await this.adapter.discoverQueues();
    const discoveredSet = new Set(discovered);

    // Detect new queues
    for (const name of discovered) {
      if (!this.knownQueues.has(name)) {
        this.knownQueues.add(name);
        this.emit('queue:added', name);
      }
    }

    // Detect removed queues
    for (const name of this.knownQueues) {
      if (!discoveredSet.has(name)) {
        this.knownQueues.delete(name);
        this.emit('queue:removed', name);
      }
    }

    return discovered;
  }

  async start(): Promise<string[]> {
    const queues = await this.scan();
    this.timer = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[discovery] Re-scan failed:', err);
      });
    }, this.interval);
    return queues;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getQueues(): string[] {
    return Array.from(this.knownQueues).sort();
  }
}
