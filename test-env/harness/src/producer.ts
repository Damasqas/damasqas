import { Queue } from "bullmq";
import Redis from "ioredis";
import { QUEUE_CONFIGS } from "./queues";

const connection = new Redis(process.env.REDIS_URL!);

export function startProducers() {
  for (const [queueName, config] of Object.entries(QUEUE_CONFIGS)) {
    if (config.jobsPerMinute === 0) continue;

    const queue = new Queue(queueName, { connection: connection.duplicate() });
    const intervalMs = (60 / config.jobsPerMinute) * 1000;

    setInterval(async () => {
      const jobName = config.jobNames[Math.floor(Math.random() * config.jobNames.length)];
      const data = {
        userId: `usr_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        ...(queueName === "webhook-deliver" && {
          url: `https://api.example.com/webhook/${Math.random().toString(36).slice(2, 8)}`,
          event: ["order.created", "user.signup", "payment.failed"][Math.floor(Math.random() * 3)],
        }),
        ...(queueName === "payment-process" && {
          amount: Math.floor(Math.random() * 50000) / 100,
          currency: "USD",
        }),
      };

      const opts: any = {
        attempts: config.retryAttempts,
        ...(config.retryAttempts > 1 && {
          backoff: { type: "exponential", delay: 1000 },
        }),
      };

      if ("delayMs" in config && config.delayMs) {
        opts.delay =
          config.delayMs.min +
          Math.random() * (config.delayMs.max - config.delayMs.min);
      }

      if ("usePriority" in config && config.usePriority) {
        opts.priority = Math.floor(Math.random() * 10) + 1;
      }

      await queue.add(jobName, data, opts);
    }, intervalMs);

    console.log(`  Producer ${queueName}: ${config.jobsPerMinute} jobs/min`);
  }
}
