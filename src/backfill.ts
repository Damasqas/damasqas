import type { QueueAdapter } from './adapters/types.js';
import type { MetricsStore } from './store.js';

const FIVE_MINUTES = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export async function backfillQueue(
  adapter: QueueAdapter,
  store: MetricsStore,
  queue: string,
  maxAgeMs = SEVEN_DAYS,
): Promise<number> {
  // Skip if we already have data for this queue
  if (store.hasData(queue)) return 0;

  const now = Date.now();
  const since = now - Math.min(maxAgeMs, SEVEN_DAYS);

  // Get completed and failed counts bucketed by 5-minute windows
  const completedCount = await adapter.getCompletedCountSince(queue, since);
  const failedCount = await adapter.getFailedCountSince(queue, since);

  if (completedCount === 0 && failedCount === 0) return 0;

  // Create synthetic snapshots in 5-minute windows
  // We can't get exact per-window counts without iterating all jobs,
  // so we'll distribute evenly as a rough baseline
  const windowCount = Math.ceil((now - since) / FIVE_MINUTES);
  const completedPerWindow = completedCount / windowCount;
  const failedPerWindow = failedCount / windowCount;

  let insertedRows = 0;

  for (let i = 0; i < windowCount; i++) {
    const windowTs = since + i * FIVE_MINUTES;
    const cumulativeCompleted = Math.round(completedPerWindow * (i + 1));
    const cumulativeFailed = Math.round(failedPerWindow * (i + 1));

    store.insertSnapshot({
      queue,
      timestamp: windowTs,
      waiting: 0,
      active: 0,
      completed: cumulativeCompleted,
      failed: cumulativeFailed,
      delayed: 0,
      locks: 0,
      stalledCount: 0,
      oldestWaitingAge: null,
      paused: false,
    });

    // Insert derived metrics for each window
    if (i > 0) {
      store.insertMetrics({
        queue,
        timestamp: windowTs,
        throughput: completedPerWindow / 5, // per minute
        failureRate: failedPerWindow / 5,   // per minute
        failureRatio: completedPerWindow + failedPerWindow > 0
          ? failedPerWindow / (completedPerWindow + failedPerWindow)
          : 0,
        avgProcessingMs: null,
        backlogGrowthRate: 0,
      });
    }

    insertedRows++;
  }

  return insertedRows;
}

export async function backfillAll(
  adapter: QueueAdapter,
  store: MetricsStore,
  queues: string[],
  verbose = false,
): Promise<void> {
  for (const queue of queues) {
    try {
      const rows = await backfillQueue(adapter, store, queue);
      if (rows > 0 && verbose) {
        console.log(`[backfill] ${queue}: inserted ${rows} synthetic snapshots`);
      }
    } catch (err) {
      console.error(`[backfill] Failed for ${queue}:`, err);
    }
  }
}
