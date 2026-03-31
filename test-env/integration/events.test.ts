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

describe("Event Timeline & Stream Cursor Persistence", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("captures completed and failed events from Redis Streams", async () => {
    const redis = getRedis();
    const queue = createQueue("events-test", redis);

    // Worker that completes every job
    const worker = createWorker("events-test", redis, async (job) => {
      if (job.data.shouldFail) {
        throw new Error("Intentional failure for event test");
      }
      return { processed: true };
    });

    // Add mix of jobs that will succeed and fail
    await queue.add("successJob", { index: 1 }, { attempts: 1 });
    await queue.add("successJob", { index: 2 }, { attempts: 1 });
    await queue.add("failJob", { shouldFail: true }, { attempts: 1 });

    await waitForQueueDiscovery("events-test", 30_000);

    // Wait for events to be captured by the EventStreamConsumer
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ events: any[] }>(
            "/api/events/search?queue=events-test&limit=10",
          );
          // Need at least completed + failed events
          const hasCompleted = data.events.some(
            (e: any) => e.eventType === "completed",
          );
          const hasFailed = data.events.some(
            (e: any) => e.eventType === "failed",
          );
          return hasCompleted && hasFailed;
        } catch {
          return false;
        }
      },
      30_000,
      3000,
      "event capture",
    );

    const events = await fetchApi<{ events: any[] }>(
      "/api/events/search?queue=events-test&limit=20",
    );

    const completedEvents = events.events.filter(
      (e: any) => e.eventType === "completed",
    );
    const failedEvents = events.events.filter(
      (e: any) => e.eventType === "failed",
    );

    expect(completedEvents.length).toBeGreaterThanOrEqual(2);
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);

    await worker.close();
    await queue.close();
  });

  it("hydrates job names from Redis", async () => {
    // Wait for hydration cycle (runs every 5s)
    await sleep(10_000);

    const events = await fetchApi<{ events: any[] }>(
      "/api/events/search?queue=events-test&limit=10",
    );

    // After hydration, events should have job names
    const hydratedEvents = events.events.filter(
      (e: any) => e.jobName && e.jobName !== "[deleted]",
    );

    expect(hydratedEvents.length).toBeGreaterThan(0);

    const names = hydratedEvents.map((e: any) => e.jobName);
    expect(names).toContain("successJob");
  });

  it("supports full-text search on job payloads", async () => {
    const redis = getRedis();
    const queue = createQueue("fts-test", redis);

    // Worker that processes everything
    const worker = createWorker("fts-test", redis, async () => ({ ok: true }));

    // Add a job with a unique, searchable payload
    await queue.add("searchableJob", {
      orderId: "INV-2026-FTS-UNIQUE-IDENTIFIER",
      customer: "acme-fts-corporation",
      amount: 999.99,
    });

    await waitForQueueDiscovery("fts-test", 30_000);

    // Wait for event capture + hydration (job name + payload indexing)
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ events: any[] }>(
            "/api/events/search?q=INV-2026-FTS-UNIQUE-IDENTIFIER",
          );
          return data.events && data.events.length > 0;
        } catch {
          return false;
        }
      },
      30_000,
      3000,
      "FTS payload indexing",
    );

    // Search by order ID
    const byOrderId = await fetchApi<{ events: any[] }>(
      "/api/events/search?q=INV-2026-FTS-UNIQUE-IDENTIFIER",
    );
    expect(byOrderId.events.length).toBeGreaterThan(0);

    // Search by customer name
    const byCustomer = await fetchApi<{ events: any[] }>(
      "/api/events/search?q=acme-fts-corporation",
    );
    expect(byCustomer.events.length).toBeGreaterThan(0);

    await worker.close();
    await queue.close();
  });

  it("filters events by type", async () => {
    const events = await fetchApi<{ events: any[] }>(
      "/api/events/search?queue=events-test&eventType=failed&limit=10",
    );

    expect(events.events.length).toBeGreaterThanOrEqual(1);
    for (const event of events.events) {
      expect(event.eventType).toBe("failed");
    }
  });

  it("captures diverse event types (paused/resumed)", async () => {
    const redis = getRedis();
    const queue = createQueue("pause-test", redis);

    // Add a job so the queue gets discovered
    await queue.add("testJob", { data: "pause-resume-test" });

    await waitForQueueDiscovery("pause-test", 30_000);
    await sleep(3000);

    // Pause and resume to generate those event types
    await queue.pause();
    await sleep(2000);
    await queue.resume();

    // Wait for paused/resumed events
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ events: any[] }>(
            "/api/events/search?queue=pause-test&limit=20",
          );
          const hasPaused = data.events.some(
            (e: any) => e.eventType === "paused",
          );
          const hasResumed = data.events.some(
            (e: any) => e.eventType === "resumed",
          );
          return hasPaused && hasResumed;
        } catch {
          return false;
        }
      },
      20_000,
      2000,
      "pause/resume events",
    );

    const events = await fetchApi<{ events: any[] }>(
      "/api/events/search?queue=pause-test&limit=20",
    );

    const types = events.events.map((e: any) => e.eventType);
    expect(types).toContain("paused");
    expect(types).toContain("resumed");

    await queue.close();
  });
});
