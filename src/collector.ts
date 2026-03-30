import type { QueueAdapter } from './adapters/types.js';
import type { MetricsStore } from './store.js';
import type { Discovery } from './discovery.js';
import type { AnomalyDetector } from './anomaly.js';
import type { AlertEngine } from './alert-engine.js';
import type { QueueSnapshot, QueueMetrics } from './types.js';

/**
 * Unified polling loop. Runs at pollInterval (default 1s) and orchestrates:
 *
 *   Every tick:        Snapshot collection (batched pipeline)
 *   Every Nth tick:    Metrics computation, anomaly detection, alert evaluation
 *   Every Mth tick:    Queue discovery refresh
 *
 * This decoupling lets us collect snapshots at 1s resolution for real-time
 * dashboards while keeping the heavier analytical work (rolling averages,
 * SQLite scans) at a sustainable 10s cadence.
 */
export class Collector {
  private adapter: QueueAdapter;
  private store: MetricsStore;
  private discovery: Discovery;
  private anomalyDetector: AnomalyDetector;
  private alertEngine: AlertEngine | null;
  private pollInterval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private previousSnapshots = new Map<string, QueueSnapshot>();
  private verbose: boolean;
  private tickCount = 0;
  private discoveryEveryNTicks: number;
  private analysisEveryNTicks: number;

  // Separate map to track the snapshot used as the basis for the last
  // metrics row. This prevents the bug where previousSnapshots gets
  // overwritten every tick but metrics only compute every Nth tick.
  private lastAnalysisSnapshots = new Map<string, QueueSnapshot>();

  constructor(
    adapter: QueueAdapter,
    store: MetricsStore,
    discovery: Discovery,
    anomalyDetector: AnomalyDetector,
    alertEngine: AlertEngine | null,
    pollIntervalSeconds: number,
    discoveryIntervalSeconds: number,
    verbose = false,
  ) {
    this.adapter = adapter;
    this.store = store;
    this.discovery = discovery;
    this.anomalyDetector = anomalyDetector;
    this.alertEngine = alertEngine;
    this.pollInterval = pollIntervalSeconds * 1000;
    this.verbose = verbose;

    // Discovery runs every M ticks (default: 60s / 1s = every 60th tick)
    this.discoveryEveryNTicks = Math.max(1, Math.round(discoveryIntervalSeconds / pollIntervalSeconds));

    // Metrics/anomaly/alert analysis runs every N ticks.
    // Target: ~10s cadence. If pollInterval >= 10s, run every tick.
    const ANALYSIS_INTERVAL_SECONDS = 10;
    this.analysisEveryNTicks = Math.max(1, Math.round(ANALYSIS_INTERVAL_SECONDS / pollIntervalSeconds));
  }

  getAnalysisEveryNTicks(): number {
    return this.analysisEveryNTicks;
  }

