import type { QueueAdapter } from './adapters/types.js';
import type { MetricsStore } from './store.js';
import type { RedisSnapshot, RedisKeySize, OOMProjection, KeyGrowth } from './types.js';

/**
 * RedisHealthCollector handles multi-cadence collection of Redis infrastructure
 * metrics and provides OOM projection and key growth attribution.
 *
 * Collection cadences (driven by the analysis tick, typically ~10s):
 *   Every analysis tick:  Redis INFO snapshot + slowlog
 *   Every 5 minutes:      Per-queue key sizes (XLEN, ZCARD, LLEN)
 *   Every 30 minutes:     Per-key MEMORY USAGE (optional, expensive)
 */
export class RedisHealthCollector {
  private keySizeTickCount = 0;
  private memoryUsageTickCount = 0;
  private keySizeEveryNTicks: number;
  private memUsageEveryNTicks: number;
  private lastSlowlogId = -1;

  constructor(analysisIntervalSeconds: number) {
    // Key sizes every 5 minutes
    this.keySizeEveryNTicks = Math.max(1, Math.round(300 / analysisIntervalSeconds));
    // Memory usage every 30 minutes
    this.memUsageEveryNTicks = Math.max(1, Math.round(1800 / analysisIntervalSeconds));
  }

  /**
   * Called every analysis tick (~10s). Orchestrates all Redis health collection
   * at the appropriate cadences.
   */
  async collect(
    adapter: QueueAdapter,
    store: MetricsStore,
    queues: string[],
    prefix: string,
    redisKeyMemoryUsage: boolean,
  ): Promise<void> {
    // Always: collect Redis INFO snapshot
    try {
      const snapshot = await adapter.collectRedisInfo();
      // Also fetch maxmemory policy (cheap CONFIG GET)
      try {
        snapshot.maxmemoryPolicy = await adapter.checkMaxmemoryPolicy();
      } catch {
        // Non-critical
      }
      store.insertRedisSnapshot(snapshot);
    } catch (err) {
      console.error('[redis-health] Failed to collect Redis INFO:', err);
    }

    // Always: collect slowlog (deduplicate by Redis slowlog entry ID)
    try {
      const { entries } = await adapter.collectSlowlog();
      // Slowlog IDs are monotonically increasing; only store entries newer
      // than the last seen ID to avoid duplicates across poll cycles.
      const newEntries = entries.filter((e) => e.slowlogId != null && e.slowlogId > this.lastSlowlogId);
      if (newEntries.length > 0) {
        store.insertSlowlogEntries(newEntries);
        this.lastSlowlogId = Math.max(...newEntries.map((e) => e.slowlogId!));
      }
    } catch (err) {
      console.error('[redis-health] Failed to collect slowlog:', err);
    }

    // Every 5 minutes: collect key sizes (entry counts)
    this.keySizeTickCount++;
    if (this.keySizeTickCount >= this.keySizeEveryNTicks) {
      this.keySizeTickCount = 0;
      try {
        const sizes = await adapter.collectKeySizes(queues, prefix);
        if (sizes.length > 0) {
          store.insertRedisKeySizes(sizes);
        }
      } catch (err) {
        console.error('[redis-health] Failed to collect key sizes:', err);
      }
    }

    // Every 30 minutes: collect MEMORY USAGE per key (optional)
    if (redisKeyMemoryUsage) {
      this.memoryUsageTickCount++;
      if (this.memoryUsageTickCount >= this.memUsageEveryNTicks) {
        this.memoryUsageTickCount = 0;
        try {
          const memSizes = await adapter.collectKeyMemoryUsage(queues, prefix);
          if (memSizes.length > 0) {
            store.insertRedisKeySizes(memSizes);
          }
        } catch (err) {
          console.error('[redis-health] Failed to collect key memory usage:', err);
        }
      }
    }
  }

  /**
   * Project when Redis will hit OOM based on linear regression of recent snapshots.
   * Returns null hoursUntilOOM if maxmemory is 0 (no limit) or memory is shrinking.
   */
  projectOOM(snapshots: RedisSnapshot[]): OOMProjection {
    if (snapshots.length < 2) {
      return { hoursUntilOOM: null, growthRateMBPerHour: 0 };
    }

    const latest = snapshots[snapshots.length - 1]!;
    if (latest.maxmemory === 0) {
      // No maxmemory configured — can't project OOM
      return { hoursUntilOOM: null, growthRateMBPerHour: 0 };
    }

    // Linear regression: y = used_memory, x = ts
    const slope = linearRegressionSlope(
      snapshots.map((s) => ({ x: s.ts, y: s.usedMemory })),
    );
    const growthRateMBPerHour = (slope * 3_600_000) / (1024 * 1024);

    if (slope <= 0) {
      return { hoursUntilOOM: null, growthRateMBPerHour: Math.round(growthRateMBPerHour * 100) / 100 };
    }

    const remainingBytes = latest.maxmemory - latest.usedMemory;
    if (remainingBytes <= 0) {
      return { hoursUntilOOM: 0, growthRateMBPerHour: Math.round(growthRateMBPerHour * 100) / 100 };
    }

    const msUntilOOM = remainingBytes / slope;
    const hoursUntilOOM = Math.round((msUntilOOM / 3_600_000) * 10) / 10;

    return {
      hoursUntilOOM,
      growthRateMBPerHour: Math.round(growthRateMBPerHour * 100) / 100,
    };
  }

  /**
   * Identify which BullMQ keys are growing fastest by comparing current
   * key sizes against previous collection.
   */
  attributeGrowth(current: RedisKeySize[], previous: RedisKeySize[]): KeyGrowth[] {
    return current
      .map((curr) => {
        const prev = previous.find(
          (p) => p.queue === curr.queue && p.keyType === curr.keyType,
        );
        const entryDelta = prev ? curr.entryCount - prev.entryCount : curr.entryCount;
        const memoryDelta =
          prev && curr.memoryBytes != null && prev.memoryBytes != null
            ? curr.memoryBytes - prev.memoryBytes
            : null;
        return {
          queue: curr.queue,
          keyType: curr.keyType,
          entries: curr.entryCount,
          entryDelta,
          memoryBytes: curr.memoryBytes,
          memoryDelta,
        };
      })
      .filter((g) => g.entryDelta > 0 || (g.memoryDelta != null && g.memoryDelta > 0))
      .sort((a, b) => (b.memoryDelta ?? b.entryDelta) - (a.memoryDelta ?? a.entryDelta));
  }
}

/**
 * Compute the slope of a simple linear regression.
 * Uses the least-squares formula: slope = Σ((xi - x̄)(yi - ȳ)) / Σ((xi - x̄)²)
 */
function linearRegressionSlope(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    numerator += dx * (p.y - meanY);
    denominator += dx * dx;
  }

  if (denominator === 0) return 0;
  return numerator / denominator;
}
