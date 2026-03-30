import { Redis } from 'ioredis';
import { Queue, Job } from 'bullmq';
import type { QueueAdapter } from './types.js';
import type {
  QueueSnapshot,
  FailedJob,
  JobDetail,
  ErrorGroup,
  OverdueDelayedJob,
} from '../types.js';

export class BullMQAdapter implements QueueAdapter {
  private cmd: Redis;      // reads: SCAN, LLEN, ZCARD, HGETALL, pipelines
  private stream: Redis;   // dedicated XREAD blocking consumer
  private ops: Redis;      // mutations: pause, resume, retry, clean
  private prefix: string;
  private queueInstances = new Map<string, Queue>();
  private clockSkewMs = 0;

  constructor(redisUrl: string, prefix = 'bull') {
    const connOpts = { maxRetriesPerRequest: null };
    this.cmd = new Redis(redisUrl, connOpts);
    this.stream = new Redis(redisUrl, { ...connOpts, enableReadyCheck: false });
    this.ops = new Redis(redisUrl, connOpts);
    this.prefix = prefix;
  }

  getStreamConnection(): Redis {
    return this.stream;
  }

  getCmdConnection(): Redis {
    return this.cmd;
  }

  /** Compare local clock with Redis TIME to detect skew. */
  async checkClockSkew(): Promise<void> {
    try {
      const result = await this.cmd.time();
      const redisTimeMs = Number(result[0]) * 1000 + Math.floor(Number(result[1]) / 1000);
      this.clockSkewMs = Date.now() - redisTimeMs;
      if (Math.abs(this.clockSkewMs) > 5000) {
        console.warn(
          `[damasqas] Clock skew detected: local clock is ${this.clockSkewMs > 0 ? 'ahead' : 'behind'} ` +
          `Redis by ${Math.abs(this.clockSkewMs)}ms. Overdue delayed detection will compensate.`,
        );
      }
    } catch {
      // Non-critical — proceed without skew compensation
    }
  }

  /** Current time adjusted for clock skew relative to Redis. */
  private adjustedNow(): number {
    return Date.now() - this.clockSkewMs;
  }

  async discoverQueues(): Promise<string[]> {
    const queues: string[] = [];
    let cursor = '0';

    do {
      const results = await this.cmd.call(
        'SCAN',
        cursor,
        'MATCH',
        `${this.prefix}:*:meta`,
        'TYPE',
        'hash',
        'COUNT',
        '200',
      ) as [string, string[]];
      cursor = results[0];
      const keys = results[1];

      for (const key of keys) {
        // Extract queue name from {prefix}:{name}:meta
        const name = key.slice(this.prefix.length + 1, -5); // remove prefix: and :meta
        if (name && !queues.includes(name)) {
          queues.push(name);
        }
      }
    } while (cursor !== '0');

    return queues.sort();
  }

