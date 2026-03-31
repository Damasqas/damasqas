import { execSync, spawn, type ChildProcess } from "node:child_process";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DAMASQAS_PORT = parseInt(process.env.DAMASQAS_PORT || "3899", 10);
const DAMASQAS_BIN = process.env.DAMASQAS_BIN || "node";
const DAMASQAS_ENTRY =
  process.env.DAMASQAS_ENTRY || `${__dirname}/../../dist/index.js`;

let damasqasProc: ChildProcess | null = null;
let redis: Redis | null = null;

export function getRedisUrl(): string {
  return REDIS_URL;
}

export function getDamasqasUrl(): string {
  return `http://localhost:${DAMASQAS_PORT}`;
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return redis;
}

/**
 * Start the Damasqas process pointing at the test Redis.
 * Polls /api/health until it responds 200.
 */
export async function startDamasqas(): Promise<void> {
  if (damasqasProc) return;

  damasqasProc = spawn(
    DAMASQAS_BIN,
    [
      DAMASQAS_ENTRY,
      "--redis", REDIS_URL,
      "--port", String(DAMASQAS_PORT),
      "--poll-interval", "1",
      "--no-dashboard",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DAMASQAS_DATA_DIR: `/tmp/damasqas-test-${Date.now()}`,
      },
    },
  );

  damasqasProc.stdout?.on("data", (data: Buffer) => {
    if (process.env.VERBOSE) process.stdout.write(`[damasqas] ${data}`);
  });
  damasqasProc.stderr?.on("data", (data: Buffer) => {
    if (process.env.VERBOSE) process.stderr.write(`[damasqas:err] ${data}`);
  });

  // Wait for health endpoint
  const url = `${getDamasqasUrl()}/api/health`;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await sleep(1000);
  }

  throw new Error("Damasqas failed to start within 30 seconds");
}

export async function stopDamasqas(): Promise<void> {
  if (damasqasProc) {
    damasqasProc.kill("SIGTERM");
    damasqasProc = null;
  }
}

/**
 * Flush the Redis database. Only safe in test environments.
 */
export async function flushRedis(): Promise<void> {
  const r = getRedis();
  await r.flushdb();
}

export async function teardown(): Promise<void> {
  await stopDamasqas();
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
