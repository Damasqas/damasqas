import { Router } from 'express';
import type { QueueAdapter } from '../adapters/types.js';

export function redisRoutes(adapter: QueueAdapter): Router {
  const router = Router();

  router.get('/redis', async (_req, res) => {
    try {
      const redis = adapter.getCmdConnection();
      const info = await redis.info();
      const parsed = parseRedisInfo(info);

      res.json({
        version: parsed['redis_version'] || 'unknown',
        memory: {
          used: parsed['used_memory_human'] || 'unknown',
          peak: parsed['used_memory_peak_human'] || 'unknown',
          usedBytes: parseInt(parsed['used_memory'] || '0', 10),
        },
        clients: {
          connected: parseInt(parsed['connected_clients'] || '0', 10),
        },
        uptime: parseInt(parsed['uptime_in_seconds'] || '0', 10),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch Redis info' });
    }
  });

  return router;
}

function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of info.split('\r\n')) {
    if (line && !line.startsWith('#')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        result[line.slice(0, colonIdx)] = line.slice(colonIdx + 1);
      }
    }
  }
  return result;
}