  async getSnapshot(queue: string): Promise<QueueSnapshot> {
    const key = (suffix: string) => `${this.prefix}:${queue}:${suffix}`;
    const now = Date.now();
    const overdueUpperBound = this.adjustedNow() - 60_000;

    const pipeline = this.cmd.pipeline();
    pipeline.llen(key('wait'));           // 0
    pipeline.llen(key('active'));            // 1
    pipeline.zcard(key('completed'));        // 2
    pipeline.zcard(key('failed'));           // 3
    pipeline.zcard(key('delayed'));          // 4
    pipeline.hget(key('meta'), 'paused');    // 5
    pipeline.lindex(key('wait'), -1);     // 6: oldest waiting job ID
    pipeline.zcard(key('prioritized'));      // 7
    pipeline.llen(key('waiting-children')); // 8
    if (overdueUpperBound > 0) {
      pipeline.zcount(key('delayed'), '0', String(overdueUpperBound)); // 9
    }

    const results = await pipeline.exec();
    if (!results) throw new Error(`Failed to get snapshot for queue ${queue}`);

    const waiting = pipelineInt(results, 0);
    const active = pipelineInt(results, 1);
    const completed = pipelineInt(results, 2);
    const failed = pipelineInt(results, 3);
    const delayed = pipelineInt(results, 4);
    const paused = pipelineVal(results, 5) === '1';
    const oldestWaitingId = pipelineVal(results, 6) as string | null;
    const prioritized = pipelineInt(results, 7);
    const waitingChildren = pipelineInt(results, 8);
    const overdueDelayed = overdueUpperBound > 0 ? pipelineInt(results, 9) : 0;

    // Get oldest waiting age
    let oldestWaitingAge: number | null = null;
    if (oldestWaitingId) {
      const ts = await this.cmd.hget(key(oldestWaitingId), 'timestamp');
      if (ts) {
        oldestWaitingAge = now - parseInt(ts, 10);
      }
    }

    // Count locks and detect stalls
    const activeIds = active > 0
      ? await this.cmd.lrange(key('active'), 0, -1)
      : [];

    let locks = 0;
    let stalledCount = 0;

    if (activeIds.length > 0) {
      const lockPipeline = this.cmd.pipeline();
      for (const id of activeIds) {
        lockPipeline.exists(key(`${id}:lock`));
      }
      const lockResults = await lockPipeline.exec();
      if (lockResults) {
        for (const [err, result] of lockResults) {
          if (!err && result === 1) {
            locks++;
          } else if (!err) {
            stalledCount++;
          }
        }
      }
    }

    return {
      queue,
      timestamp: now,
      waiting,
      active,
      completed,
      failed,
      delayed,
      prioritized,
      waitingChildren,
      locks,
      stalledCount,
      overdueDelayed,
      oldestWaitingAge,
      paused,
      throughput1m: null,
      failRate1m: null,
      avgProcessMs: null,
      avgWaitMs: null,
    };
  }

