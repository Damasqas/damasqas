import type { Redis } from 'ioredis';
import type { FlowNode, FlowJobState, Deadlock, WaitingChildrenJob } from './types.js';

const MAX_TREE_DEPTH = 10;
const MAX_TREE_NODES = 200;
const MAX_PARENT_WALK = 20;
const WAITING_CHILDREN_SCAN_LIMIT = 100;

/**
 * Inspects BullMQ flow (parent-child) job relationships and detects deadlocks.
 *
 * Flow relationships are stored across Redis keys:
 *   - Job hash field `parentKey`: the Redis key of the parent job
 *   - `bull:<queue>:<jobId>:dependencies`: pending child job keys (SET)
 *   - `bull:<queue>:<jobId>:processed`: completed child job keys (HASH: key→returnvalue)
 *   - `bull:<queue>:<jobId>:failed`: failed child job keys (HASH: key→failedReason)
 *
 * This class uses the adapter's cmd (read) connection directly since flow
 * inspection cross-cuts queues.
 */
export class FlowInspector {
  private cmd: Redis;
  private prefix: string;
  private cachedDeadlocks: Deadlock[] = [];
  private lastDeadlockScanTs = 0;

  constructor(cmd: Redis, prefix: string) {
    this.cmd = cmd;
    this.prefix = prefix;
  }

  getDeadlocks(): Deadlock[] {
    return this.cachedDeadlocks;
  }

  getLastDeadlockScanTs(): number {
    return this.lastDeadlockScanTs;
  }

  /**
   * Build a flow tree starting from a given job. Walks up to the root parent,
   * then recursively builds the full child tree.
   */
  async getFlowTree(queue: string, jobId: string): Promise<FlowNode> {
    const root = await this.findFlowRoot(queue, jobId);
    const tree = await this.buildChildTree(root.queue, root.jobId, 0, { count: 0 }, new Set());
    return tree;
  }

  /**
   * List jobs currently in the waiting-children state for a queue.
   */
  async getWaitingChildrenJobs(queue: string, limit = 50): Promise<WaitingChildrenJob[]> {
    const key = `${this.prefix}:${queue}:waiting-children`;
    const ids = await this.cmd.zrange(key, 0, limit - 1);
    if (ids.length === 0) return [];

    // Batch fetch job hashes and dependency counts
    const p = this.cmd.pipeline();
    for (const id of ids) {
      p.hmget(`${this.prefix}:${queue}:${id}`, 'name', 'timestamp');
      p.scard(`${this.prefix}:${queue}:${id}:dependencies`);   // SET
      p.hlen(`${this.prefix}:${queue}:${id}:processed`);       // HASH
      p.hlen(`${this.prefix}:${queue}:${id}:failed`);           // HASH
    }
    const results = await p.exec();
    if (!results) return [];

    const jobs: WaitingChildrenJob[] = [];
    for (let i = 0; i < ids.length; i++) {
      const offset = i * 4;
      const [, fields] = results[offset]!;
      const [, pending] = results[offset + 1]!;
      const [, processed] = results[offset + 2]!;
      const [, failed] = results[offset + 3]!;

      const [name, timestamp] = (fields as (string | null)[]) || [];
      jobs.push({
        queue,
        jobId: ids[i]!,
        name: name || '[unknown]',
        timestamp: timestamp ? parseInt(timestamp, 10) : 0,
        pendingChildren: (pending as number) || 0,
        completedChildren: (processed as number) || 0,
        failedChildren: (failed as number) || 0,
      });
    }

    return jobs;
  }

