import { Router } from 'express';
import { Redis } from 'ioredis';

export function redisRoutes(redisUrl: string): Router {
  const router = Router();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  router.get('/redis', async (_req, res) => {
    try {
      const info = await redis.info();
      const parsed = parseRedisInfo(info);

      res.json({
        version: parsed['redis_version'] || 'unknown',
        memory: {
          used: parsed['used_memory_human'] || 'unknown',
          peak: parsed['used_memory_peak_human'] || 'unknown',
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