  async getSnapshotBatch(queues: string[]): Promise<QueueSnapshot[]> {
    if (queues.length === 0) return [];

    const now = Date.now();
    const CMDS_PER_QUEUE = 9;

    // ── Phase 1: Core counts — single pipeline for all queues ──
    const p1 = this.cmd.pipeline();
    for (const queue of queues) {
      const key = (suffix: string) => `${this.prefix}:${queue}:${suffix}`;
      p1.llen(key('wait'));           // 0
      p1.llen(key('active'));            // 1
      p1.zcard(key('completed'));        // 2
      p1.zcard(key('failed'));           // 3
      p1.zcard(key('delayed'));          // 4
      p1.hget(key('meta'), 'paused');    // 5
      p1.lindex(key('wait'), -1);     // 6
      p1.zcard(key('prioritized'));      // 7
      p1.llen(key('waiting-children')); // 8
    }

    const r1 = await p1.exec();
    if (!r1) throw new Error('Batch snapshot pipeline failed');

    // Parse phase 1 results and collect IDs for phase 2 lookups
    interface QueuePhase1 {
      queue: string;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
      paused: boolean;
      oldestWaitingId: string | null;
      prioritized: number;
      waitingChildren: number;
    }

    const phase1: QueuePhase1[] = [];
    const oldestWaitingLookups: { queueIdx: number; jobKey: string }[] = [];

    for (let q = 0; q < queues.length; q++) {
      const offset = q * CMDS_PER_QUEUE;
      const queue = queues[q]!;
      const oldestWaitingId = pipelineVal(r1, offset + 6) as string | null;

      const data: QueuePhase1 = {
        queue,
        waiting: pipelineInt(r1, offset),
        active: pipelineInt(r1, offset + 1),
        completed: pipelineInt(r1, offset + 2),
        failed: pipelineInt(r1, offset + 3),
        delayed: pipelineInt(r1, offset + 4),
        paused: pipelineVal(r1, offset + 5) === '1',
        oldestWaitingId,
        prioritized: pipelineInt(r1, offset + 7),
        waitingChildren: pipelineInt(r1, offset + 8),
      };
      phase1.push(data);

      if (oldestWaitingId) {
        oldestWaitingLookups.push({
          queueIdx: q,
          jobKey: `${this.prefix}:${queue}:${oldestWaitingId}`,
        });
      }
    }

    // ── Phase 2: Oldest-waiting-age lookups — batched pipeline ──
    const oldestWaitingAges = new Map<number, number>();
    if (oldestWaitingLookups.length > 0) {
      const p2 = this.cmd.pipeline();
      for (const lookup of oldestWaitingLookups) {
        p2.hget(lookup.jobKey, 'timestamp');
      }
      const r2 = await p2.exec();
      if (r2) {
        for (let i = 0; i < oldestWaitingLookups.length; i++) {
          const ts = pipelineVal(r2, i) as string | null;
          if (ts) {
            oldestWaitingAges.set(
              oldestWaitingLookups[i]!.queueIdx,
              now - parseInt(ts, 10),
            );
          }
        }
      }
    }

    // ── Phase 3: Active job lock checks — batched pipeline ──
    // Collect all active job IDs across all queues in one LRANGE pipeline
    const activeQueues: { queueIdx: number; queue: string }[] = [];
    for (let q = 0; q < phase1.length; q++) {
      if (phase1[q]!.active > 0) {
        activeQueues.push({ queueIdx: q, queue: phase1[q]!.queue });
      }
    }

    const lockCounts = new Map<number, { locks: number; stalled: number }>();
    if (activeQueues.length > 0) {
      // First: get all active job IDs
      const pActive = this.cmd.pipeline();
      for (const { queue } of activeQueues) {
        pActive.lrange(`${this.prefix}:${queue}:active`, 0, -1);
      }
      const rActive = await pActive.exec();

      if (rActive) {
        // Flatten into lock-check pipeline
        const lockChecks: { queueIdx: number; count: number }[] = [];
        const pLock = this.cmd.pipeline();

        for (let i = 0; i < activeQueues.length; i++) {
          const err = rActive[i]![0];
          const ids = rActive[i]![1] as string[];
          if (err || !ids || ids.length === 0) {
            lockChecks.push({ queueIdx: activeQueues[i]!.queueIdx, count: 0 });
            continue;
          }
          lockChecks.push({ queueIdx: activeQueues[i]!.queueIdx, count: ids.length });
          const queue = activeQueues[i]!.queue;
          for (const id of ids) {
            pLock.exists(`${this.prefix}:${queue}:${id}:lock`);
          }
        }

        const rLock = await pLock.exec();
        if (rLock) {
          let lockIdx = 0;
          for (const { queueIdx, count } of lockChecks) {
            let locks = 0;
            let stalled = 0;
            for (let j = 0; j < count; j++) {
              const err = rLock[lockIdx]![0];
              const val = rLock[lockIdx]![1];
              if (!err && val === 1) locks++;
              else if (!err) stalled++;
              lockIdx++;
            }
            lockCounts.set(queueIdx, { locks, stalled });
          }
        }
      }
    }

    // ── Phase 4: Overdue delayed counts — single pipeline for all queues ──
    const overdueCounts = new Map<number, number>();
    const overdueUpperBound = this.adjustedNow() - 60_000;
    if (overdueUpperBound > 0) {
      const p4 = this.cmd.pipeline();
      for (const queue of queues) {
        p4.zcount(`${this.prefix}:${queue}:delayed`, '0', String(overdueUpperBound));
      }
      const r4 = await p4.exec();
      if (r4) {
        for (let q = 0; q < queues.length; q++) {
          overdueCounts.set(q, pipelineInt(r4, q));
        }
      }
    }

    // ── Assemble final snapshots ──
    const snapshots: QueueSnapshot[] = [];
    for (let q = 0; q < phase1.length; q++) {
      const d = phase1[q]!;
      const lc = lockCounts.get(q);

      snapshots.push({
        queue: d.queue,
        timestamp: now,
        waiting: d.waiting,
        active: d.active,
        completed: d.completed,
        failed: d.failed,
        delayed: d.delayed,
        prioritized: d.prioritized,
        waitingChildren: d.waitingChildren,
        locks: lc?.locks ?? 0,
        stalledCount: lc?.stalled ?? 0,
        overdueDelayed: overdueCounts.get(q) ?? 0,
        oldestWaitingAge: oldestWaitingAges.get(q) ?? null,
        paused: d.paused,
        throughput1m: null,
        failRate1m: null,
        avgProcessMs: null,
        avgWaitMs: null,
      });
    }

    return snapshots;
  }

