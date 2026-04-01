import { Router } from 'express';
import type { Discovery } from '../discovery.js';

export function healthRoutes(discovery: Discovery, startTime: number): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const queueCount = discovery.getQueues().length;

    res.json({
      status: 'ok',
      queues: queueCount,
      uptime: uptimeSeconds,
      // Signal to the UI whether the system is still discovering queues.
      // On fresh startup with no queues yet, the collector retries discovery
      // every 5s, so the UI can show a warmup indicator.
      warming: queueCount === 0 && uptimeSeconds < 90,
    });
  });

  return router;
}
