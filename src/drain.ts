import type { QueueAdapter } from './adapters/types.js';
import type { QueueSnapshot, DrainAnalysis } from './types.js';

const MAX_BUFFER_SIZE = 10;
const SMOOTHING_WINDOW = 5; // use last 5 snapshots for smoothing

/**
 * DrainAnalyzer maintains a circular buffer of recent snapshots per queue
 * and computes drain rate analysis with smoothed rates.
 *
 * Throughput source priority:
 *   1. BullMQ built-in metrics (if the worker has metrics enabled)
 *   2. Snapshot delta (completed_now - completed_prev) / interval
 *      Guarded with Math.max(0, delta) for removeOnComplete scenarios.
 */
export class DrainAnalyzer {
  private buffers = new Map<string, QueueSnapshot[]>();
  private latestAnalysis = new Map<string, DrainAnalysis>();
  private consecutiveGrowth = new Map<string, number>();

  /** Push a new snapshot into the circular buffer for the queue. */
  pushSnapshot(snapshot: QueueSnapshot): void {
    let buf = this.buffers.get(snapshot.queue);
    if (!buf) {
      buf = [];
      this.buffers.set(snapshot.queue, buf);
    }
    buf.push(snapshot);
    if (buf.length > MAX_BUFFER_SIZE) {
      buf.shift();
    }
  }

  /**
   * Compute a smoothed per-minute rate for a numeric snapshot field
   * over the last SMOOTHING_WINDOW snapshots.
   */
  private smoothedRate(queue: string, field: 'completed' | 'failed'): number {
    const buf = this.buffers.get(queue);
    if (!buf || buf.length < 2) return 0;

    const window = buf.slice(-SMOOTHING_WINDOW);
    if (window.length < 2) return 0;

    const first = window[0]!;
    const last = window[window.length - 1]!;
    const delta = (last[field] as number) - (first[field] as number);
    const timeSpanMs = last.timestamp - first.timestamp;
    if (timeSpanMs <= 0) return 0;

    return Math.max(0, delta) / (timeSpanMs / 60_000);
  }

  /**
   * Compute the smoothed total depth change rate (jobs/min).
   * Total depth = waiting + prioritized + waitingChildren (all BullMQ backlog sources).
   * Unlike completed/failed, depth can legitimately decrease, so we don't clamp to zero.
   */
  private smoothedTotalDepthDelta(queue: string): { rate: number; delta: number } {
    const buf = this.buffers.get(queue);
    if (!buf || buf.length < 2) return { rate: 0, delta: 0 };

    const window = buf.slice(-SMOOTHING_WINDOW);
    if (window.length < 2) return { rate: 0, delta: 0 };

    const first = window[0]!;
    const last = window[window.length - 1]!;
    const firstDepth = first.waiting + first.prioritized + first.waitingChildren;
    const lastDepth = last.waiting + last.prioritized + last.waitingChildren;
    const delta = lastDepth - firstDepth;
    const timeSpanMs = last.timestamp - first.timestamp;
    if (timeSpanMs <= 0) return { rate: 0, delta: 0 };

    return { rate: delta / (timeSpanMs / 60_000), delta };
  }

  /**
   * Run full drain analysis for a queue.
   * Prefers BullMQ built-in metrics for throughput when available.
   */
  async analyzeDrain(queue: string, adapter: QueueAdapter): Promise<DrainAnalysis | null> {
    const buf = this.buffers.get(queue);
    if (!buf || buf.length < 2) return null;

    const current = buf[buf.length - 1]!;

    // Total backlog depth includes all queued jobs waiting to be processed:
    // - wait list (regular FIFO jobs)
    // - prioritized sorted set (priority jobs, separate from wait in BullMQ v5)
    // - waiting-children list (jobs blocked on child completion)
    const totalDepth = current.waiting + current.prioritized + current.waitingChildren;

    // Determine drain rate (jobs/min leaving wait).
    // In BullMQ, jobs leave wait via both completed AND failed paths,
    // so we must count both to get the true drain rate.
    let drainRate: number;
    const bullmqMetrics = await adapter.getBullMQThroughput(queue);
    if (bullmqMetrics !== null) {
      // BullMQ metrics are already per-minute counts
      drainRate = bullmqMetrics.completed + bullmqMetrics.failed;
    } else {
      drainRate = this.smoothedRate(queue, 'completed') + this.smoothedRate(queue, 'failed');
    }

    // Compute waiting depth change (includes prioritized + waitingChildren)
    const { rate: waitingChangeRate, delta: depthDelta } = this.smoothedTotalDepthDelta(queue);

    // Inflow rate = jobs entering the queue per minute
    // waitingChangeRate = inflowRate - drainRate  =>  inflowRate = waitingChangeRate + drainRate
    const inflowRate = Math.max(0, waitingChangeRate + drainRate);

    const netRate = drainRate - inflowRate; // positive = draining

    let projectedDrainMinutes: number | null = null;
    if (netRate > 0 && totalDepth > 0) {
      projectedDrainMinutes = totalDepth / netRate;
    }

    const capacityDeficit = netRate <= 0 && inflowRate > 0
      ? Math.round(((inflowRate - drainRate) / Math.max(drainRate, 1)) * 100)
      : 0;

    // Determine trend
    // A paused queue with no active workers is intentionally idle, not stalled.
    let trend: DrainAnalysis['trend'];
    if (current.active === 0 && totalDepth > 0 && !current.paused) {
      trend = 'stalled';
    } else if (netRate > 1) {
      trend = 'draining';
    } else if (netRate < -1) {
      trend = 'growing';
    } else {
      trend = 'stable';
    }

    // Track consecutive growth
    if (trend === 'growing' || (depthDelta > 0 && totalDepth > 0)) {
      this.consecutiveGrowth.set(queue, (this.consecutiveGrowth.get(queue) ?? 0) + 1);
    } else {
      this.consecutiveGrowth.set(queue, 0);
    }

    const analysis: DrainAnalysis = {
      queue,
      currentDepth: totalDepth,
      depthDelta,
      inflowRate: Math.round(inflowRate * 10) / 10,
      drainRate: Math.round(drainRate * 10) / 10,
      netRate: Math.round(netRate * 10) / 10,
      projectedDrainMinutes: projectedDrainMinutes !== null
        ? Math.round(projectedDrainMinutes * 10) / 10
        : null,
      capacityDeficit,
      trend,
    };

    this.latestAnalysis.set(queue, analysis);
    return analysis;
  }

  /** Get the most recent drain analysis for a queue. */
  getDrainAnalysis(queue: string): DrainAnalysis | null {
    return this.latestAnalysis.get(queue) ?? null;
  }

  /** Get number of consecutive analysis ticks where the queue was growing. */
  getConsecutiveGrowthCount(queue: string): number {
    return this.consecutiveGrowth.get(queue) ?? 0;
  }

  /** Get the snapshot buffer for a queue (for testing/debugging). */
  getBuffer(queue: string): QueueSnapshot[] {
    return this.buffers.get(queue) ?? [];
  }
}
