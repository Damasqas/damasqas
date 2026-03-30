import type { Redis } from 'ioredis';
import type { MetricsStore } from './store.js';
import type { Discovery } from './discovery.js';
import type { EventRecord } from './types.js';

/**
 * EventStreamConsumer uses a dedicated Redis connection to run a blocking
 * XREAD across all discovered queue event streams. Events are persisted
 * to the SQLite events table and FTS index.
 *
 * BullMQ publishes events to {prefix}:{queueName}:events as a Redis Stream.
 * Stream entry fields: event (type), jobId, prev (previous state), plus
 * event-specific fields like failedReason, returnvalue, etc.
 */
export class EventStreamConsumer {
  private redis: Redis;
  private store: MetricsStore;
  private discovery: Discovery;
  private prefix: string;
  private lastIds = new Map<string, string>();
  private running = false;
  private verbose: boolean;

  constructor(
    redis: Redis,
    store: MetricsStore,
    discovery: Discovery,
    prefix: string,
    verbose = false,
  ) {
    this.redis = redis;
    this.store = store;
    this.discovery = discovery;
    this.prefix = prefix;
    this.verbose = verbose;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Initialize lastIds for all known queues (start from $ = only new events)
    for (const queue of this.discovery.getQueues()) {
      if (!this.lastIds.has(queue)) {
        this.lastIds.set(queue, '$');
      }
    }

    // Listen for new queue discoveries
    this.discovery.on('queue:added', (name: string) => {
      if (!this.lastIds.has(name)) {
        this.lastIds.set(name, '$');
      }
    });

    // Start the read loop
    this.readLoop().catch((err) => {
      if (this.running) {
        console.error('[event-stream] Read loop crashed:', err);
      }
    });
  }

  stop(): void {
    this.running = false;
    // The XREAD BLOCK call will be interrupted when disconnect() is called
    // on the Redis connection by the adapter
  }

  private async readLoop(): Promise<void> {
    while (this.running) {
      try {
        const queues = this.discovery.getQueues();
        if (queues.length === 0) {
          // No queues yet — wait a bit and retry
          await sleep(2000);
          continue;
        }

        // Build XREAD args: BLOCK 5000 STREAMS key1 key2 ... id1 id2 ...
        const streamKeys = queues.map((q) => `${this.prefix}:${q}:events`);
        const streamIds = queues.map((q) => this.lastIds.get(q) ?? '$');

        const results = await this.redis.xread(
          'BLOCK', '5000',
          'STREAMS', ...streamKeys, ...streamIds,
        ) as [string, [string, string[]][]][] | null;

        if (!results) continue; // timeout, no new events

        for (const [streamKey, entries] of results) {
          // Extract queue name from stream key: {prefix}:{queueName}:events
          const queueName = this.extractQueueName(streamKey);
          if (!queueName) continue;

          for (const [streamId, fields] of entries) {
            // Update last ID for this queue
            this.lastIds.set(queueName, streamId);

            // Parse fields array into key-value pairs
            const data = this.parseFields(fields);
            const eventType = data.event || 'unknown';
            const jobId = data.jobId || '';

            // Build event record
            const event: EventRecord = {
              queue: queueName,
              eventType,
              jobId,
              jobName: data.name || null,
              ts: this.streamIdToTimestamp(streamId),
              data: JSON.stringify(data),
            };

            try {
              this.store.insertEvent(event);

              // For failed events, update error groups
              if (eventType === 'failed' && data.failedReason) {
                const signature = this.normalizeError(data.failedReason);
                this.store.upsertErrorGroup(
                  queueName,
                  signature,
                  data.failedReason,
                  jobId,
                );
              }

              if (this.verbose) {
                console.log(`[event-stream] ${queueName}: ${eventType} job=${jobId}`);
              }
            } catch (err) {
              console.error(`[event-stream] Failed to persist event:`, err);
            }
          }
        }
      } catch (err) {
        if (!this.running) return; // shutting down

        // Connection errors — wait and retry
        console.error('[event-stream] XREAD error:', err);
        await sleep(1000);
      }
    }
  }

  private extractQueueName(streamKey: string): string | null {
    // Key format: {prefix}:{queueName}:events
    const prefixPart = `${this.prefix}:`;
    const suffix = ':events';
    if (streamKey.startsWith(prefixPart) && streamKey.endsWith(suffix)) {
      return streamKey.slice(prefixPart.length, -suffix.length);
    }
    return null;
  }

  private parseFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      result[fields[i]!] = fields[i + 1] ?? '';
    }
    return result;
  }

  private streamIdToTimestamp(streamId: string): number {
    // Stream IDs have format: <timestamp>-<sequence>
    const dashIdx = streamId.indexOf('-');
    if (dashIdx !== -1) {
      return parseInt(streamId.slice(0, dashIdx), 10);
    }
    return Date.now();
  }

  /** Normalize error message for grouping — strip variable parts */
  private normalizeError(error: string): string {
    return error
      .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')   // hex IDs
      .replace(/\b\d{4,}\b/g, '<num>')           // long numbers
      .replace(/at .+:\d+:\d+/g, '<stack>')      // stack locations
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
