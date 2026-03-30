import { Router } from 'express';
import type { MetricsStore } from '../store.js';

export function anomalyRoutes(store: MetricsStore): Router {
  const router = Router();

  router.get('/anomalies', (req, res) => {
    try {
      const queue = req.query.queue as string | undefined;
      const active = store.getActiveAnomalies(queue);
      const all = store.getAllAnomalies(queue);

      res.json({ active, history: all });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch anomalies' });
    }
  });

  return router;
}