  async getStalledJobs(queue: string): Promise<string[]> {
    const key = (suffix: string) => `${this.prefix}:${queue}:${suffix}`;
    const activeIds = await this.cmd.lrange(key('active'), 0, -1);

    if (activeIds.length === 0) return [];

    const pipeline = this.cmd.pipeline();
    for (const id of activeIds) {
      pipeline.exists(key(`${id}:lock`));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    return activeIds.filter((_: string, i: number) => !results[i]![0] && results[i]![1] === 0);
  }

  async getActiveLocks(queue: string): Promise<string[]> {
    const key = (suffix: string) => `${this.prefix}:${queue}:${suffix}`;
    const activeIds = await this.cmd.lrange(key('active'), 0, -1);

    if (activeIds.length === 0) return [];

    const pipeline = this.cmd.pipeline();
    for (const id of activeIds) {
      pipeline.exists(key(`${id}:lock`));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    return activeIds.filter((_: string, i: number) => !results[i]![0] && results[i]![1] === 1);
  }

  async getRecentFailed(
    queue: string,
    since: number,
    limit: number,
  ): Promise<FailedJob[]> {
    const key = `${this.prefix}:${queue}:failed`;
    const jobIds = await this.cmd.zrevrangebyscore(
      key,
      '+inf',
      String(since),
      'LIMIT',
      0,
      limit,
    );

    if (jobIds.length === 0) return [];

    const pipeline = this.cmd.pipeline();
    for (const id of jobIds) {
      pipeline.hmget(
        `${this.prefix}:${queue}:${id}`,
        'name',
        'failedReason',
        'timestamp',
        'finishedOn',
        'attemptsMade',
        'data',
      );
    }
    const results = await pipeline.exec();
    if (!results) return [];

    return jobIds.map((id: string, i: number) => {
      const err = results[i]![0];
      const fields = results[i]![1] as (string | null)[];
      if (err) return null;
      return {
        id,
        name: fields[0] || 'unknown',
        failedReason: fields[1] || 'Unknown error',
        timestamp: parseInt(fields[2] || '0', 10),
        finishedOn: fields[3] ? parseInt(fields[3], 10) : null,
        attemptsMade: parseInt(fields[4] || '0', 10),
        data: fields[5] || '{}',
      };
    }).filter((j): j is FailedJob => j !== null);
  }

  async getJobDetail(queue: string, jobId: string): Promise<JobDetail | null> {
    const data = await this.cmd.hgetall(
      `${this.prefix}:${queue}:${jobId}`,
    );
    if (!data || Object.keys(data).length === 0) return null;

    return {
      id: jobId,
      name: data.name || 'unknown',
      data: data.data || '{}',
      opts: data.opts || '{}',
      timestamp: parseInt(data.timestamp || '0', 10),
      processedOn: data.processedOn ? parseInt(data.processedOn, 10) : null,
      finishedOn: data.finishedOn ? parseInt(data.finishedOn, 10) : null,
      failedReason: data.failedReason || null,
      stacktrace: data.stacktrace || null,
      returnvalue: data.returnvalue || null,
      attemptsMade: parseInt(data.attemptsMade || '0', 10),
      delay: parseInt(data.delay || '0', 10),
      priority: parseInt(data.priority || '0', 10),
    };
  }

  async getErrorGroups(
    queue: string,
    since: number,
    limit: number,
  ): Promise<ErrorGroup[]> {
    const failedJobs = await this.getRecentFailed(queue, since, limit);

    const groups = new Map<string, { count: number; jobIds: string[] }>();
    for (const job of failedJobs) {
      const reason = job.failedReason || 'Unknown error';
      const existing = groups.get(reason);
      if (existing) {
        existing.count++;
        existing.jobIds.push(job.id);
      } else {
        groups.set(reason, { count: 1, jobIds: [job.id] });
      }
    }

    return Array.from(groups.entries())
      .map(([reason, { count, jobIds }]) => ({ reason, count, jobIds }))
      .sort((a, b) => b.count - a.count);
  }

  async getJobsByStatus(
    queue: string,
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    limit: number,
    offset: number,
  ): Promise<JobDetail[]> {
    // BullMQ uses 'wait' as the key name, not 'waiting'
    const keyName = status === 'waiting' ? 'wait' : status;
    const key = `${this.prefix}:${queue}:${keyName}`;
    let jobIds: string[];

    if (status === 'waiting' || status === 'active') {
      jobIds = await this.cmd.lrange(key, offset, offset + limit - 1);
    } else {
      // Sorted sets: completed, failed, delayed
      jobIds = await this.cmd.zrevrange(key, offset, offset + limit - 1);
    }

    if (jobIds.length === 0) return [];

    const details: JobDetail[] = [];
    for (const id of jobIds) {
      const detail = await this.getJobDetail(queue, id);
      if (detail) details.push(detail);
    }
    return details;
  }

  async getCompletedCountSince(queue: string, since: number): Promise<number> {
    return this.cmd.zcount(
      `${this.prefix}:${queue}:completed`,
      String(since),
      '+inf',
    );
  }

  async getFailedCountSince(queue: string, since: number): Promise<number> {
    return this.cmd.zcount(
      `${this.prefix}:${queue}:failed`,
      String(since),
      '+inf',
    );
  }

  async getRecentProcessingTimes(
    queue: string,
    limit: number,
  ): Promise<number[]> {
    const key = `${this.prefix}:${queue}:completed`;
    const jobIds = await this.cmd.zrevrange(key, 0, limit - 1);

    if (jobIds.length === 0) return [];

    const pipeline = this.cmd.pipeline();
    for (const id of jobIds) {
      pipeline.hmget(
        `${this.prefix}:${queue}:${id}`,
        'processedOn',
        'finishedOn',
      );
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const times: number[] = [];
    for (const [err, result] of results) {
      if (err) continue;
      const fields = result as (string | null)[];
      if (fields[0] && fields[1]) {
        const duration = parseInt(fields[1], 10) - parseInt(fields[0], 10);
        if (duration > 0) times.push(duration);
      }
    }
    return times;
  }

  // Write operations use the ops connection via BullMQ Queue class.
  // All Queue instances share a single ops connection (no duplicate()).
  private getQueue(name: string): Queue {
    let q = this.queueInstances.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.ops,
        prefix: this.prefix,
      });
      this.queueInstances.set(name, q);
    }
    return q;
  }

