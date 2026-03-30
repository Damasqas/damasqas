import { Queue } from "bullmq";
import Redis from "ioredis";
import { QUEUE_CONFIGS } from "./queues";

const connection = new Redis(process.env.REDIS_URL!);

interface ProducerState {
  queue: Queue;
  timer: ReturnType<typeof setInterval> | null;
  jobsPerMinute: number;
  running: boolean;
}

const producers: Record<string, ProducerState> = {};

function buildJobData(queueName: string, config: typeof QUEUE_CONFIGS[keyof typeof QUEUE_CONFIGS]) {
  const jobName = config.jobNames[Math.floor(Math.random() * config.jobNames.length)];
  const data: Record<string, any> = {
    userId: `usr_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };

  if (queueName === "webhook-deliver") {
    data.url = `https://api.example.com/webhook/${Math.random().toString(36).slice(2, 8)}`;
    data.event = ["order.created", "user.signup", "payment.failed"][Math.floor(Math.random() * 3)];
  }
  if (queueName === "payment-process") {
    data.amount = Math.floor(Math.random() * 50000) / 100;
    data.currency = "USD";
  }

  const opts: any = {
    attempts: config.retryAttempts,
    ...(config.retryAttempts > 1 && {
      backoff: { type: "exponential", delay: 1000 },
    }),
  };

  if ("delayMs" in config && config.delayMs) {
    opts.delay = config.delayMs.min + Math.random() * (config.delayMs.max - config.delayMs.min);
  }

  return { jobName, data, opts };
}

function startTimer(queueName: string, state: ProducerState) {
  if (state.timer) clearInterval(state.timer);
  if (state.jobsPerMinute <= 0) return;

  const config = QUEUE_CONFIGS[queueName as keyof typeof QUEUE_CONFIGS];
  const intervalMs = (60 / state.jobsPerMinute) * 1000;

  state.timer = setInterval(async () => {
    const { jobName, data, opts } = buildJobData(queueName, config);
    await state.queue.add(jobName, data, opts);
  }, intervalMs);
}

export function initProducers() {
  for (const [queueName, config] of Object.entries(QUEUE_CONFIGS)) {
    producers[queueName] = {
      queue: new Queue(queueName, { connection: connection.duplicate() }),
      timer: null,
      jobsPerMinute: config.jobsPerMinute,
      running: false,
    };
  }
  console.log("  Producers initialized (idle — use control panel to start)");
}

export function startProducer(queueName: string) {
  const state = producers[queueName];
  if (!state || state.running) return;
  state.running = true;
  startTimer(queueName, state);
  console.log(`[producer] ${queueName} started (${state.jobsPerMinute} jobs/min)`);
}

export function stopProducer(queueName: string) {
  const state = producers[queueName];
  if (!state || !state.running) return;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  console.log(`[producer] ${queueName} stopped`);
}

export function setProducerRate(queueName: string, jobsPerMinute: number) {
  const state = producers[queueName];
  if (!state) return;
  state.jobsPerMinute = jobsPerMinute;
  if (state.running) {
    if (state.timer) clearInterval(state.timer);
    startTimer(queueName, state);
  }
  console.log(`[producer] ${queueName} rate set to ${jobsPerMinute} jobs/min`);
}

export function startAllProducers() {
  for (const queueName of Object.keys(producers)) {
    startProducer(queueName);
  }
}

export function stopAllProducers() {
  for (const queueName of Object.keys(producers)) {
    stopProducer(queueName);
  }
}

export function getProducerStates(): Record<string, { running: boolean; jobsPerMinute: number }> {
  const result: Record<string, { running: boolean; jobsPerMinute: number }> = {};
  for (const [name, state] of Object.entries(producers)) {
    result[name] = { running: state.running, jobsPerMinute: state.jobsPerMinute };
  }
  return result;
}

export function addSingleJob(queueName: string, count: number = 1) {
  const config = QUEUE_CONFIGS[queueName as keyof typeof QUEUE_CONFIGS];
  const state = producers[queueName];
  if (!config || !state) return 0;

  const jobs = Array.from({ length: count }, () => {
    const { jobName, data, opts } = buildJobData(queueName, config);
    return { name: jobName, data, opts };
  });

  state.queue.addBulk(jobs);
  return count;
}

export function getQueue(queueName: string): Queue | null {
  return producers[queueName]?.queue || null;
}
