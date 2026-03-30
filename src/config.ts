import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DamasqasConfig } from './types.js';

const DEFAULTS: DamasqasConfig = {
  redis: 'redis://localhost:6379',
  port: 3888,
  prefix: 'bull',
  pollInterval: 1,
  discoveryInterval: 60,
  retentionDays: 30,
  slackWebhook: null,
  discordWebhook: null,
  cooldown: 300,
  failureThreshold: 3,
  backlogThreshold: 5,
  stallAlert: true,
  redisKeyMemoryUsage: true,
  apiKey: null,
  noDashboard: false,
  verbose: false,
  dataDir: getDefaultDataDir(),
};

function getDefaultDataDir(): string {
  if (process.env.DAMASQAS_DATA_DIR) {
    return process.env.DAMASQAS_DATA_DIR;
  }
  return join(homedir(), '.damasqas');
}

function loadConfigFile(): Partial<DamasqasConfig> {
  const paths = [
    join(process.cwd(), 'damasqas.config.json'),
    join(homedir(), '.damasqas', 'config.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        // Skip invalid config files
      }
    }
  }
  return {};
}

function loadEnvVars(): Partial<DamasqasConfig> {
  const env: Partial<DamasqasConfig> = {};

  if (process.env.REDIS_URL) env.redis = process.env.REDIS_URL;
  if (process.env.DAMASQAS_PORT) env.port = parseInt(process.env.DAMASQAS_PORT, 10);
  if (process.env.DAMASQAS_PREFIX) env.prefix = process.env.DAMASQAS_PREFIX;
  if (process.env.DAMASQAS_POLL_INTERVAL) env.pollInterval = parseInt(process.env.DAMASQAS_POLL_INTERVAL, 10);
  if (process.env.DAMASQAS_DISCOVERY_INTERVAL) env.discoveryInterval = parseInt(process.env.DAMASQAS_DISCOVERY_INTERVAL, 10);
  if (process.env.DAMASQAS_RETENTION_DAYS) env.retentionDays = parseInt(process.env.DAMASQAS_RETENTION_DAYS, 10);
  if (process.env.SLACK_WEBHOOK) env.slackWebhook = process.env.SLACK_WEBHOOK;
  if (process.env.DISCORD_WEBHOOK) env.discordWebhook = process.env.DISCORD_WEBHOOK;
  if (process.env.DAMASQAS_COOLDOWN) env.cooldown = parseInt(process.env.DAMASQAS_COOLDOWN, 10);
  if (process.env.DAMASQAS_FAILURE_THRESHOLD) env.failureThreshold = parseFloat(process.env.DAMASQAS_FAILURE_THRESHOLD);
  if (process.env.DAMASQAS_BACKLOG_THRESHOLD) env.backlogThreshold = parseFloat(process.env.DAMASQAS_BACKLOG_THRESHOLD);
  if (process.env.DAMASQAS_REDIS_KEY_MEMORY === 'false') env.redisKeyMemoryUsage = false;
  if (process.env.DAMASQAS_API_KEY) env.apiKey = process.env.DAMASQAS_API_KEY;
  if (process.env.DAMASQAS_DATA_DIR) env.dataDir = process.env.DAMASQAS_DATA_DIR;

  return env;
}

export function parseConfig(cliOpts: Partial<DamasqasConfig> = {}): DamasqasConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvVars();

  // Priority: CLI > env > config file > defaults
  return {
    ...DEFAULTS,
    ...fileConfig,
    ...envConfig,
    ...stripUndefined(cliOpts),
  };
}

function stripUndefined(obj: Partial<DamasqasConfig>): Partial<DamasqasConfig> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<DamasqasConfig>;
}
