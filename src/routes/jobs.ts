import { Router } from 'express';
import type { QueueAdapter } from '../adapters/types.js';

export function jobRoutes(adapter: QueueAdapter): Router {
  const router = Router();

  router.get('/queues/:name/jobs', async (req, res) => {
    try {
      const name = req.params.name!;
      const status = (req.query.status as string) || 'failed';
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const validStatuses = ['waiting', 'active', 'completed', 'failed', 'delayed'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
        return;
      }

      const jobs = await adapter.getJobsByStatus(
        name,
        status as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
        limit,
        offset,
      );

      res.json({ jobs, limit, offset });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  });

  router.get('/queues/:name/jobs/:id', async (req, res) => {
    try {
      const name = req.params.name!;
      const jobId = req.params.id!;
      const job = await adapter.getJobDetail(name, jobId);

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json(job);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  return router;
}
