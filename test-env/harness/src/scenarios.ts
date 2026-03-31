import Redis from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_CONFIGS } from "./queues";
import { addSingleJob, getQueue } from "./producer";
import {
  createMultiLevelFlow,
  createDeadlockFlow,
  createWaitingChildrenFlow,
} from "./flows";

const redis = new Redis(process.env.REDIS_URL!);
const DAMASQAS_URL = process.env.DAMASQAS_URL || "http://localhost:3888";

// Track which scenarios have been run
const scenarioStatus: Record<string, { ran: boolean; ts: number; result: string }> = {};

function markRan(name: string, result: string) {
  scenarioStatus[name] = { ran: true, ts: Date.now(), result };
  console.log(`[scenario:${name}] ${result}`);
}

export function getScenarioStatus() {
  return scenarioStatus;
}

// ─── 1. Flow Visualization & Deadlock Detection ──────────

export async function runFlowScenario(): Promise<string> {
  const results: string[] = [];

  // Multi-level flow tree (parent → 3 children → 6 grandchildren)
  const tree = await createMultiLevelFlow();
  results.push(`Multi-level flow: ${tree.parentQueue}#${tree.parentId}`);

  // Deadlock: parent waiting on permanently-failed child
  const deadlock = await createDeadlockFlow();
  results.push(`Deadlock flow: ${deadlock.parentQueue}#${deadlock.parentId}`);

  // Waiting-children: parent with incomplete children
  const wc = await createWaitingChildrenFlow();
  results.push(`Waiting-children flow: ${wc.parentQueue}#${wc.parentId}`);

  const msg = `Created 3 flow scenarios: ${results.join("; ")}`;
  markRan("flows", msg);
  return msg;
}

// ─── 2. Overdue Delayed Job Detection ────────────────────

export async function runOverdueScenario(): Promise<string> {
  const queue = "scheduled-cleanup";
  const prefix = "bull";

  // Create job hashes and add to the delayed sorted set with past timestamps.
  // BullMQ v4+ packs scores as: timestamp * 0x1000 + sequenceCounter
  const now = Date.now();
  const overdueJobs = [
    { id: "overdue-1", name: "cleanExpiredSessions", overdueBy: 120_000 },
    { id: "overdue-2", name: "cleanExpiredSessions", overdueBy: 180_000 },
    { id: "overdue-3", name: "archiveOldRecords", overdueBy: 300_000 },
    { id: "overdue-4", name: "archiveOldRecords", overdueBy: 90_000 },
    { id: "overdue-5", name: "cleanExpiredSessions", overdueBy: 600_000 },
  ];

  const futureJobs = [
    { id: "future-1", name: "cleanExpiredSessions", delayMs: 300_000 },
    { id: "future-2", name: "archiveOldRecords", delayMs: 600_000 },
    { id: "future-3", name: "cleanExpiredSessions", delayMs: 900_000 },
  ];

  const pipeline = redis.pipeline();

  for (const job of overdueJobs) {
    const scheduledTime = now - job.overdueBy;
    const packedScore = scheduledTime * 0x1000; // BullMQ packed score format

    // Create job hash
    pipeline.hmset(`${prefix}:${queue}:${job.id}`, {
      name: job.name,
      data: JSON.stringify({
        source: "overdue-test",
        scheduledFor: new Date(scheduledTime).toISOString(),
      }),
      opts: JSON.stringify({ delay: job.overdueBy, attempts: 1 }),
      timestamp: String(scheduledTime),
      delay: String(job.overdueBy),
      attemptsMade: "0",
      priority: "0",
    });

    // Add to delayed sorted set
    pipeline.zadd(`${prefix}:${queue}:delayed`, String(packedScore), job.id);
  }

  for (const job of futureJobs) {
    const scheduledTime = now + job.delayMs;
    const packedScore = scheduledTime * 0x1000;

    pipeline.hmset(`${prefix}:${queue}:${job.id}`, {
      name: job.name,
      data: JSON.stringify({
        source: "overdue-test",
        scheduledFor: new Date(scheduledTime).toISOString(),
      }),
      opts: JSON.stringify({ delay: job.delayMs, attempts: 1 }),
      timestamp: String(now),
      delay: String(job.delayMs),
      attemptsMade: "0",
      priority: "0",
    });

    pipeline.zadd(`${prefix}:${queue}:delayed`, String(packedScore), job.id);
  }

  await pipeline.exec();

  const msg = `Created ${overdueJobs.length} overdue + ${futureJobs.length} future delayed jobs in ${queue}`;
  markRan("overdue", msg);
  return msg;
}

// ─── 3. Redis Memory Pressure & Slowlog ──────────────────