  /**
   * Scan all queues for deadlocked flows: parent jobs in waiting-children state
   * that have failed children with no retries remaining and no failParentOnFailure.
   */
  async detectDeadlocks(queues: string[]): Promise<Deadlock[]> {
    const deadlocks: Deadlock[] = [];

    for (const queue of queues) {
      try {
        const key = `${this.prefix}:${queue}:waiting-children`;
        const parentIds = await this.cmd.zrange(key, 0, WAITING_CHILDREN_SCAN_LIMIT - 1);

        if (parentIds.length === 0) continue;

        // Batch: get parent hashes and pending dependencies + failed children
        const p1 = this.cmd.pipeline();
        for (const parentId of parentIds) {
          p1.hmget(`${this.prefix}:${queue}:${parentId}`, 'name', 'timestamp');
          p1.smembers(`${this.prefix}:${queue}:${parentId}:dependencies`);
          p1.hkeys(`${this.prefix}:${queue}:${parentId}:failed`);
        }
        const r1 = await p1.exec();
        if (!r1) continue;

        // Collect all unique child keys that need state checking
        interface ParentInfo {
          parentId: string;
          parentName: string;
          parentTs: number;
          childKeys: string[];
        }
        const parents: ParentInfo[] = [];

        for (let i = 0; i < parentIds.length; i++) {
          const offset = i * 3;
          const [, fields] = r1[offset]!;
          const [, deps] = r1[offset + 1]!;
          const [, failedChildKeys] = r1[offset + 2]!;
          const [name, timestamp] = (fields as (string | null)[]) || [];
          const pendingKeys = (deps as string[]) || [];
          const failedKeys = (failedChildKeys as string[]) || [];
          const childKeys = [...new Set([...pendingKeys, ...failedKeys])];

          if (childKeys.length > 0) {
            parents.push({
              parentId: parentIds[i]!,
              parentName: name || '[unknown]',
              parentTs: timestamp ? parseInt(timestamp, 10) : 0,
              childKeys,
            });
          }
        }

        // Batch: for each child key, determine state and get job details
        const allChildKeys: { parentIdx: number; childQueue: string; childJobId: string }[] = [];
        for (let pi = 0; pi < parents.length; pi++) {
          for (const depKey of parents[pi]!.childKeys) {
            const parsed = this.parseJobKey(depKey);
            if (parsed) {
              allChildKeys.push({ parentIdx: pi, childQueue: parsed.queue, childJobId: parsed.jobId });
            }
          }
        }

        if (allChildKeys.length === 0) continue;

        // Pipeline: check if each child is in the failed sorted set + get job hash
        const p2 = this.cmd.pipeline();
        for (const child of allChildKeys) {
          p2.zscore(`${this.prefix}:${child.childQueue}:failed`, child.childJobId);
          p2.hmget(
            `${this.prefix}:${child.childQueue}:${child.childJobId}`,
            'name', 'failedReason', 'attemptsMade', 'opts',
          );
        }
        const r2 = await p2.exec();
        if (!r2) continue;

        for (let ci = 0; ci < allChildKeys.length; ci++) {
          const offset = ci * 2;
          const [, failedScore] = r2[offset]!;
          const [, childFields] = r2[offset + 1]!;

          if (failedScore === null) continue; // not failed

          const child = allChildKeys[ci]!;
          const parent = parents[child.parentIdx]!;
          const [childName, failedReason, attemptsMade, optsStr] =
            (childFields as (string | null)[]) || [];

          const opts = safeParseJson(optsStr);
          const maxAttempts = Number(opts.attempts) || 1;
          const attempts = parseInt(attemptsMade || '0', 10);

          if (attempts >= maxAttempts) {
            deadlocks.push({
              parentQueue: queue,
              parentJobId: parent.parentId,
              parentName: parent.parentName,
              childQueue: child.childQueue,
              childJobId: child.childJobId,
              childName: childName || '[unknown]',
              childError: failedReason || '[no error message]',
              blockedSince: parent.parentTs,
              hasFailParentOnFailure: !!opts.failParentOnFailure,
            });
          }
        }
      } catch (err) {
        console.error(`[flow] Deadlock scan error for queue ${queue}:`, err);
      }
    }

    this.cachedDeadlocks = deadlocks;
    this.lastDeadlockScanTs = Date.now();
    return deadlocks;
  }

  /**
   * Walk up the parent chain from a given job to find the root of the flow.
   */
  private async findFlowRoot(
    queue: string,
    jobId: string,
  ): Promise<{ queue: string; jobId: string }> {
    let currentQueue = queue;
    let currentJobId = jobId;
    const visited = new Set<string>();

    for (let i = 0; i < MAX_PARENT_WALK; i++) {
      const visitKey = `${currentQueue}:${currentJobId}`;
      if (visited.has(visitKey)) break; // cycle in parent chain
      visited.add(visitKey);

      const parentKey = await this.cmd.hget(
        `${this.prefix}:${currentQueue}:${currentJobId}`,
        'parentKey',
      );

      if (!parentKey) break;

      const parsed = this.parseJobKey(parentKey);
      if (!parsed) break;

      currentQueue = parsed.queue;
      currentJobId = parsed.jobId;
    }

    return { queue: currentQueue, jobId: currentJobId };
  }

