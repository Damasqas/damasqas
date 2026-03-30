#!/usr/bin/env node

import { Command } from 'commander';
import { parseConfig } from './config.js';
import { BullMQAdapter } from './adapters/bullmq.js';
import { Discovery } from './discovery.js';
import { Collector } from './collector.js';
import { MetricsStore } from './store.js';
import { AnomalyDetector } from './anomaly.js';
import { AlertEngine } from './alert-engine.js';
import { Operations } from './operations.js';
import { EventStreamConsumer } from './event-stream.js';
import { SlackAlert } from './alerts/slack.js';
import { DiscordAlert } from './alerts/discord.js';
import { backfillAll } from './backfill.js';
import { sendCloudEvent } from './cloud.js';
import { createServer } from './api.js';
import type { AlertChannel } from './alerts/types.js';
import type { DamasqasConfig, AlertPayload } from './types.js';

const program = new Command();

program
  .name('damasqas')
  .description('Standalone BullMQ queue monitoring tool')
  .version('0.1.0')
  .requiredOption('--redis <url>', 'Redis connection URL')
  .option('--port <number>', 'Dashboard port', '3888')
  .option('--prefix <string>', 'BullMQ key prefix', 'bull')
  .option('--poll-interval <seconds>', 'Snapshot collection interval', '1')
  .option('--discovery-interval <seconds>', 'Queue discovery interval', '60')
  .option('--retention-days <number>', 'How long to keep metrics', '30')
  .option('--slack-webhook <url>', 'Slack incoming webhook URL')
  .option('--discord-webhook <url>', 'Discord webhook URL')
  .option('--cooldown <seconds>', 'Min seconds between repeat alerts', '300')
  .option('--failure-threshold <n>', 'Alert when failures exceed Nx baseline', '3')
  .option('--backlog-threshold <n>', 'Alert when backlog exceeds Nx baseline', '5')
  .option('--api-key <key>', 'Damasqas Cloud API key')
  .option('--no-dashboard', 'Run collector only, no web UI')
  .option('--verbose', 'Debug logging')
  .action(async (opts) => {
    const config = parseConfig({
      redis: opts.redis,
      port: parseInt(opts.port, 10),
      prefix: opts.prefix,
      pollInterval: parseInt(opts.pollInterval, 10),
      discoveryInterval: parseInt(opts.discoveryInterval, 10),
      retentionDays: parseInt(opts.retentionDays, 10),
      slackWebhook: opts.slackWebhook || null,
      discordWebhook: opts.discordWebhook || null,
      cooldown: parseInt(opts.cooldown, 10),
      failureThreshold: parseFloat(opts.failureThreshold),
      backlogThreshold: parseFloat(opts.backlogThreshold),
      apiKey: opts.apiKey || null,
      noDashboard: !opts.dashboard,
      verbose: opts.verbose || false,
    });

    await start(config);
  });

