import { Router } from 'express';
import type { Operations } from '../operations.js';
import type { QueueAdapter } from '../adapters/types.js';

export function operationRoutes(ops: Operations, adapter: QueueAdapter): Router {
  const router = Router();

  router.post('/queues/:name/pause', async (req, res) => {
    try {
      await ops.pause(req.params.name!);
      res.json({ ok: true, action: 'paused' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to pause queue' });
    }
  });

  router.post('/queues/:name/resume', async (req, res) => {
    try {
      await ops.resume(req.params.name!);
      res.json({ ok: true, action: 'resumed' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to resume queue' });
    }
  });

  router.post('/queues/:name/clean', async (req, res) => {
    try {
      const { status = 'completed', grace = 0, limit = 1000 } = req.body || {};
      const count = await ops.clean(req.params.name!, status, grace, limit);
      res.json({ ok: true, cleaned: count });
    } catch (err) {
      res.status(500).json({ error: 'Failed to clean queue' });
    }
  });

  router.post('/queues/:name/retry-all', async (req, res) => {
    try {
      const count = await ops.retryAll(req.params.name!);
      res.json({ ok: true, retried: count });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retry all' });
    }
  });

  router.post('/queues/:name/jobs/:id/retry', async (req, res) => {
    try {
      await ops.retryJob(req.params.name!, req.params.id!);
      res.json({ ok: true, action: 'retried' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retry job' });
    }
  });

  router.post('/queues/:name/jobs/:id/remove', async (req, res) => {
    try {
      await ops.removeJob(req.params.name!, req.params.id!);
      res.json({ ok: true, action: 'removed' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove job' });
    }
  });

  router.post('/queues/:name/jobs/:id/promote', async (req, res) => {
    try {
      await ops.promoteJob(req.params.name!, req.params.id!);
      res.json({ ok: true, action: 'promoted' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to promote job' });
    }
  });

  router.post('/queues/:name/promote-all', async (req, res) => {
    try {
      const count = await ops.promoteAllOverdue(req.params.name!);
      res.json({ ok: true, promoted: count });
    } catch (err) {
      res.status(500).json({ error: 'Failed to promote overdue jobs' });
    }
  });

  router.get('/queues/:name/errors', async (req, res) => {
    try {
      const since = Date.now() - 5 * 60 * 1000;
      const groups = await adapter.getErrorGroups(req.params.name!, since, 500);
      res.json({ groups });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch error groups' });
    }
  });

  return router;
}
