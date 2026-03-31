import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getRedis,
  startDamasqas,
  teardown,
  flushRedis,
  sleep,
} from "./setup";
import {
  createQueue,
  createWorker,
  fetchApi,
  postApi,
  waitForCondition,
  waitForQueueDiscovery,
} from "./helpers";

describe("Overdue Delayed Job Detection & Promotion", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("detects overdue delayed jobs", async () => {
    const redis = getRedis();
    const queue = createQueue("overdue-test", redis);
    const prefix = "bull";

    // Create job hashes and add to the delayed sorted set with PAST timestamps.
    // BullMQ v4+ packs delayed scores as: timestamp * 0x1000 + sequenceCounter
    const now = Date.now();
    const pipeline = redis.pipeline();

    const overdueJobs = [
      { id: "overdue-a", name: "overdueJob", overdueBy: 120_000 },
      { id: "overdue-b", name: "overdueJob", overdueBy: 300_000 },
      { id: "overdue-c", name: "overdueJob", overdueBy: 600_000 },
    ];

    for (const job of overdueJobs) {
      const scheduledTime = now - job.overdueBy;
      const packedScore = scheduledTime * 0x1000;

      pipeline.hmset(`${prefix}:overdue-test:${job.id}`, {
        name: job.name,
        data: JSON.stringify({ source: "overdue-integration-test" }),
        opts: JSON.stringify({ delay: job.overdueBy, attempts: 1 }),
        timestamp: String(scheduledTime),
        delay: String(job.overdueBy),
        attemptsMade: "0",
        priority: "0",
      });
      pipeline.zadd(`${prefix}:overdue-test:delayed`, String(packedScore), job.id);
    }

    // Also add a non-overdue job (5 minutes in the future)
    const futureTime = now + 300_000;
    pipeline.hmset(`${prefix}:overdue-test:future-1`, {
      name: "futureJob",
      data: JSON.stringify({ source: "overdue-integration-test" }),
      opts: JSON.stringify({ delay: 300_000, attempts: 1 }),
      timestamp: String(now),
      delay: "300000",
      attemptsMade: "0",
      priority: "0",
    });
    pipeline.zadd(
      `${prefix}:overdue-test:delayed`,
      String(futureTime * 0x1000),
      "future-1",
    );

    // Ensure the queue meta key exists so Damasqas discovers it
    pipeline.set(`${prefix}:overdue-test:meta`, JSON.stringify({ name: "overdue-test" }));

    await pipeline.exec();

    await waitForQueueDiscovery("overdue-test", 30_000);

    // Wait for collector to pick up overdue count
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ queues: any[] }>("/api/queues");
          const q = data.queues.find((q: any) => q.name === "overdue-test");
          return q && q.overdueDelayed > 0;
        } catch {
          return false;
        }
      },
      30_000,
      3000,
      "overdue delayed detection",
    );

    const queues = await fetchApi<{ queues: any[] }>("/api/queues");
    const overdueQueue = queues.queues.find((q: any) => q.name === "overdue-test");

    expect(overdueQueue).toBeDefined();
    expect(overdueQueue.overdueDelayed).toBe(3); // Only the 3 past-due ones

    await queue.close();
  });

  it("returns overdue job details via API", async () => {
    // The overdue jobs from the previous test should still be there
    const data = await fetchApi<{ jobs: any[] }>(
      "/api/queues/overdue-test/overdue-delayed",
    );

    expect(data.jobs).toBeDefined();
    expect(data.jobs.length).toBe(3);

    for (const job of data.jobs) {
      expect(job.overdueByMs).toBeGreaterThan(60_000); // At least 1 min overdue
      expect(job.name).toBe("overdueJob");
    }

    // Jobs should be sorted by how overdue they are
    expect(data.jobs[0].overdueByMs).toBeGreaterThanOrEqual(data.jobs[1].overdueByMs);
  });

  it("promotes overdue delayed jobs via API", async () => {
    // Promote all overdue jobs
    const result = await postApi<{ promoted: number }>(
      "/api/queues/overdue-test/promote-all",
      {},
    );

    expect(result.promoted).toBeGreaterThanOrEqual(3);

    // Wait for collector to refresh
    await sleep(5000);

    // Verify overdue count dropped
    const queues = await fetchApi<{ queues: any[] }>("/api/queues");
    const overdueQueue = queues.queues.find((q: any) => q.name === "overdue-test");

    expect(overdueQueue).toBeDefined();
    expect(overdueQueue.overdueDelayed).toBe(0);
  });
});
