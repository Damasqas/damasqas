import { Router } from 'express';
import type { Discovery } from '../discovery.js';
import type { FlowInspector } from '../flow.js';

export function flowRoutes(
  flowInspector: FlowInspector,
  discovery: Discovery,
): Router {
  const router = Router();

  router.get('/flows/deadlocks', async (_req, res) => {
    try {
      const deadlocks = flowInspector.getDeadlocks();
      const scannedAt = flowInspector.getLastDeadlockScanTs();
      res.json({ deadlocks, scannedAt });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch deadlocks' });
    }
  });

  router.get('/flows/tree/:queue/:jobId', async (req, res) => {
    try {
      const { queue, jobId } = req.params;
      if (!queue || !jobId) {
        res.status(400).json({ error: 'Missing queue or jobId' });
        return;
      }

      const knownQueues = discovery.getQueues();
      if (!knownQueues.includes(queue)) {
        res.status(404).json({ error: 'Queue not found' });
        return;
      }

      const tree = await flowInspector.getFlowTree(queue, jobId);
      res.json({ tree });
    } catch (err) {
      res.status(500).json({ error: 'Failed to build flow tree' });
    }
  });

  router.get('/flows/waiting-children', async (req, res) => {
    try {
      const queueFilter = req.query.queue as string | undefined;
      const knownQueues = discovery.getQueues();
      const queuesToScan = queueFilter
        ? knownQueues.filter((q) => q === queueFilter)
        : knownQueues;

      const jobs = [];
      for (const queue of queuesToScan) {
        const queueJobs = await flowInspector.getWaitingChildrenJobs(queue, 50);
        jobs.push(...queueJobs);
      }

      res.json({ jobs });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch waiting-children jobs' });
    }
  });

  return router;
}
