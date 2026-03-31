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
  waitForCondition,
  waitForQueueDiscovery,
} from "./helpers";

describe("Queue Drain Analysis & Capacity Planning", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("calculates drain rate and projected drain time", async () => {
    const redis = getRedis();
    const queue = createQueue("drain-rate-test", redis);

    // Add a backlog of jobs
    const jobs = Array.from({ length: 200 }, (_, i) => ({
      name: "drainJob",
      data: { index: i },
    }));
    await queue.addBulk(jobs);

    // Start a slow worker (200ms per job, concurrency 1)
    const worker = createWorker("drain-rate-test", redis, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true };
    });

    await waitForQueueDiscovery("drain-rate-test", 30_000);

    // Wait for enough snapshots for drain analysis (need 2+ in buffer)
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ drain: any }>(
            "/api/queues/drain-rate-test/drain",
          );
          return data.drain && data.drain.drainRate > 0;
        } catch {
          return false;
        }
      },
      60_000,
      3000,
      "drain rate calculation",
    );

    const drain = await fetchApi<{ drain: any }>(
      "/api/queues/drain-rate-test/drain",
    );

    expect(drain.drain).toBeDefined();
    expect(drain.drain.drainRate).toBeGreaterThan(0);
    expect(drain.drain.currentDepth).toBeGreaterThan(0);
    expect(typeof drain.drain.inflowRate).toBe("number");
    expect(typeof drain.drain.netRate).toBe("number");
    expect(typeof drain.drain.trend).toBe("string");

    await worker.close();
    await queue.close();
  });

  it("detects growing trend when inflow exceeds drain", async () => {
    const redis = getRedis();
    const queue = createQueue("drain-growing-test", redis);

    // Start a very slow worker
    const worker = createWorker(
      "drain-growing-test",
      redis,
      async () => {
        await new Promise((r) => setTimeout(r, 2000)); // 2s per job
        return { ok: true };
      },
      { concurrency: 1 },
    );

    await waitForQueueDiscovery("drain-growing-test", 30_000);

    // Continuously add jobs faster than they can be processed
    const addBatch = async () => {
      const jobs = Array.from({ length: 30 }, (_, i) => ({
        name: "growingJob",
        data: { index: i, batch: Date.now() },
      }));
      await queue.addBulk(jobs);
    };

    // Add jobs every 3 seconds for 30 seconds
    for (let i = 0; i < 10; i++) {
      await addBatch();
      await sleep(3000);
    }

    // Check drain analysis shows growing trend
    const drain = await fetchApi<{ drain: any }>(
      "/api/queues/drain-growing-test/drain",
    );

    expect(drain.drain).toBeDefined();
    expect(drain.drain.currentDepth).toBeGreaterThan(50);
    // The trend should be 'growing' since inflow >> drain
    expect(["growing", "stalled"]).toContain(drain.drain.trend);
    expect(drain.drain.capacityDeficit).toBeGreaterThan(0);

    await worker.close();
    await queue.close();
  });

  it("detects stalled trend when no workers are running", async () => {
    const redis = getRedis();
    const queue = createQueue("drain-stalled-test", redis);

    // Add jobs but don't start any workers
    const jobs = Array.from({ length: 100 }, (_, i) => ({
      name: "stalledJob",
      data: { index: i },
    }));
    await queue.addBulk(jobs);

    await waitForQueueDiscovery("drain-stalled-test", 30_000);

    // Wait for enough snapshots
    await sleep(15_000);

    const drain = await fetchApi<{ drain: any }>(
      "/api/queues/drain-stalled-test/drain",
    );

    expect(drain.drain).toBeDefined();
    expect(drain.drain.currentDepth).toBeGreaterThan(0);
    expect(drain.drain.drainRate).toBe(0);
    expect(drain.drain.trend).toBe("stalled");

    await queue.close();
  });
});
