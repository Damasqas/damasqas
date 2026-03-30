import type { MetricsStore } from './store.js';
import type { QueueAdapter } from './adapters/types.js';
import type { AnomalyRecord, AnomalyType, AnomalySeverity, DamasqasConfig } from './types.js';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

export class AnomalyDetector {
  private store: MetricsStore;
  private adapter: QueueAdapter;
  private config: DamasqasConfig;

  constructor(store: MetricsStore, adapter: QueueAdapter, config: DamasqasConfig) {
    this.store = store;
    this.adapter = adapter;
    this.config = config;
  }

  async detect(queues: string[]): Promise<AnomalyRecord[]> {
    const anomalies: AnomalyRecord[] = [];

    for (const queue of queues) {
      const detected = await this.detectForQueue(queue);
      anomalies.push(...detected);
    }

    return anomalies;
  }

  private async detectForQueue(queue: string): Promise<AnomalyRecord[]> {
    const anomalies: AnomalyRecord[] = [];
    const now = Date.now();
    const cooldownMs = this.config.cooldown * 1000;

    // 1. Failure spike detection
    const latestMetrics = this.store.getLatestMetrics(queue);
    if (latestMetrics && latestMetrics.failureRate > 0) {
      const baseline = this.store.getRollingAverage(queue, 'failure_rate', SEVEN_DAYS);
      if (baseline !== null && baseline > 0) {
        const multiplier = latestMetrics.failureRate / baseline;
        if (multiplier >= this.config.failureThreshold) {
          const existing = this.store.getRecentAnomaly(queue, 'failure_spike', cooldownMs);
          if (!existing || this.shouldEscalate(existing, multiplier)) {
            anomalies.push(this.createAnomaly(
              queue, now, 'failure_spike',
              this.getSeverity(multiplier),
              latestMetrics.failureRate, baseline, multiplier,
            ));
          }
        }
      }
    }

    // 2. Backlog growth detection
    const latestSnapshot = this.store.getLatestSnapshot(queue);
    if (latestSnapshot && latestSnapshot.waiting > 0) {
      const baseline = this.store.getWaitingAverage(queue, TWENTY_FOUR_HOURS);
      if (baseline !== null && baseline > 0) {
        const multiplier = latestSnapshot.waiting / baseline;
        if (multiplier >= this.config.backlogThreshold) {
          const existing = this.store.getRecentAnomaly(queue, 'backlog_growth', cooldownMs);
          if (!existing || this.shouldEscalate(existing, multiplier)) {
            anomalies.push(this.createAnomaly(
              queue, now, 'backlog_growth',
              this.getSeverity(multiplier),
              latestSnapshot.waiting, baseline, multiplier,
            ));
          }
        }
      }
    }

    // 3. Processing slow detection
    if (latestMetrics) {
      const processingTimes = await this.adapter.getRecentProcessingTimes(queue, 20);
      if (processingTimes.length > 0) {
        const currentAvg = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
        const baseline = this.store.getRollingAverage(queue, 'avg_processing_ms', SEVEN_DAYS);
        if (baseline !== null && baseline > 0) {
          const multiplier = currentAvg / baseline;
          if (multiplier >= this.config.failureThreshold) {
            const existing = this.store.getRecentAnomaly(queue, 'processing_slow', cooldownMs);
            if (!existing || this.shouldEscalate(existing, multiplier)) {
              anomalies.push(this.createAnomaly(
                queue, now, 'processing_slow',
                this.getSeverity(multiplier),
                currentAvg, baseline, multiplier,
              ));
            }
          }
        }
      }
    }

    // 4. Stalled job detection (zero-baseline)
    if (this.config.stallAlert && latestSnapshot && latestSnapshot.stalledCount > 0) {
      const existing = this.store.getRecentAnomaly(queue, 'stalled_job', cooldownMs);
      if (!existing) {
        anomalies.push(this.createAnomaly(
          queue, now, 'stalled_job', 'critical',
          latestSnapshot.stalledCount, 0, Infinity,
        ));
      }
    }

    // 5. Queue idle detection
    if (latestMetrics && latestMetrics.throughput === 0) {
      const recentMetrics = this.store.getMetrics(queue, now - TEN_MINUTES, now);
      const allZero = recentMetrics.length > 0 &&
        recentMetrics.every((m) => m.throughput === 0);

      if (allZero) {
        // Check if the queue is usually active
        const historicalAvg = this.store.getRollingAverage(queue, 'throughput', SEVEN_DAYS);
        if (historicalAvg !== null && historicalAvg > 0.5) {
          const existing = this.store.getRecentAnomaly(queue, 'queue_idle', cooldownMs);
          if (!existing) {
            anomalies.push(this.createAnomaly(
              queue, now, 'queue_idle', 'warning',
              0, historicalAvg, 0,
            ));
          }
        }
      }
    }

    // 6. Oldest waiting job detection
    if (latestSnapshot && latestSnapshot.oldestWaitingAge !== null) {
      if (latestSnapshot.oldestWaitingAge > TEN_MINUTES) {
        const existing = this.store.getRecentAnomaly(queue, 'oldest_waiting', cooldownMs);
        if (!existing) {
          anomalies.push(this.createAnomaly(
            queue, now, 'oldest_waiting', 'warning',
            latestSnapshot.oldestWaitingAge, TEN_MINUTES, latestSnapshot.oldestWaitingAge / TEN_MINUTES,
          ));
        }
      }
    }

    // Resolve anomalies that are no longer active
    await this.resolveCleared(queue, latestSnapshot, latestMetrics);

    return anomalies;
  }