  async pauseQueue(queue: string): Promise<void> {
    await this.getQueue(queue).pause();
  }

  async resumeQueue(queue: string): Promise<void> {
    await this.getQueue(queue).resume();
  }

  async retryJob(queue: string, jobId: string): Promise<void> {
    const q = this.getQueue(queue);
    const job = await Job.fromId(q, jobId);
    if (job) await job.retry();
  }

  async removeJob(queue: string, jobId: string): Promise<void> {
    const q = this.getQueue(queue);
    const job = await Job.fromId(q, jobId);
    if (job) await job.remove();
  }

  async promoteJob(queue: string, jobId: string): Promise<void> {
    const q = this.getQueue(queue);
    const job = await Job.fromId(q, jobId);
    if (job) await job.promote();
  }

  async cleanJobs(
    queue: string,
    status: 'completed' | 'failed',
    grace: number,
    limit: number,
  ): Promise<number> {
    const deleted = await this.getQueue(queue).clean(grace, limit, status);
    return deleted.length;
  }

  async retryAllFailed(queue: string): Promise<number> {
    const key = `${this.prefix}:${queue}:failed`;
    const jobIds = await this.cmd.zrange(key, 0, -1);
    const q = this.getQueue(queue);

    let count = 0;
    for (const id of jobIds) {
      try {
        const job = await Job.fromId(q, id);
        if (job) {
          await job.retry();
          count++;
        }
      } catch {
        // Skip jobs that can't be retried
      }
    }
    return count;
  }

