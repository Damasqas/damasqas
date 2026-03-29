import { Worker, Job } from "bullmq";
import { QUEUE_CONFIGS } from "./queues";
import { pickError } from "./errors";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

// Workers read their failure rate and slowdown factor from Redis at runtime.
// The control panel writes to these keys so you can inject chaos without restarting.

interface RuntimeConfig {
  failureRate: number;
  slowdownFactor: number;
  paused: boolean;
}

async function getRuntimeConfig(queue: string): Promise<RuntimeConfig> {
  const raw = await redis.get(`chaos:${queue}`);
  if (!raw) {
    const defaults = QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS];
    return {
      failureRate: defaults?.baselineFailureRate || 0.01,
      slowdownFactor: 1,
      paused: false,
    };
  }
  return JSON.parse(raw);
}

export function startWorkers() {
  for (const [queueName, config] of Object.entries(QUEUE_CONFIGS)) {
    if (config.workers === 0) continue;

    for (let w = 0; w < config.workers; w++) {
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          const rt = await getRuntimeConfig(queueName);

          // Simulate processing time
          const baseTime =
            config.processingMs.min +
            Math.random() * (config.processingMs.max - config.processingMs.min);
          const actualTime = baseTime * rt.slowdownFactor;
          await new Promise((r) => setTimeout(r, actualTime));

          // Simulate failure
          if (Math.random() < rt.failureRate) {
            const err = pickError(queueName);
            const error = new Error(err.message);
            error.stack = err.message + "\n" + err.stack;
            throw error;
          }

          return { ok: true, processedIn: Math.round(actualTime) };
        },
        {
          connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
          concurrency: config.concurrency,
          lockDuration: 30000,
          stalledInterval: 30000,
        }
      );

      worker.on("failed", (job, err) => {
        // Silent — Damasqas should detect this, not the harness
      });

      console.log(`  Worker ${queueName}#${w + 1} started (concurrency: ${config.concurrency})`);
    }
  }
}