export async function runMemoryPressureScenario(): Promise<string> {
  const queue = "image-resize";
  const q = getQueue(queue);
  if (!q) return "Queue not found: " + queue;

  // Create 500 jobs with ~50KB payloads to stress Redis memory
  const largePayload = "X".repeat(50_000);
  const bulkJobs = Array.from({ length: 500 }, (_, i) => ({
    name: "resizeAvatar",
    data: {
      userId: `usr_mem_${i}`,
      imageData: largePayload,
      source: "memory-pressure-test",
      index: i,
    },
    opts: { attempts: 1 },
  }));

  // Add in batches of 100 to avoid overwhelming Redis
  for (let i = 0; i < bulkJobs.length; i += 100) {
    await q.addBulk(bulkJobs.slice(i, i + 100));
  }

  // Generate slowlog entries by running computationally expensive Lua scripts
  const slowLua = `
    local result = 0
    for i = 1, 500000 do
      result = result + i
    end
    return result
  `;
  for (let i = 0; i < 5; i++) {
    try {
      await redis.eval(slowLua, 0);
    } catch {
      // Ignore errors — we just want slowlog entries
    }
  }

  // Also create many small keys to stress key-size tracking
  const keyPipeline = redis.pipeline();
  for (let i = 0; i < 200; i++) {
    keyPipeline.lpush(`bull:${queue}:mem-test-wait`, `mem-job-${i}`);
  }
  await keyPipeline.exec();

  const msg = `Added 500 large-payload jobs (25MB total), 5 slow Lua evals, 200 extra wait keys to ${queue}`;
  markRan("memory", msg);
  return msg;
}

// ─── 4. Drain Imbalance (Inflow >> Drain) ────────────────

export async function runDrainImbalanceScenario(): Promise<string> {
  const queue = "webhook-deliver";

  // Set extreme slowdown on workers so drain rate drops dramatically
  await redis.set(
    `chaos:${queue}`,
    JSON.stringify({ failureRate: 0.03, slowdownFactor: 20 }),
  );

  // Flood with 2000 jobs
  addSingleJob(queue, 2000);

  // Also ensure producers are running to maintain inflow
  const { startProducer, setProducerRate } = await import("./producer");
  startProducer(queue);
  setProducerRate(queue, 120); // 2x normal rate

  const msg = `Flooded ${queue} with 2000 jobs + 20x slowdown + 120 jobs/min inflow. Drain analysis should show growing trend within 60s.`;
  markRan("drain", msg);
  return msg;
}

// ─── 5. Event Diversity & FTS Payloads ───────────────────

export async function runEventDiversityScenario(): Promise<string> {
  const results: string[] = [];

  // Add jobs with searchable payloads across multiple queues
  const searchableJobs: { queue: string; name: string; data: Record<string, unknown> }[] = [
    {
      queue: "payment-process",
      name: "processCharge",
      data: {
        orderId: "INV-2026-0042",
        customer: "acme-corp",
        paymentId: "stripe_pi_abc123",
        amount: 149.99,
        currency: "USD",
        source: "event-diversity-test",
      },
    },
    {
      queue: "payment-process",
      name: "processRefund",
      data: {
        orderId: "INV-2026-0043",
        customer: "globex-industries",
        refundReason: "product-defective",
        amount: 89.50,
        source: "event-diversity-test",
      },
    },
    {
      queue: "webhook-deliver",
      name: "deliverWebhook",
      data: {
        url: "https://api.example.com/webhook/order-complete",
        event: "order.completed",
        customerId: "cust_fts_test_001",
        source: "event-diversity-test",
      },
    },
    {
      queue: "email-send",
      name: "sendInvoice",
      data: {
        to: "billing@acme-corp.com",
        invoiceNumber: "INV-2026-SEARCHABLE",
        subject: "Your invoice for March 2026",
        source: "event-diversity-test",
      },
    },
    {
      queue: "data-enrich",
      name: "enrichCompany",
      data: {
        companyId: "comp_fts_unique_identifier",
        domain: "searchable-domain.example.com",
        source: "event-diversity-test",
      },
    },
  ];

  for (const job of searchableJobs) {
    const q = getQueue(job.queue);
    if (q) {
      await q.add(job.name, job.data, { attempts: 2 });
    }
  }
  results.push(`Added ${searchableJobs.length} searchable-payload jobs`);

  // Generate failed events by adding jobs with high failure chaos
  await redis.set(
    "chaos:payment-process",
    JSON.stringify({ failureRate: 0.8, slowdownFactor: 1 }),
  );
  const q = getQueue("payment-process");
  if (q) {
    const failJobs = Array.from({ length: 20 }, (_, i) => ({
      name: "processCharge",
      data: {
        orderId: `FAIL-EVT-${i}`,
        customer: "fail-test-customer",
        amount: Math.random() * 100,
        source: "event-diversity-fail-test",
      },
      opts: { attempts: 1 },
    }));
    await q.addBulk(failJobs);
    results.push("Added 20 high-failure jobs to payment-process");
  }

  // Reset chaos after 30 seconds
  setTimeout(async () => {
    const config = QUEUE_CONFIGS["payment-process"];
    await redis.set(
      "chaos:payment-process",
      JSON.stringify({ failureRate: config.baselineFailureRate, slowdownFactor: 1 }),
    );
    console.log("[scenario:events] Reset payment-process chaos");
  }, 30000);

  // Pause and resume a queue to generate those event types
  const emailQueue = getQueue("email-send");
  if (emailQueue) {
    await emailQueue.pause();
    results.push("Paused email-send");
    setTimeout(async () => {
      await emailQueue.resume();
      results.push("Resumed email-send");
      console.log("[scenario:events] Resumed email-send");
    }, 5000);
  }

  const msg = results.join(". ");
  markRan("events", msg);
  return msg;
}

