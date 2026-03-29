import express from 'express';
import cors from 'cors';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Discovery } from './discovery.js';
import type { MetricsStore } from './store.js';
import type { QueueAdapter } from './adapters/types.js';
import type { Operations } from './operations.js';
import { healthRoutes } from './routes/health.js';
import { queueRoutes } from './routes/queues.js';
import { metricsRoutes } from './routes/metrics.js';
import { jobRoutes } from './routes/jobs.js';
import { anomalyRoutes } from './routes/anomalies.js';
import { operationRoutes } from './routes/operations.js';
import { redisRoutes } from './routes/redis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(
  discovery: Discovery,
  store: MetricsStore,
  adapter: QueueAdapter,
  ops: Operations,
  redisUrl: string,
  startTime: number,
  noDashboard: boolean,
) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api', healthRoutes(discovery, startTime));
  app.use('/api', queueRoutes(discovery, store, adapter));
  app.use('/api', metricsRoutes(store));
  app.use('/api', jobRoutes(adapter));
  app.use('/api', anomalyRoutes(store));
  app.use('/api', operationRoutes(ops, adapter));
  app.use('/api', redisRoutes(redisUrl));

  // Serve static dashboard UI
  if (!noDashboard) {
    // When compiled: __dirname = <root>/dist/, UI at <root>/dist/ui/
    // When running via tsx: __dirname = <root>/src/, UI at <root>/dist/ui/
    const projectRoot = resolve(__dirname, '..');
    const candidates = [
      join(__dirname, 'ui'),           // compiled: dist/ui/
      join(projectRoot, 'dist', 'ui'), // dev mode: ../dist/ui/ from src/
    ];
    const uiPath = candidates.find((p) => existsSync(join(p, 'index.html')));
    if (uiPath) {
      app.use(express.static(uiPath));
      app.get('*', (_req, res) => {
        res.sendFile(join(uiPath, 'index.html'));
      });
    } else {
      console.warn('[damasqas] Dashboard UI not found. Run "npm run build:ui" first, or use --no-dashboard');
    }
  }

  return app;
}
