import { FlowProducer, Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

let flowProducer: FlowProducer | null = null;

function getFlowProducer(): FlowProducer {
  if (!flowProducer) {
    flowProducer = new FlowProducer({ connection: connection.duplicate() });
  }
  return flowProducer;
}

/**
 * Create a realistic 3-level flow tree:
 *   report-monthly (parent)
 *     └─ data-enrich × 3 (children)
 *         └─ email-send × 2 each (grandchildren)
 *
 * All children will eventually complete via the existing workers,
 * allowing Damasqas to observe the full flow lifecycle.
 */
export async function createMultiLevelFlow(): Promise<{ parentQueue: string; parentId: string }> {
  const fp = getFlowProducer();

  const flow = await fp.add({
    name: "generateMonthlyReport",
    queueName: "report-monthly",
    data: {
      reportType: "monthly-summary",
      month: "2026-03",
      requestedBy: "usr_flow_test",
    },
    children: [
      {
        name: "enrichCompany",
        queueName: "data-enrich",
        data: { companyId: "comp_alpha", source: "flow-test" },
        children: [
          {
            name: "sendNotification",
            queueName: "email-send",
            data: { to: "alpha-1@example.com", template: "enrichment-complete", source: "flow-test" },
          },
          {
            name: "sendNotification",
            queueName: "email-send",
            data: { to: "alpha-2@example.com", template: "enrichment-complete", source: "flow-test" },
          },
        ],
      },
      {
        name: "enrichCompany",
        queueName: "data-enrich",
        data: { companyId: "comp_beta", source: "flow-test" },
        children: [
          {
            name: "sendNotification",
            queueName: "email-send",
            data: { to: "beta-1@example.com", template: "enrichment-complete", source: "flow-test" },
          },
          {
            name: "sendNotification",
            queueName: "email-send",
            data: { to: "beta-2@example.com", template: "enrichment-complete", source: "flow-test" },
          },
        ],
      },
      {
        name: "enrichContact",
        queueName: "data-enrich",
        data: { contactId: "contact_gamma", source: "flow-test" },
        children: [
          {
            name: "sendInvoice",
            queueName: "email-send",
            data: { to: "gamma@example.com", template: "invoice", source: "flow-test" },
          },
          {
            name: "sendWelcomeEmail",
            queueName: "email-send",
            data: { to: "gamma-welcome@example.com", template: "welcome", source: "flow-test" },
          },
        ],
      },
    ],
  });

  const parentId = flow.job.id!;
  console.log(`[flows] Created 3-level flow tree. Parent: report-monthly#${parentId} (9 total jobs)`);
  return { parentQueue: "report-monthly", parentId };
}

/**
 * Create a deadlock scenario: a parent job waiting on a child that has
 * permanently failed (exhausted all retry attempts).
 *
 * The child is added to a dedicated queue 'deadlock-child' with a worker
 * that always throws. The parent sits in waiting-children forever.
 */
export async function createDeadlockFlow(): Promise<{ parentQueue: string; parentId: string }> {
  const fp = getFlowProducer();

  // Create a temporary worker that always fails for the deadlock child queue
  const { Worker } = await import("bullmq");
  const deadlockWorker = new Worker(
    "deadlock-child",
    async () => {
      throw new Error("Permanent failure: service unavailable (deadlock test)");
    },
    {
      connection: connection.duplicate(),
      concurrency: 1,
    },
  );

  const flow = await fp.add({
    name: "generateMonthlyReport",
    queueName: "report-monthly",
    data: {
      reportType: "deadlock-test",
      requestedBy: "usr_deadlock_test",
    },
    children: [
      {
        name: "enrichCompany",
        queueName: "deadlock-child",
        data: { companyId: "comp_deadlock", source: "deadlock-test" },
        opts: {
          attempts: 1, // No retries — will permanently fail
        },
      },
    ],
  });

  const parentId = flow.job.id!;
  console.log(`[flows] Created deadlock flow. Parent: report-monthly#${parentId}`);
  console.log(`[flows] Child in 'deadlock-child' queue will fail permanently (attempts: 1)`);

  // Close the worker after the child has had time to fail
  setTimeout(() => {
    deadlockWorker.close().catch(() => {});
    console.log("[flows] Deadlock child worker closed");
  }, 10000);

  return { parentQueue: "report-monthly", parentId };
}

/**
 * Create a waiting-children scenario: parent with 3 children where
 * only some will complete. We achieve this by adding children to a
 * queue with no workers ('stalled-child').
 */
export async function createWaitingChildrenFlow(): Promise<{ parentQueue: string; parentId: string }> {
  const fp = getFlowProducer();

  const flow = await fp.add({
    name: "generateMonthlyReport",
    queueName: "report-monthly",
    data: {
      reportType: "waiting-children-test",
      requestedBy: "usr_wc_test",
    },
    children: [
      {
        name: "sendNotification",
        queueName: "email-send", // Has workers — will complete
        data: { to: "wc-complete@example.com", template: "test", source: "wc-test" },
      },
      {
        name: "enrichCompany",
        queueName: "stalled-child", // No workers — will stay pending
        data: { companyId: "comp_stalled_1", source: "wc-test" },
      },
      {
        name: "enrichCompany",
        queueName: "stalled-child", // No workers — will stay pending
        data: { companyId: "comp_stalled_2", source: "wc-test" },
      },
    ],
  });

  const parentId = flow.job.id!;
  console.log(`[flows] Created waiting-children flow. Parent: report-monthly#${parentId}`);
  console.log(`[flows] 1 child will complete (email-send), 2 will stay pending (stalled-child)`);
  return { parentQueue: "report-monthly", parentId };
}