// ─── 6. Job Type Diversity ───────────────────────────────

export async function runJobTypeDiversityScenario(): Promise<string> {
  const queue = "email-send";
  const q = getQueue(queue);
  if (!q) return "Queue not found: " + queue;

  const jobNames = ["sendWelcomeEmail", "sendPasswordReset", "sendInvoice", "sendNotification"];
  const allJobs: { name: string; data: Record<string, unknown>; opts: { attempts: number } }[] = [];

  for (const jobName of jobNames) {
    for (let i = 0; i < 50; i++) {
      allJobs.push({
        name: jobName,
        data: {
          userId: `usr_jt_${jobName}_${i}`,
          to: `${jobName}-${i}@example.com`,
          template: jobName,
          source: "job-type-diversity-test",
          batchIndex: i,
        },
        opts: { attempts: 2 },
      });
    }
  }

  // Shuffle to intermix job types
  for (let i = allJobs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allJobs[i], allJobs[j]] = [allJobs[j]!, allJobs[i]!];
  }

  // Add in batches
  for (let i = 0; i < allJobs.length; i += 50) {
    await q.addBulk(allJobs.slice(i, i + 50));
  }

  const msg = `Added ${allJobs.length} jobs (${jobNames.length} types × 50 each) to ${queue}`;
  markRan("job-types", msg);
  return msg;
}

// ─── 7. Alert Rules ──────────────────────────────────────

export async function runAlertRulesScenario(): Promise<string> {
  const rules = [
    {
      name: "Test: Failure Spike on email-send",
      queue: "email-send",
      type: "failure_spike",
      config: { threshold: 0.5 },
      cooldownSeconds: 10,
    },
    {
      name: "Test: Depth Threshold on webhook-deliver",
      queue: "webhook-deliver",
      type: "depth_threshold",
      config: { threshold: 100 },
      cooldownSeconds: 10,
    },
    {
      name: "Test: Overdue Delayed on scheduled-cleanup",
      queue: "scheduled-cleanup",
      type: "overdue_delayed",
      config: { threshold: 30000 },
      cooldownSeconds: 10,
    },
    {
      name: "Test: Orphaned Active on payment-process",
      queue: "payment-process",
      type: "orphaned_active",
      config: { threshold: 0 },
      cooldownSeconds: 10,
    },
    {
      name: "Test: Redis Memory (100MB)",
      queue: null,
      type: "redis_memory",
      config: { memoryThresholdBytes: 100 * 1024 * 1024 },
      cooldownSeconds: 10,
    },
    {
      name: "Test: Drain Negative on webhook-deliver",
      queue: "webhook-deliver",
      type: "drain_negative",
      config: { threshold: 0 },
      cooldownSeconds: 10,
    },
  ];

  const results: string[] = [];

  for (const rule of rules) {
    try {
      const res = await fetch(`${DAMASQAS_URL}/api/alerts/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rule.name,
          queue: rule.queue,
          type: rule.type,
          config: JSON.stringify(rule.config),
          cooldownSeconds: rule.cooldownSeconds,
          enabled: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        results.push(`${rule.type}: rule #${data.id}`);
      } else {
        const text = await res.text();
        results.push(`${rule.type}: FAILED (${res.status}: ${text})`);
      }
    } catch (err) {
      results.push(`${rule.type}: ERROR (${err})`);
    }
  }

  const msg = `Created ${rules.length} alert rules: ${results.join(", ")}`;
  markRan("alerts", msg);
  return msg;
}

// ─── Run All Scenarios ───────────────────────────────────

export async function runAllScenarios(): Promise<string> {
  const results: string[] = [];

  console.log("\n=== Running All Feature Test Scenarios ===\n");

  try {
    results.push(await runFlowScenario());
  } catch (err) {
    results.push(`flows: ERROR - ${err}`);
  }

  try {
    results.push(await runOverdueScenario());
  } catch (err) {
    results.push(`overdue: ERROR - ${err}`);
  }

  try {
    results.push(await runMemoryPressureScenario());
  } catch (err) {
    results.push(`memory: ERROR - ${err}`);
  }

  try {
    results.push(await runDrainImbalanceScenario());
  } catch (err) {
    results.push(`drain: ERROR - ${err}`);
  }

  try {
    results.push(await runEventDiversityScenario());
  } catch (err) {
    results.push(`events: ERROR - ${err}`);
  }

  try {
    results.push(await runJobTypeDiversityScenario());
  } catch (err) {
    results.push(`job-types: ERROR - ${err}`);
  }

  try {
    results.push(await runAlertRulesScenario());
  } catch (err) {
    results.push(`alerts: ERROR - ${err}`);
  }

  console.log("\n=== All Scenarios Complete ===\n");
  return results.join("\n");
}
