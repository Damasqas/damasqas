import { Router } from 'express';
import type { MetricsStore } from '../store.js';

const RANGES: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS: Record<string, number | null> = {
  '1h': null,                  // raw data (~360 points)
  '6h': null,                  // raw data (~2160 points)
  '24h': 5 * 60 * 1000,       // 5-min buckets => ~288 points
  '7d': 30 * 60 * 1000,       // 30-min buckets => ~336 points
};

export function metricsRoutes(store: MetricsStore): Router {
  const router = Router();

  router.get('/queues/:name/metrics', (req, res) => {
    try {
      const name = req.params.name!;
      const rangeKey = (req.query.range as string) || '1h';
      const rangeMs = RANGES[rangeKey];

      if (!rangeMs) {
        res.status(400).json({ error: `Invalid range. Use: ${Object.keys(RANGES).join(', ')}` });
        return;
      }

      const now = Date.now();
      const since = now - rangeMs;
      const bucketMs = BUCKET_MS[rangeKey] ?? null;

      const snapshots = bucketMs
        ? store.getSnapshotsAggregated(name, since, now, bucketMs)
        : store.getSnapshots(name, since, now);
      const metrics = bucketMs
        ? store.getMetricsAggregated(name, since, now, bucketMs)
        : store.getMetrics(name, since, now);

      res.json({ snapshots, metrics, since, until: now });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  router.get('/queues/:name/comparison', (req, res) => {
    try {
      const name = req.params.name!;
      const events = store.getEventComparison(name);
      const snapshots = store.getSnapshotComparison(name);

      res.json({ queue: name, events, snapshots });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch comparison data' });
    }
  });

  router.get('/comparison', (_req, res) => {
    try {
      const comparisons = store.getAllQueuesComparison();
      const result: Record<string, unknown> = {};
      for (const [queue, data] of comparisons) {
        result[queue] = data;
      }
      res.json({ comparisons: result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch comparison data' });
    }
  });

  return router;
}
