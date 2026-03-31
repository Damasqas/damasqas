import { Queue, Worker, FlowProducer, type Job } from "bullmq";
import type Redis from "ioredis";
import { getDamasqasUrl, sleep } from "./setup";

/**
 * Create a BullMQ Queue connected to the test Redis.
 */
export function createQueue(name: string, connection: Redis): Queue {
  return new Queue(name, { connection: connection.duplicate() });
}

/**
 * Create a BullMQ Worker with a given handler.
 */
export function createWorker(
  name: string,
  connection: Redis,
  handler: (job: Job) => Promise<unknown>,
  opts: { concurrency?: number } = {},
): Worker {
  return new Worker(name, handler, {
    connection: connection.duplicate(),
    concurrency: opts.concurrency ?? 1,
  });
}

/**
 * Create a BullMQ FlowProducer connected to the test Redis.
 */
export function createFlowProducer(connection: Redis): FlowProducer {
  return new FlowProducer({ connection: connection.duplicate() });
}

/**
 * Fetch a Damasqas API endpoint and return parsed JSON.
 */
export async function fetchApi<T = unknown>(path: string): Promise<T> {
  const url = `${getDamasqasUrl()}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/**
 * POST to a Damasqas API endpoint and return parsed JSON.
 */
export async function postApi<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${getDamasqasUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API POST ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Poll until a condition function returns true, or timeout.
 */
export async function waitForCondition(
  fn: () => Promise<boolean> | boolean,
  timeoutMs = 30_000,
  intervalMs = 1000,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

/**
 * Wait for Damasqas to discover a queue (appears in /api/queues).
 */
export async function waitForQueueDiscovery(
  queueName: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitForCondition(
    async () => {
      try {
        const data = await fetchApi<{ queues: { name: string }[] }>("/api/queues");
        return data.queues.some((q) => q.name === queueName);
      } catch {
        return false;
      }
    },
    timeoutMs,
    2000,
    `queue '${queueName}' discovery`,
  );
}
