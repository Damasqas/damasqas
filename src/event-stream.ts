import type { Redis } from 'ioredis';
import type { MetricsStore } from './store.js';
import type { Discovery } from './discovery.js';
import type { EventRecord, JobTimingRecord } from './types.js';

/**
 * EventStreamConsumer uses a dedicated Redis connection to run blocking
 * XREAD across all discovered queue event streams. Events are persisted
 * to the SQLite events table and FTS index.
 *
 * BullMQ publishes events to {prefix}:{queueName}:events as a Redis Stream.
 * Stream entry fields: event (type), jobId, prev (previous state), plus
 * event-specific fields like failedReason, returnvalue, etc.
 *
 * Features:
 * - Cursor persistence: resumes from last-read stream ID across restarts
 * - XREAD chunking: groups of 20 queues per XREAD call for scalability
 * - Job name hydration: batch HGET every 5s to resolve job names
 */
export class EventStreamConsumer {
  private redis: Redis;
  private cmdRedis: Redis;
  private store: MetricsStore;
  private discovery: Discovery;
  private prefix: string;
  private lastIds = new Map<string, string>();
  private running = false;
  private verbose: boolean;
  private hydrateTimer: ReturnType<typeof setInterval> | null = null;
  private timingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    redis: Redis,
    cmdRedis: Redis,
    store: MetricsStore,
    discovery: Discovery,
    prefix: string,
    verbose = false,
  ) {
    this.redis = redis;
    this.cmdRedis = cmdRedis;
    this.store = store;
    this.discovery = discovery;
    this.prefix = prefix;
    this.verbose = verbose;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Load persisted cursors from SQLite
    const persistedCursors = this.store.getAllStreamCursors();

    // Initialize lastIds for all known queues
    for (const queue of this.discovery.getQueues()) {
      const cursor = persistedCursors.get(queue);
      this.lastIds.set(queue, cursor ?? '0-0');
    }

    // Listen for new queue discoveries
    this.discovery.on('queue:added', (name: string) => {
      if (!this.lastIds.has(name)) {
        this.lastIds.set(name, '0-0');
      }
    });

    // Start the read loop
    this.readLoop().catch((err) => {
      if (this.running) {
        console.error('[event-stream] Read loop crashed:', err);
      }
    });

    // Start the job name hydration loop (every 5 seconds)
    this.hydrateTimer = setInterval(() => {
      this.hydrateJobNames().catch((err) => {
        console.error('[event-stream] Hydration error:', err);
      });
    }, 5000);

    // Start the job timing hydration loop (every 10 seconds)
    this.timingTimer = setInterval(() => {
      this.hydrateJobTimings().catch((err) => {
        console.error('[event-stream] Timing hydration error:', err);
      });
    }, 10000);
  }

  stop(): void {
    this.running = false;

    if (this.hydrateTimer) {
      clearInterval(this.hydrateTimer);
      this.hydrateTimer = null;
    }
    if (this.timingTimer) {
      clearInterval(this.timingTimer);
      this.timingTimer = null;
    }

    // Force-disconnect to interrupt any pending XREAD BLOCK.
    try {
      this.redis.disconnect();
    } catch {
      // Already disconnected
    }
  }

  private async readLoop(): Promise<void> {
    while (this.running) {
      try {
        const queues = this.discovery.getQueues();
        if (queues.length === 0) {
          await sleep(2000);
          continue;
        }

        // Chunk queues into groups of 20 for XREAD scalability.
        const chunks = chunkArray(queues, 20);

        let gotData = false;

        if (chunks.length === 1) {
          // Single chunk: use BLOCK for efficiency — one XREAD call
          // blocks the connection waiting for data, no busy-polling.
          const results = await this.xreadChunk(chunks[0]!, true);
          if (results) {
            gotData = true;
            this.processXreadResults(results);
          }
        } else {
          // Multiple chunks: CANNOT use BLOCK. Redis processes commands
          // sequentially on a single connection, so concurrent BLOCK calls
          // would serialize (chunk1 blocks 5s, then chunk2 blocks 5s, etc.)
          // giving O(N * timeout) latency. Use non-blocking XREAD instead
          // and sleep at the end if there was no data.
          const allResults = await Promise.all(
            chunks.map((chunk) => this.xreadChunk(chunk, false)),
          );

          for (const results of allResults) {
            if (results) {
              gotData = true;
              this.processXreadResults(results);
            }
          }

          // If no data from any chunk, sleep to avoid busy-polling.
          // This approximates the BLOCK behavior.
          if (!gotData) {
            await sleep(2000);
          }
        }
      } catch (err) {
        if (!this.running) return;
        console.error('[event-stream] XREAD error:', err);
        await sleep(1000);
      }
    }
  }

  private processXreadResults(
    results: [string, [string, string[]][]][],
  ): void {
    for (const [streamKey, entries] of results) {
      const queueName = this.extractQueueName(streamKey);
      if (!queueName) continue;

      let lastIdForQueue: string | undefined;

      for (const [streamId, fields] of entries) {
        lastIdForQueue = streamId;
        this.lastIds.set(queueName, streamId);

        const data = this.parseFields(fields);
        const eventType = data.event || 'unknown';
        const jobId = data.jobId || '';

        const event: EventRecord = {
          queue: queueName,
          eventType,
          jobId,
          jobName: null,
          ts: this.streamIdToTimestamp(streamId),
          data: JSON.stringify(data),
        };

        try {
          this.store.insertEvent(event);

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

      // Persist cursor after processing all entries for this queue
      if (lastIdForQueue) {
        try {
          this.store.setStreamCursor(queueName, lastIdForQueue);
        } catch (err) {
          console.error(`[event-stream] Failed to persist cursor:`, err);
        }
      }
    }
  }

  private async xreadChunk(
    queues: string[],
    block: boolean,
  ): Promise<[string, [string, string[]][]][] | null> {
    const streamKeys = queues.map((q) => `${this.prefix}:${q}:events`);
    const streamIds = queues.map((q) => this.lastIds.get(q) ?? '0-0');

    if (block) {
      return await (this.redis.xread as Function)(
        'BLOCK', 5000,
        'COUNT', 100,
        'STREAMS', ...streamKeys, ...streamIds,
      ) as [string, [string, string[]][]][] | null;
    }

    // Non-blocking: no BLOCK keyword, returns immediately
    return await (this.redis.xread as Function)(
      'COUNT', 100,
      'STREAMS', ...streamKeys, ...streamIds,
    ) as [string, [string, string[]][]][] | null;
  }

  /**
   * Batch-hydrate job names for events with NULL job_name.
   * Collects unhydrated job IDs across ALL queues, then issues a single
   * pipelined HGET batch to Redis. This is O(1) round-trips regardless
   * of queue count.
   */
  private async hydrateJobNames(): Promise<void> {
    const queues = this.discovery.getQueues();

    // Collect all (queue, jobId) pairs in one pass
    const work: { queue: string; jobId: string }[] = [];
    for (const queue of queues) {
      const jobIds = this.store.getUnhydratedEventJobIds(queue);
      for (const jobId of jobIds) {
        work.push({ queue, jobId });
      }
    }

    if (work.length === 0) return;

    // Single pipeline for all HGET calls across all queues
    const pipeline = this.cmdRedis.pipeline();
    for (const { queue, jobId } of work) {
      pipeline.hget(`${this.prefix}:${queue}:${jobId}`, 'name');
    }

    const results = await pipeline.exec();
    if (!results) return;

    const updates: { queue: string; jobId: string; jobName: string }[] = [];
    for (let i = 0; i < work.length; i++) {
      const [err, name] = results[i]!;
      const resolvedName = err ? '[error]' : ((name as string) || '[deleted]');
      updates.push({ queue: work[i]!.queue, jobId: work[i]!.jobId, jobName: resolvedName });
    }

    this.store.batchUpdateJobNames(updates);

    if (this.verbose && updates.length > 0) {
      console.log(`[event-stream] Hydrated ${updates.length} job names across ${queues.length} queues`);
    }
  }

  /**
   * Batch-hydrate job timings for completed events that don't yet have
   * timing data in the job_timings table. Fetches timestamp, processedOn,
   * and finishedOn from Redis job hashes and computes wait/process times.
   */
  private async hydrateJobTimings(): Promise<void> {
    const queues = this.discovery.getQueues();

    // Collect all (queue, jobId) pairs for completed events without timings
    const work: { id: number; queue: string; jobId: string; ts: number }[] = [];
    for (const queue of queues) {
      const events = this.store.getUnhydratedTimingEvents(queue);
      for (const event of events) {
        work.push(event);
      }
    }

    if (work.length === 0) return;

    // Single pipeline for all HMGET calls
    const pipeline = this.cmdRedis.pipeline();
    for (const { queue, jobId } of work) {
      pipeline.hmget(`${this.prefix}:${queue}:${jobId}`, 'timestamp', 'processedOn', 'finishedOn', 'name');
    }

    const results = await pipeline.exec();
    if (!results) return;

    const timings: JobTimingRecord[] = [];
    for (let i = 0; i < work.length; i++) {
      const [err, fields] = results[i]!;
      if (err || !fields) continue;

      const [timestamp, processedOn, finishedOn, name] = fields as (string | null)[];
      if (!timestamp || !processedOn || !finishedOn) continue;

      const ts = Number(timestamp);
      const processed = Number(processedOn);
      const finished = Number(finishedOn);

      if (isNaN(ts) || isNaN(processed) || isNaN(finished)) continue;

      const waitMs = processed - ts;
      const processMs = finished - processed;

      // Skip clearly invalid values (negative or impossibly large)
      if (waitMs < 0 || processMs < 0) continue;

      timings.push({
        queue: work[i]!.queue,
        jobName: name || '[unknown]',
        jobId: work[i]!.jobId,
        ts: work[i]!.ts,
        waitMs,
        processMs,
      });
    }

    if (timings.length > 0) {
      this.store.batchInsertJobTimings(timings);

      if (this.verbose) {
        console.log(`[event-stream] Hydrated ${timings.length} job timings across ${queues.length} queues`);
      }
    }
  }

  private extractQueueName(streamKey: string): string | null {
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