  /**
   * Recursively build the flow tree from a parent job downward.
   */
  private async buildChildTree(
    queue: string,
    jobId: string,
    depth: number,
    counter: { count: number },
    visited: Set<string>,
  ): Promise<FlowNode> {
    counter.count++;

    const visitKey = `${queue}:${jobId}`;
    if (visited.has(visitKey)) {
      return makeUnknownNode(jobId, queue); // cycle detected
    }
    visited.add(visitKey);

    if (depth >= MAX_TREE_DEPTH || counter.count >= MAX_TREE_NODES) {
      return {
        jobId,
        queue,
        name: '[truncated]',
        state: 'unknown',
        attemptsMade: 0,
        maxAttempts: 1,
        children: [],
        isBlocker: false,
        isDeadlocked: false,
        truncated: true,
      };
    }

    // Pipeline: get job hash + dependency keys + state
    const jobKey = `${this.prefix}:${queue}:${jobId}`;
    const p = this.cmd.pipeline();
    p.hgetall(jobKey);
    p.smembers(`${jobKey}:dependencies`);         // SET
    p.hkeys(`${jobKey}:processed`);               // HASH → keys only
    p.hkeys(`${jobKey}:failed`);                  // HASH → keys only
    // State determination commands
    p.zscore(`${this.prefix}:${queue}:completed`, jobId);       // 4
    p.zscore(`${this.prefix}:${queue}:failed`, jobId);          // 5
    p.zscore(`${this.prefix}:${queue}:delayed`, jobId);         // 6
    p.zscore(`${this.prefix}:${queue}:prioritized`, jobId);     // 7
    p.zscore(`${this.prefix}:${queue}:waiting-children`, jobId); // 8
    p.lpos(`${this.prefix}:${queue}:wait`, jobId);              // 9
    p.exists(jobKey);                                            // 10
    p.exists(`${jobKey}:lock`);                                  // 11

    const results = await p.exec();
    if (!results) {
      return makeUnknownNode(jobId, queue);
    }

    const jobData = (results[0]![1] as Record<string, string>) || {};
    const pendingKeys = (results[1]![1] as string[]) || [];
    const processedKeys = (results[2]![1] as string[]) || [];
    const failedKeys = (results[3]![1] as string[]) || [];
    const state = resolveState(results, 4);

    const name = jobData.name || '[unknown]';
    const opts = safeParseJson(jobData.opts);
    const attemptsMade = parseInt(jobData.attemptsMade || '0', 10);
    const maxAttempts = Number(opts.attempts) || 1;

    // Combine all child keys (pending + processed + failed) and deduplicate
    const allChildKeys = [...new Set([...pendingKeys, ...processedKeys, ...failedKeys])];

    // Recursively build children
    const children: FlowNode[] = [];
    for (const childKey of allChildKeys) {
      const parsed = this.parseJobKey(childKey);
      if (!parsed) continue;
      if (counter.count >= MAX_TREE_NODES) {
        children.push({
          jobId: parsed.jobId,
          queue: parsed.queue,
          name: '[truncated]',
          state: 'unknown',
          attemptsMade: 0,
          maxAttempts: 1,
          children: [],
          isBlocker: false,
          isDeadlocked: false,
          truncated: true,
        });
        break;
      }
      children.push(await this.buildChildTree(parsed.queue, parsed.jobId, depth + 1, counter, visited));
    }

    const isLeaf = children.length === 0;
    const isBlocker = isLeaf && state !== 'completed';
    const isDeadlocked =
      state === 'failed' &&
      attemptsMade >= maxAttempts &&
      !opts.failParentOnFailure;

    return {
      jobId,
      queue,
      name,
      state,
      failedReason: jobData.failedReason || undefined,
      attemptsMade,
      maxAttempts,
      children,
      isBlocker,
      isDeadlocked,
    };
  }

  /**
   * Parse a BullMQ job key like "bull:myQueue:123" into { queue, jobId }.
   * Job IDs are simple integers/UUIDs (no colons), so split on last colon.
   */
  private parseJobKey(key: string): { queue: string; jobId: string } | null {
    if (!key.startsWith(this.prefix + ':')) return null;
    const rest = key.slice(this.prefix.length + 1); // strip "bull:"
    const lastColon = rest.lastIndexOf(':');
    if (lastColon <= 0) return null;
    return {
      queue: rest.slice(0, lastColon),
      jobId: rest.slice(lastColon + 1),
    };
  }
}

/**
 * Resolve job state from pipeline results starting at the given offset.
 * Expects results at offset+0..offset+7 to be:
 *   zscore completed, zscore failed, zscore delayed, zscore prioritized,
 *   zscore waiting-children, lpos wait, exists job, exists lock
 */
function resolveState(
  results: [Error | null, unknown][],
  offset: number,
): FlowJobState {
  if (results[offset]![1] !== null) return 'completed';
  if (results[offset + 1]![1] !== null) return 'failed';
  if (results[offset + 2]![1] !== null) return 'delayed';
  if (results[offset + 3]![1] !== null) return 'waiting'; // prioritized = waiting
  if (results[offset + 4]![1] !== null) return 'waiting-children';
  if (results[offset + 7]![1] === 1) return 'active'; // has lock
  if (results[offset + 5]![1] !== null) return 'waiting';
  if (results[offset + 6]![1] === 1) return 'waiting'; // exists but not in any set
  return 'unknown';
}

function makeUnknownNode(jobId: string, queue: string): FlowNode {
  return {
    jobId,
    queue,
    name: '[unknown]',
    state: 'unknown',
    attemptsMade: 0,
    maxAttempts: 1,
    children: [],
    isBlocker: false,
    isDeadlocked: false,
  };
}

function safeParseJson(str: string | null | undefined): Record<string, unknown> {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
