import { Redis } from 'ioredis';
import { Queue, Job } from 'bullmq';
import type { QueueAdapter } from './types.js';
import type {
  QueueSnapshot,
  FailedJob,
  JobDetail,
  ErrorGroup,
} from '../types.js';

export class BullMQAdapter implements QueueAdapter {
  private redis: Redis;
  private prefix: string;
  private queueInstances = new Map<string, Queue>();

  constructor(redisUrl: string, prefix = 'bull') {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.prefix = prefix;
  }

  async discoverQueues(): Promise<string[]> {
    const queues: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.prefix}:*:meta`,
        'COUNT',
        100,
      );
      cursor = nextCursor;

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

    const pipeline = this.redis.pipeline();
    pipeline.llen(key('waiting'));        // 0
    pipeline.llen(key('active'));         // 1
    pipeline.zcard(key('completed'));     // 2
    pipeline.zcard(key('failed'));        // 3
    pipeline.zcard(key('delayed'));       // 4
    pipeline.hget(key('meta'), 'paused');  // 5
    pipeline.lindex(key('waiting'), -1);  // 6: oldest waiting job ID

    const results = await pipeline.exec();
    if (!results) throw new Error(`Failed to get snapshot for queue ${queue}`);

    const waiting = (results[0]![1] as number) || 0;
    const active = (results[1]![1] as number) || 0;
    const completed = (results[2]![1] as number) || 0;
    const failed = (results[3]![1] as number) || 0;
    const delayed = (results[4]![1] as number) || 0;
    const paused = results[5]![1] === '1';
    const oldestWaitingId = results[6]![1] as string | null;

    // Get oldest waiting age
    let oldestWaitingAge: number | null = null;
    if (oldestWaitingId) {
      const ts = await this.redis.hget(key(oldestWaitingId), 'timestamp');
      if (ts) {
        oldestWaitingAge = now - parseInt(ts, 10);
      }
    }

    // Count locks and detect stalls
    const activeIds = active > 0
      ? await this.redis.lrange(key('active'), 0, -1)
      : [];

    let locks = 0;
    let stalledCount = 0;

    if (activeIds.length > 0) {
      const lockPipeline = this.redis.pipeline();
      for (const id of activeIds) {
        lockPipeline.exists(key(`${id}:lock`));
      }
      const lockResults = await lockPipeline.exec();
      if (lockResults) {
        for (const [, result] of lockResults) {
          if (result === 1) {
            locks++;
          } else {
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
      locks,
      stalledCount,
      oldestWaitingAge,
      paused,
    };
  }

  async getStalledJobs(queue: string): Promise<string[]> {
    const key = (suffix: string) => `${this.prefix}:${queue}:${suffix}`;
    const activeIds = await this.redis.lrange(key('active'), 0, -1);

    if (activeIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const id of activeIds) {
      pipeline.exists(key(`${id}:lock`));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    return activeIds.filter((_: string, i: number) => results[i]![1] === 0);
  }

  async getActiveLocks(queue: string): Promise<string[]> {
    const key = (suffix: string) => `${this.prefix}:${queue}:${suffix}`;
    const activeIds = await this.redis.lrange(key('active'), 0, -1);

    if (activeIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const id of activeIds) {
      pipeline.exists(key(`${id}:lock`));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    return activeIds.filter((_: string, i: number) => results[i]![1] === 1);
  }

  async getRecentFailed(
    queue: string,
    since: number,
    limit: number,
  ): Promise<FailedJob[]> {
    const key = `${this.prefix}:${queue}:failed`;
    const jobIds = await this.redis.zrevrangebyscore(
      key,
      '+inf',
      String(since),
      'LIMIT',
      0,
      limit,
    );

    if (jobIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
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
      const fields = results[i]![1] as (string | null)[];
      return {
        id,
        name: fields[0] || 'unknown',
        failedReason: fields[1] || 'Unknown error',
        timestamp: parseInt(fields[2] || '0', 10),
        finishedOn: fields[3] ? parseInt(fields[3], 10) : null,
        attemptsMade: parseInt(fields[4] || '0', 10),
        data: fields[5] || '{}',
      };
    });
  }

  async getJobDetail(queue: string, jobId: string): Promise<JobDetail | null> {
    const data = await this.redis.hgetall(
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
    const key = `${this.prefix}:${queue}:${status}`;
    let jobIds: string[];

    if (status === 'waiting' || status === 'active') {
      jobIds = await this.redis.lrange(key, offset, offset + limit - 1);
    } else {
      // Sorted sets: completed, failed, delayed
      jobIds = await this.redis.zrevrange(key, offset, offset + limit - 1);
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
    return this.redis.zcount(
      `${this.prefix}:${queue}:completed`,
      String(since),
      '+inf',
    );
  }

  async getFailedCountSince(queue: string, since: number): Promise<number> {
    return this.redis.zcount(
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
    const jobIds = await this.redis.zrevrange(key, 0, limit - 1);

    if (jobIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
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
    for (const [, result] of results) {
      const fields = result as (string | null)[];
      if (fields[0] && fields[1]) {
        const duration = parseInt(fields[1], 10) - parseInt(fields[0], 10);
        if (duration > 0) times.push(duration);
      }
    }
    return times;
  }

  // Write operations use BullMQ Queue class
  private getQueue(name: string): Queue {
    let q = this.queueInstances.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.redis.duplicate(),
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
    const jobIds = await this.redis.zrange(key, 0, -1);
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

  async disconnect(): Promise<void> {
    for (const q of this.queueInstances.values()) {
      await q.close();
    }
    this.queueInstances.clear();
    this.redis.disconnect();
  }
}