  private async resolveCleared(
    queue: string,
    snapshot: ReturnType<MetricsStore['getLatestSnapshot']>,
    metrics: ReturnType<MetricsStore['getLatestMetrics']>,
  ): Promise<void> {
    const active = this.store.getActiveAnomalies(queue);
    const now = Date.now();

    for (const anomaly of active) {
      let resolved = false;

      switch (anomaly.type) {
        case 'stalled_job':
          resolved = !snapshot || snapshot.stalledCount === 0;
          break;
        case 'failure_spike':
          if (metrics && anomaly.baselineValue > 0) {
            resolved = metrics.failureRate / anomaly.baselineValue < this.config.failureThreshold;
          }
          break;
        case 'backlog_growth':
          if (snapshot && anomaly.baselineValue > 0) {
            resolved = snapshot.waiting / anomaly.baselineValue < this.config.backlogThreshold;
          }
          break;
        case 'queue_idle':
          resolved = !!metrics && metrics.throughput > 0;
          break;
        case 'oldest_waiting':
          resolved = !snapshot || snapshot.oldestWaitingAge === null || snapshot.oldestWaitingAge < TEN_MINUTES;
          break;
      }

      if (resolved && anomaly.id) {
        this.store.markAnomalyResolved(anomaly.id, now);
      }
    }
  }

  private getSeverity(multiplier: number): AnomalySeverity {
    if (multiplier >= 10) return 'critical';
    return 'warning';
  }

  private shouldEscalate(existing: AnomalyRecord, newMultiplier: number): boolean {
    // Escalate if severity would increase
    return existing.severity === 'warning' && newMultiplier >= 10;
  }

  private createAnomaly(
    queue: string,
    timestamp: number,
    type: AnomalyType,
    severity: AnomalySeverity,
    currentValue: number,
    baselineValue: number,
    multiplier: number,
  ): AnomalyRecord {
    const anomaly: AnomalyRecord = {
      queue,
      timestamp,
      type,
      severity,
      currentValue,
      baselineValue,
      multiplier: isFinite(multiplier) ? multiplier : 999,
      resolvedAt: null,
      alertSent: false,
    };

    const id = this.store.insertAnomaly(anomaly);
    anomaly.id = id;
    return anomaly;
  }
}
