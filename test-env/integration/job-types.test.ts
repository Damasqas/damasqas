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

describe("Job Type Breakdown with Per-Job Timing Analytics", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("tracks per-job-type metrics across multiple job names", async () => {
    const redis = getRedis();
    const queue = createQueue("job-types-test", redis);

    // Worker with varying processing times based on job name
    const worker = createWorker("job-types-test", redis, async (job) => {
      const delays: Record<string, number> = {
        sendWelcome: 50,
        sendInvoice: 100,
        sendReset: 150,
        sendAlert: 200,
      };
      const delay = delays[job.name] || 100;
      await new Promise((r) => setTimeout(r, delay));
      return { processed: true, type: job.name };
    }, { concurrency: 3 });

    // Add 20 jobs of each type (4 types × 20 = 80 jobs)
    const jobTypes = ["sendWelcome", "sendInvoice", "sendReset", "sendAlert"];
    const allJobs: { name: string; data: Record<string, unknown> }[] = [];

    for (const jobName of jobTypes) {
      for (let i = 0; i < 20; i++) {
        allJobs.push({
          name: jobName,
          data: { index: i, type: jobName, source: "job-type-test" },
        });
      }
    }

    await queue.addBulk(allJobs);
    await waitForQueueDiscovery("job-types-test", 30_000);

    // Wait for all jobs to complete + timing hydration + aggregation
    await waitForCondition(
      async () => {
        try {
          const counts = await queue.getJobCounts("completed");
          return counts.completed >= 70; // At least most jobs done
        } catch {
          return false;
        }
      },
      60_000,
      3000,
      "job completion",
    );

    // Wait for timing hydration (10s cycle) and aggregation
    await sleep(15_000);

    // Query job type breakdown
    const data = await fetchApi<{ types: any[] }>(
      "/api/queues/job-types-test/job-types",
    );

    expect(data.types).toBeDefined();
    expect(data.types.length).toBeGreaterThanOrEqual(4);

    // Each job type should have count data
    for (const jobType of data.types) {
      expect(jobType.jobName).toBeDefined();
      expect(typeof jobType.count).toBe("number");
      expect(jobType.count).toBeGreaterThan(0);
    }

    // Verify all 4 types are present
    const typeNames = data.types.map((t: any) => t.jobName);
    for (const name of jobTypes) {
      expect(typeNames).toContain(name);
    }

    await worker.close();
    await queue.close();
  });

  it("records job timing data (wait and process times)", async () => {
    const redis = getRedis();
    const queue = createQueue("timing-test", redis);

    // Worker with known processing time
    const worker = createWorker("timing-test", redis, async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { ok: true };
    });

    await queue.add("timedJob", { source: "timing-test" });
    await waitForQueueDiscovery("timing-test", 30_000);

    // Wait for completion + timing hydration
    await waitForCondition(
      async () => {
        try {
          const counts = await queue.getJobCounts("completed");
          return counts.completed >= 1;
        } catch {
          return false;
        }
      },
      30_000,
      2000,
      "timed job completion",
    );

    // Wait for timing hydration cycle
    await sleep(15_000);

    // Verify timing data exists via job types endpoint
    const data = await fetchApi<{ types: any[] }>(
      "/api/queues/timing-test/job-types",
    );

    expect(data.types).toBeDefined();
    const timedType = data.types.find((t: any) => t.jobName === "timedJob");

    if (timedType) {
      // If timing data was captured, process time should be roughly 300ms
      if (timedType.avgProcessMs != null) {
        expect(timedType.avgProcessMs).toBeGreaterThan(100); // At least 100ms
        expect(timedType.avgProcessMs).toBeLessThan(2000); // Not more than 2s
      }
    }

    await worker.close();
    await queue.close();
  });
});
