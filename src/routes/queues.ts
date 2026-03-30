import { Router } from 'express';
import type { Discovery } from '../discovery.js';
import type { MetricsStore } from '../store.js';
import type { QueueAdapter } from '../adapters/types.js';
import type { QueueState } from '../types.js';

export function queueRoutes(
  discovery: Discovery,
  store: MetricsStore,
  adapter: QueueAdapter,
): Router {
  const router = Router();

  router.get('/queues', async (_req, res) => {
    try {
      const names = discovery.getQueues();
      const queues: (QueueState & { stale: boolean })[] = [];

      for (const name of names) {
        const state = await buildQueueState(name, store, adapter);
        queues.push({
          ...state,
          stale: discovery.isStale(name),
        });
      }

      res.json({ queues });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch queues' });
    }
  });

  router.get('/queues/:name', async (req, res) => {
    try {
      const name = req.params.name!;
      const knownQueues = discovery.getQueues();
      if (!knownQueues.includes(name)) {
        res.status(404).json({ error: 'Queue not found' });
        return;
      }

      const state = await buildQueueState(name, store, adapter);
      res.json({
        ...state,
        stale: discovery.isStale(name),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch queue' });
    }
  });

  return router;
}

async function buildQueueState(
  name: string,
  store: MetricsStore,
  adapter: QueueAdapter,
): Promise<QueueState> {
  const snapshot = store.getLatestSnapshot(name);
  const metrics = store.getLatestMetrics(name);
  const anomalies = store.getActiveAnomalies(name);

  let status: QueueState['status'] = 'ok';
  if (anomalies.some((a) => a.severity === 'critical')) status = 'critical';
  else if (anomalies.length > 0) status = 'warning';

  return {
    name,
    status,
    paused: snapshot?.paused ?? false,
    counts: {
      waiting: snapshot?.waiting ?? 0,
      active: snapshot?.active ?? 0,
      completed: snapshot?.completed ?? 0,
      failed: snapshot?.failed ?? 0,
      delayed: snapshot?.delayed ?? 0,
      prioritized: snapshot?.prioritized ?? 0,
      waitingChildren: snapshot?.waitingChildren ?? 0,
    },
    processors: {
      locks: snapshot?.locks ?? 0,
      stalled: snapshot?.stalledCount ?? 0,
    },
    metrics: metrics
      ? {
          throughput: metrics.throughput,
          failureRate: metrics.failureRate,
          avgProcessingMs: metrics.avgProcessingMs,
        }
      : null,
    oldestWaiting: {
      jobId: null,
      ageMs: snapshot?.oldestWaitingAge ?? null,
    },
    anomalies,
  };
}