async function start(config: DamasqasConfig): Promise<void> {
  const startTime = Date.now();
  console.log(`[damasqas] Starting with Redis: ${config.redis}`);
  console.log(`[damasqas] Prefix: ${config.prefix}, Poll: ${config.pollInterval}s, Port: ${config.port}`);

  // Initialize core components
  const adapter = new BullMQAdapter(config.redis, config.prefix);
  await adapter.checkClockSkew();
  const store = new MetricsStore(config.dataDir, config.retentionDays);
  const discovery = new Discovery(adapter, store, config.prefix);
  const anomalyDetector = new AnomalyDetector(store, adapter, config);
  const alertEngine = new AlertEngine(store, adapter, config, config.verbose);
  const ops = new Operations(adapter);

  // Set up legacy alert channels (for anomaly-based alerts)
  const alertChannels: AlertChannel[] = [];
  if (config.slackWebhook) {
    alertChannels.push(new SlackAlert(config.slackWebhook));
    console.log('[damasqas] Slack alerts enabled');
  }
  if (config.discordWebhook) {
    alertChannels.push(new DiscordAlert(config.discordWebhook));
    console.log('[damasqas] Discord alerts enabled');
  }

  // Create unified collector (orchestrates discovery, anomaly detection, alert evaluation)
  const collector = new Collector(
    adapter,
    store,
    discovery,
    anomalyDetector,
    alertEngine,
    config.pollInterval,
    config.discoveryInterval,
    config.verbose,
  );

  // Connect drain analyzer to alert engine for enhanced drain_negative alerts
  alertEngine.setDrainAnalyzer(collector.getDrainAnalyzer());

  // Initial discovery
  console.log('[damasqas] Discovering queues...');
  const queues = await discovery.initialScan();
  console.log(`[damasqas] Found ${queues.length} queues: ${queues.join(', ') || '(none)'}`);

  discovery.on('queue:added', (name: string) => {
    console.log(`[damasqas] New queue discovered: ${name}`);
  });
  discovery.on('queue:stale', (name: string) => {
    console.log(`[damasqas] Queue marked stale: ${name}`);
  });

  // Backfill
  if (queues.length > 0) {
    console.log('[damasqas] Backfilling historical data...');
    await backfillAll(adapter, store, queues, config.verbose);
  }

  // Start cleanup & collection
  store.startCleanup();
  const analysisInterval = Math.max(config.pollInterval, 10);
  console.log(`[damasqas] Collector running (snapshots every ${config.pollInterval}s, analysis every ${analysisInterval}s, discovery every ${config.discoveryInterval}s)`);

  // Do initial collection
  await collector.collectAll(queues);

  // Start the unified polling loop
  collector.start();

  // Start event stream consumer on the dedicated stream connection
  const eventStream = new EventStreamConsumer(
    adapter.getStreamConnection(),
    store,
    discovery,
    config.prefix,
    config.verbose,
  );
  eventStream.start();
  console.log('[damasqas] Event stream consumer started');

  // Anomaly alert dispatch loop (for legacy anomaly-based alerts).
  // NOTE: Anomaly *detection* runs inside the collector tick. This loop
  // only handles alert *dispatch* for unsent anomalies — it does NOT
  // re-run detection, which would create duplicate anomaly rows.
  const anomalyAlertInterval = setInterval(async () => {
    if (alertChannels.length === 0) return;

    try {
      const unsentAnomalies = store.getActiveAnomalies()
        .filter((a) => !a.alertSent);

      for (const anomaly of unsentAnomalies) {
        const snapshot = store.getLatestSnapshot(anomaly.queue);
        if (!snapshot) continue;

        const metrics = store.getLatestMetrics(anomaly.queue);
        const topErrors = await adapter.getErrorGroups(
          anomaly.queue,
          Date.now() - 5 * 60 * 1000,
          10,
        );
        const payload: AlertPayload = {
          queue: anomaly.queue,
          anomaly,
          snapshot,
          metrics,
          topErrors,
        };

        for (const channel of alertChannels) {
          try {
            await channel.send(payload);
          } catch (err) {
            console.error('[damasqas] Alert send failed:', err);
          }
        }

        if (anomaly.id) store.markAlertSent(anomaly.id);

        // Cloud integration
        await sendCloudEvent(config, anomaly);
      }
    } catch (err) {
      console.error('[damasqas] Anomaly alert dispatch error:', err);
    }
  }, collector.getAnalysisEveryNTicks() * config.pollInterval * 1000);

  // Start API server
  const app = createServer(discovery, store, adapter, ops, startTime, config.noDashboard, collector);
  const server = app.listen(config.port, () => {
    if (!config.noDashboard) {
      console.log(`[damasqas] Dashboard: http://localhost:${config.port}`);
    }
    console.log(`[damasqas] API: http://localhost:${config.port}/api/health`);
    console.log('[damasqas] Ready.');
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[damasqas] Shutting down...');
    clearInterval(anomalyAlertInterval);
    collector.stop();
    eventStream.stop();
    store.close();
    await adapter.disconnect();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

program.parse();