  async tick(): Promise<void> {
    this.tickCount++;

    try {
      // 1. Queue discovery refresh (every Mth tick, default ~60s)
      if (this.tickCount % this.discoveryEveryNTicks === 0) {
        await this.discovery.scan();
        if (this.verbose) {
          console.log(`[collector] Discovery refresh: ${this.discovery.getQueues().length} queues`);
        }
      }

      const queues = this.discovery.getQueues();
      if (queues.length === 0) return;

      // 2. Batch all per-queue reads into a single pipeline (every tick)
      const snapshots = await this.adapter.getSnapshotBatch(queues);

      // 3. Persist snapshots and compute inline throughput/fail rate
      for (const snapshot of snapshots) {
        const prev = this.previousSnapshots.get(snapshot.queue);
        if (prev) {
          const delta = this.computeMetrics(snapshot, prev);
          snapshot.throughput1m = delta.throughput;
          snapshot.failRate1m = delta.failureRate;
        }

        this.store.insertSnapshot(snapshot);
        this.previousSnapshots.set(snapshot.queue, snapshot);

        if (this.verbose) {
          console.log(
            `[collector] ${snapshot.queue}: w=${snapshot.waiting} a=${snapshot.active} ` +
            `c=${snapshot.completed} f=${snapshot.failed} d=${snapshot.delayed} ` +
            `p=${snapshot.prioritized} wc=${snapshot.waitingChildren}`,
          );
        }
      }

      // 4. Heavier analysis at a lower cadence (every Nth tick, default ~10s)
      //    This includes metrics row insertion, anomaly detection (which scans
      //    rolling averages over days of data), and alert rule evaluation.
      if (this.tickCount % this.analysisEveryNTicks === 0) {
        // Insert metrics rows computed against the last analysis snapshot,
        // NOT against previousSnapshots (which was overwritten every tick).
        for (const snapshot of snapshots) {
          const analysisPrev = this.lastAnalysisSnapshots.get(snapshot.queue);
          if (analysisPrev) {
            const metrics = this.computeMetrics(snapshot, analysisPrev);
            this.store.insertMetrics(metrics);
          }
          this.lastAnalysisSnapshots.set(snapshot.queue, snapshot);
        }

        // Anomaly detection
        try {
          await this.anomalyDetector.detect(queues);
        } catch (err) {
          console.error('[collector] Anomaly detection error:', err);
        }

        // Alert rules evaluation
        if (this.alertEngine) {
          try {
            await this.alertEngine.evaluate(queues, snapshots);
          } catch (err) {
            console.error('[collector] Alert evaluation error:', err);
          }
        }
      }
    } catch (err) {
      console.error('[collector] Tick failed:', err);
    }
  }

  async collectAll(queues: string[]): Promise<void> {
    if (queues.length === 0) return;

    const snapshots = await this.adapter.getSnapshotBatch(queues);

    for (const snapshot of snapshots) {
      const prev = this.previousSnapshots.get(snapshot.queue);
      if (prev) {
        const metrics = this.computeMetrics(snapshot, prev);
        snapshot.throughput1m = metrics.throughput;
        snapshot.failRate1m = metrics.failureRate;
        this.store.insertMetrics(metrics);
      }

      this.store.insertSnapshot(snapshot);
      this.previousSnapshots.set(snapshot.queue, snapshot);
      this.lastAnalysisSnapshots.set(snapshot.queue, snapshot);
    }
  }

  private computeMetrics(current: QueueSnapshot, prev: QueueSnapshot): QueueMetrics {
    const elapsedMs = current.timestamp - prev.timestamp;
    const elapsedMin = elapsedMs / 60_000;

    if (elapsedMin <= 0) {
      return {
        queue: current.queue,
        timestamp: current.timestamp,
        throughput: 0,
        failureRate: 0,
        failureRatio: 0,
        avgProcessingMs: null,
        backlogGrowthRate: 0,
      };
    }

    const completedDelta = Math.max(0, current.completed - prev.completed);
    const failedDelta = Math.max(0, current.failed - prev.failed);
    const waitingDelta = current.waiting - prev.waiting;

    const throughput = Math.round(completedDelta / elapsedMin);
    const failureRate = Math.round(failedDelta / elapsedMin);
    const total = throughput + failureRate;
    const failureRatio = total > 0 ? failureRate / total : 0;
    const backlogGrowthRate = Math.round(waitingDelta / elapsedMin);

    return {
      queue: current.queue,
      timestamp: current.timestamp,
      throughput,
      failureRate,
      failureRatio,
      avgProcessingMs: null,
      backlogGrowthRate,
    };
  }

  async sampleProcessingTimes(queues: string[]): Promise<void> {
    for (const queue of queues) {
      try {
        const times = await this.adapter.getRecentProcessingTimes(queue, 20);
        if (times.length > 0) {
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          const latest = this.store.getLatestMetrics(queue);
          if (latest) {
            latest.avgProcessingMs = avg;
          }
        }
      } catch {
        // Non-critical, skip
      }
    }
  }

  start(): void {
    this.timer = setInterval(async () => {
      await this.tick();
    }, this.pollInterval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
