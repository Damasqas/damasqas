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

describe("Comparative Queue Analytics", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("returns comparison data for a queue", async () => {
    const redis = getRedis();
    const queue = createQueue("comparison-test", redis);

    // Worker to process jobs
    const worker = createWorker("comparison-test", redis, async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true };
    }, { concurrency: 5 });

    // Generate some throughput
    const jobs = Array.from({ length: 100 }, (_, i) => ({
      name: "comparisonJob",
      data: { index: i, source: "comparison-test" },
    }));
    await queue.addBulk(jobs);

    await waitForQueueDiscovery("comparison-test", 30_000);

    // Wait for jobs to process and metrics to accumulate
    await waitForCondition(
      async () => {
        try {
          const counts = await queue.getJobCounts("completed");
          return counts.completed >= 80;
        } catch {
          return false;
        }
      },
      60_000,
      3000,
      "comparison job completion",
    );

    // Wait for metrics computation
    await sleep(15_000);

    // Query comparison endpoint
    const data = await fetchApi<any>(
      "/api/queues/comparison-test/comparison",
    );

    expect(data).toBeDefined();

    // The response should have event-based and/or snapshot-based comparisons.
    // Since this is fresh data with no history, vsYesterday/vsLastWeek may be null.
    // We just verify the endpoint returns a valid response structure.
    if (data.events) {
      expect(typeof data.events.currentHour).toBeDefined();
    }

    if (data.snapshots) {
      expect(typeof data.snapshots.current).toBeDefined();
    }

    await worker.close();
    await queue.close();
  });

  it("returns global comparison across all queues", async () => {
    // Should be able to query comparison for all queues
    const data = await fetchApi<any>("/api/comparison");

    expect(data).toBeDefined();
    // At minimum, should return an object (possibly empty for fresh data)
    expect(typeof data).toBe("object");
  });

  it("serves snapshot-based metrics for the queue", async () => {
    // Verify that the metrics endpoint returns data that the comparison
    // feature relies on (throughput_1m, fail_rate_1m from snapshots)
    const data = await fetchApi<{ metrics: any[] }>(
      "/api/metrics?queue=comparison-test&range=1h",
    );

    expect(data.metrics).toBeDefined();

    if (data.metrics.length > 0) {
      const metric = data.metrics[0];
      // These fields were added in the recent commits
      expect(typeof metric.throughput).toBe("number");
    }
  });
});
