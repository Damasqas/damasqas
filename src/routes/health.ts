import { Router } from 'express';
import type { Discovery } from '../discovery.js';

export function healthRoutes(discovery: Discovery, startTime: number): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      queues: discovery.getQueues().length,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  return router;
}
