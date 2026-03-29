import { Router } from 'express';
import type { MetricsStore } from '../store.js';

const RANGES: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
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

      const snapshots = store.getSnapshots(name, since, now);
      const metrics = store.getMetrics(name, since, now);

      res.json({ snapshots, metrics });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  return router;
}
