import express from 'express';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Discovery } from './discovery.js';
import type { MetricsStore } from './store.js';
import type { QueueAdapter } from './adapters/types.js';
import type { Operations } from './operations.js';
import type { Collector } from './collector.js';
import { healthRoutes } from './routes/health.js';
import { queueRoutes } from './routes/queues.js';
import { metricsRoutes } from './routes/metrics.js';
import { jobRoutes } from './routes/jobs.js';
import { anomalyRoutes } from './routes/anomalies.js';
import { operationRoutes } from './routes/operations.js';
import { redisRoutes } from './routes/redis.js';
import { RedisHealthCollector } from './redis-health.js';
import { alertRoutes } from './routes/alerts.js';
import { eventRoutes } from './routes/events.js';
import { jobTypeRoutes } from './routes/job-types.js';
import { flowRoutes } from './routes/flows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(
  discovery: Discovery,
  store: MetricsStore,
  adapter: QueueAdapter,
  ops: Operations,
  startTime: number,
  noDashboard: boolean,
  collector?: Collector,
) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api', healthRoutes(discovery, startTime));
  app.use('/api', queueRoutes(discovery, store, adapter, collector));
  app.use('/api', metricsRoutes(store));
  app.use('/api', jobRoutes(adapter));
  app.use('/api', anomalyRoutes(store));
  app.use('/api', operationRoutes(ops, adapter));
  const redisHealthCollector = collector?.getRedisHealthCollector() ?? new RedisHealthCollector(10);
  app.use('/api', redisRoutes(adapter, store, redisHealthCollector));
  app.use('/api', alertRoutes(store));
  app.use('/api', eventRoutes(store));
  app.use('/api', jobTypeRoutes(store));
  const flowInspector = collector?.getFlowInspector() ?? null;
  if (flowInspector) {
    app.use('/api', flowRoutes(flowInspector, discovery));
  }

  // Serve static dashboard UI
  // Published package: __dirname = dist/, UI at dist/ui/ → join(__dirname, 'ui')
  // Dev with tsx:      __dirname = src/,  UI at dist/ui/ → join(__dirname, '..', 'dist', 'ui')
  if (!noDashboard) {
    const uiPath = [
      join(__dirname, 'ui'),
      join(__dirname, '..', 'dist', 'ui'),
    ].find((p) => existsSync(join(p, 'index.html')));

    if (uiPath) {
      app.use(express.static(uiPath));
      app.get('*', (_req, res) => {
        res.sendFile(join(uiPath, 'index.html'));
      });
    }
  }

  return app;
}
