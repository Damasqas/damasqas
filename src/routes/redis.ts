import { Router } from 'express';
import type { QueueAdapter } from '../adapters/types.js';
import type { MetricsStore } from '../store.js';
import type { RedisHealthCollector } from '../redis-health.js';

export function redisRoutes(
  adapter: QueueAdapter,
  store: MetricsStore,
  redisHealthCollector: RedisHealthCollector,
): Router {
  const router = Router();

  // Legacy endpoint — kept for backward compatibility
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
    } catch {
      res.status(500).json({ error: 'Failed to fetch Redis info' });
    }
  });

  // ── New Redis Health Endpoints ─────────────────────────────────────

  /**
   * GET /api/redis/health
   * Returns current Redis health snapshot, OOM projection, maxmemory policy
   * warning, and top growth contributors.
   */
  router.get('/redis/health', async (_req, res) => {
    try {
      const snapshot = store.getLatestRedisSnapshot();

      // OOM projection from last 60 snapshots (~10 minutes at 10s cadence)
      const recentSnapshots = store.getRecentRedisSnapshots(60);
      const oomProjection = redisHealthCollector.projectOOM(recentSnapshots);

      // Maxmemory policy warning
      let maxmemoryPolicyWarning: string | null = null;
      if (snapshot?.maxmemoryPolicy && snapshot.maxmemoryPolicy !== 'noeviction') {
        maxmemoryPolicyWarning =
          `Redis maxmemory-policy is "${snapshot.maxmemoryPolicy}". ` +
          `BullMQ requires "noeviction". With the current policy, Redis may evict ` +
          `BullMQ keys under memory pressure, causing data loss and unpredictable queue behavior.`;
      }
      // Also check live if we don't have a cached value
      if (!snapshot?.maxmemoryPolicy) {
        try {
          const policy = await adapter.checkMaxmemoryPolicy();
          if (policy && policy !== 'noeviction' && policy !== 'unknown') {
            maxmemoryPolicyWarning =
              `Redis maxmemory-policy is "${policy}". ` +
              `BullMQ requires "noeviction". With the current policy, Redis may evict ` +
              `BullMQ keys under memory pressure, causing data loss and unpredictable queue behavior.`;
          }
        } catch {
          // Non-critical
        }
      }

      // Top growth contributors
      const currentSizes = store.getLatestKeySizes();
      const previousSizes = currentSizes.length > 0
        ? store.getPreviousKeySizes(currentSizes[0]!.ts)
        : [];
      const topGrowthContributors = redisHealthCollector.attributeGrowth(
        currentSizes,
        previousSizes,
      );

      res.json({
        snapshot,
        oomProjection,
        maxmemoryPolicyWarning,
        topGrowthContributors,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch Redis health' });
    }
  });

  /**
   * GET /api/redis/history?range=1h|6h|24h|7d
   * Returns Redis snapshot time series for charting.
   */
  router.get('/redis/history', (req, res) => {
    try {
      const range = (req.query.range as string) || '1h';
      const now = Date.now();
      let since: number;
      let bucketMs: number | null = null;

      switch (range) {
        case '7d':
          since = now - 7 * 24 * 60 * 60 * 1000;
          bucketMs = 30 * 60 * 1000; // 30-minute buckets
          break;
        case '24h':
          since = now - 24 * 60 * 60 * 1000;
          bucketMs = 5 * 60 * 1000; // 5-minute buckets
          break;
        case '6h':
          since = now - 6 * 60 * 60 * 1000;
          bucketMs = 60 * 1000; // 1-minute buckets
          break;
        case '1h':
        default:
          since = now - 60 * 60 * 1000;
          break;
      }

      const snapshots = bucketMs
        ? store.getRedisSnapshotsAggregated(since, now, bucketMs)
        : store.getRedisSnapshots(since, now);

      res.json({ snapshots, since, until: now });
    } catch {
      res.status(500).json({ error: 'Failed to fetch Redis history' });
    }
  });

  /**
   * GET /api/redis/key-sizes
   * Returns the latest key sizes per queue with growth deltas.
   */
  router.get('/redis/key-sizes', (_req, res) => {
    try {
      const currentSizes = store.getLatestKeySizes();
      const previousSizes = currentSizes.length > 0
        ? store.getPreviousKeySizes(currentSizes[0]!.ts)
        : [];
      const growth = redisHealthCollector.attributeGrowth(currentSizes, previousSizes);

      res.json({
        keySizes: currentSizes,
        growth,
        collectedAt: currentSizes.length > 0 ? currentSizes[0]!.ts : null,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch key sizes' });
    }
  });

  /**
   * GET /api/redis/key-sizes/history?queue=X&range=1h|6h|24h|7d
   * Returns key size time series for a specific queue.
   */
  router.get('/redis/key-sizes/history', (req, res) => {
    try {
      const queue = req.query.queue as string;
      if (!queue) {
        res.status(400).json({ error: 'queue parameter is required' });
        return;
      }

      const range = (req.query.range as string) || '1h';
      const now = Date.now();
      let since: number;

      switch (range) {
        case '7d':
          since = now - 7 * 24 * 60 * 60 * 1000;
          break;
        case '24h':
          since = now - 24 * 60 * 60 * 1000;
          break;
        case '6h':
          since = now - 6 * 60 * 60 * 1000;
          break;
        case '1h':
        default:
          since = now - 60 * 60 * 1000;
          break;
      }

      const history = store.getKeySizeHistory(queue, since, now);
      res.json({ history, since, until: now });
    } catch {
      res.status(500).json({ error: 'Failed to fetch key size history' });
    }
  });

  /**
   * GET /api/redis/slowlog
   * Returns recent slowlog entries.
   */
  router.get('/redis/slowlog', (_req, res) => {
    try {
      const since = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours
      const entries = store.getSlowlogEntries(since, 50);
      res.json({ entries });
    } catch {
      res.status(500).json({ error: 'Failed to fetch slowlog' });
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
