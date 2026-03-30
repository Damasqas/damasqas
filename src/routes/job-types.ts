import { Router } from 'express';
import type { MetricsStore } from '../store.js';

const RANGES: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function jobTypeRoutes(store: MetricsStore): Router {
  const router = Router();

  // Get per-job-type breakdown for a queue
  router.get('/queues/:name/job-types', (req, res) => {
    try {
      const queue = req.params.name!;
      const rangeKey = (req.query.range as string) || '1h';
      const rangeMs = RANGES[rangeKey];

      if (!rangeMs) {
        res.status(400).json({ error: `Invalid range. Use: ${Object.keys(RANGES).join(', ')}` });
        return;
      }

      const now = Date.now();
      const since = now - rangeMs;

      // For short ranges (1h, 6h), query raw tables for real-time accuracy.
      // For longer ranges (24h, 7d), use pre-aggregated summaries.
      const breakdown = rangeMs <= 6 * 60 * 60 * 1000
        ? store.getJobTypeBreakdown(queue, since, now)
        : store.getJobTypeBreakdownFromSummaries(queue, since, now);

      res.json({ breakdown, since, until: now });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch job type breakdown' });
    }
  });

  return router;
}