  async getOverdueDelayedCount(queue: string): Promise<number> {
    const overdueUpperBound = this.adjustedNow() - 60_000;
    if (overdueUpperBound <= 0) return 0;
    return this.cmd.zcount(
      `${this.prefix}:${queue}:delayed`,
      '0',
      String(overdueUpperBound),
    );
  }

  async getOverdueDelayedJobs(queue: string, limit = 20): Promise<OverdueDelayedJob[]> {
    const overdueUpperBound = this.adjustedNow() - 60_000;
    if (overdueUpperBound <= 0) return [];
    const key = `${this.prefix}:${queue}:delayed`;

    // ZRANGEBYSCORE with WITHSCORES returns [id, score, id, score, ...]
    const raw = await this.cmd.zrangebyscore(
      key, '0', String(overdueUpperBound),
      'WITHSCORES', 'LIMIT', 0, limit,
    ) as string[];

    if (raw.length === 0) return [];

    // Parse ID/score pairs
    const entries: { id: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ id: raw[i]!, score: parseInt(raw[i + 1]!, 10) });
    }

    // Hydrate jobs via pipelined HMGET
    const pipeline = this.cmd.pipeline();
    for (const { id } of entries) {
      pipeline.hmget(`${this.prefix}:${queue}:${id}`, 'name', 'delay', 'timestamp');
    }
    const results = await pipeline.exec();

    const jobs: OverdueDelayedJob[] = [];
    // Use adjustedNow() so overdueByMs is relative to the same clock domain
    // (Redis time) as the ZRANGEBYSCORE filter. Without this, clock skew causes
    // the alert engine threshold check to disagree with the ZRANGEBYSCORE filter.
    const now = this.adjustedNow();
    for (let i = 0; i < entries.length; i++) {
      const { id, score } = entries[i]!;
      const err = results?.[i]?.[0];
      const fields = results?.[i]?.[1] as (string | null)[] | undefined;
      if (err || !fields) continue;

      const scheduledFor = score; // The sorted set score IS the target timestamp
      jobs.push({
        id,
        name: fields[0] || 'unknown',
        delay: parseInt(fields[1] || '0', 10),
        timestamp: parseInt(fields[2] || '0', 10),
        scheduledFor,
        overdueByMs: now - scheduledFor,
      });
    }

    return jobs;
  }

  async promoteAllOverdue(queue: string, limit = 100): Promise<number> {
    // No 60s grace period here — when the user explicitly promotes, we promote
    // everything past its scheduled time, not just what we'd alert on.
    const now = this.adjustedNow();
    const key = `${this.prefix}:${queue}:delayed`;
    const jobIds = await this.cmd.zrangebyscore(key, '0', String(now), 'LIMIT', 0, limit) as string[];

    if (jobIds.length === 0) return 0;

    const q = this.getQueue(queue);
    let count = 0;
    for (const id of jobIds) {
      try {
        const job = await Job.fromId(q, id);
        if (job) {
          await job.promote();
          count++;
        }
      } catch {
        // Skip jobs that can't be promoted
      }
    }
    return count;
  }

  async disconnect(): Promise<void> {
    for (const q of this.queueInstances.values()) {
      await q.close();
    }
    this.queueInstances.clear();
    this.cmd.disconnect();
    this.stream.disconnect();
    this.ops.disconnect();
  }
}

/**
 * Safely extract an integer from a pipeline result, checking for errors.
 * ioredis pipeline exec() returns [Error | null, result][] tuples.
 */
function pipelineInt(results: [Error | null, unknown][], idx: number): number {
  const [err, val] = results[idx]!;
  if (err) return 0;
  return (val as number) || 0;
}

function pipelineVal(results: [Error | null, unknown][], idx: number): unknown {
  const [err, val] = results[idx]!;
  if (err) return null;
  return val;
}
