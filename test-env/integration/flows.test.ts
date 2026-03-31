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
  createFlowProducer,
  fetchApi,
  waitForCondition,
  waitForQueueDiscovery,
} from "./helpers";

describe("Flow Visualization & Deadlock Detection", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("builds a flow tree with parent-child relationships", async () => {
    const redis = getRedis();
    const fp = createFlowProducer(redis);

    // Create a simple 2-level flow
    const parentQueue = createQueue("flow-parent", redis);
    const childQueue = createQueue("flow-child", redis);

    // Start workers that complete immediately
    const parentWorker = createWorker("flow-parent", redis, async () => ({ ok: true }));
    const childWorker = createWorker("flow-child", redis, async () => ({ ok: true }));

    const flow = await fp.add({
      name: "parentJob",
      queueName: "flow-parent",
      data: { source: "flow-test" },
      children: [
        {
          name: "childJobA",
          queueName: "flow-child",
          data: { child: "a" },
        },
        {
          name: "childJobB",
          queueName: "flow-child",
          data: { child: "b" },
        },
      ],
    });

    const parentId = flow.job.id!;

    // Wait for Damasqas to discover the queues
    await waitForQueueDiscovery("flow-parent", 30_000);

    // Wait for jobs to be processed
    await sleep(5000);

    // Query the flow tree
    const tree = await fetchApi<{ tree: any }>(
      `/api/flows/tree/flow-parent/${parentId}`,
    );

    expect(tree.tree).toBeDefined();
    expect(tree.tree.jobId).toBe(parentId);
    expect(tree.tree.queue).toBe("flow-parent");
    expect(tree.tree.name).toBe("parentJob");
    expect(tree.tree.children).toHaveLength(2);

    // Children should reference the flow-child queue
    for (const child of tree.tree.children) {
      expect(child.queue).toBe("flow-child");
      expect(["childJobA", "childJobB"]).toContain(child.name);
    }

    await parentWorker.close();
    await childWorker.close();
    await parentQueue.close();
    await childQueue.close();
    await fp.close();
  });

  it("detects deadlocked flows (child failed, no retries left)", async () => {
    const redis = getRedis();
    const fp = createFlowProducer(redis);

    // Create a queue for deadlock children
    const deadlockQueue = createQueue("deadlock-detect", redis);

    // Worker that always fails
    const failWorker = createWorker(
      "deadlock-detect",
      redis,
      async () => {
        throw new Error("Permanent failure for deadlock test");
      },
    );

    const flow = await fp.add({
      name: "deadlockParent",
      queueName: "flow-parent",
      data: { source: "deadlock-test" },
      children: [
        {
          name: "deadlockChild",
          queueName: "deadlock-detect",
          data: { willFail: true },
          opts: { attempts: 1 }, // No retries
        },
      ],
    });

    const parentId = flow.job.id!;

    // Wait for the child to fail and the deadlock scan to run
    // Damasqas scans for deadlocks every ~5 minutes, but we can poll the API
    await waitForCondition(
      async () => {
        try {
          const res = await fetchApi<{ deadlocks: any[] }>("/api/flows/deadlocks");
          return res.deadlocks.some(
            (d) => d.parentJobId === parentId || d.childName === "deadlockChild",
          );
        } catch {
          return false;
        }
      },
      90_000, // Deadlock scan may take a while
      5000,
      "deadlock detection",
    );

    const deadlocks = await fetchApi<{ deadlocks: any[] }>("/api/flows/deadlocks");
    const found = deadlocks.deadlocks.find(
      (d) => d.parentJobId === parentId,
    );

    expect(found).toBeDefined();
    expect(found.childName).toBe("deadlockChild");
    expect(found.childQueue).toBe("deadlock-detect");
    expect(found.childError).toContain("Permanent failure");

    await failWorker.close();
    await deadlockQueue.close();
    await fp.close();
  });

  it("lists waiting-children jobs", async () => {
    const redis = getRedis();
    const fp = createFlowProducer(redis);

    // Create a flow where children are in a queue with no workers
    const stalledQueue = createQueue("stalled-wc", redis);

    const flow = await fp.add({
      name: "waitingParent",
      queueName: "flow-parent",
      data: { source: "wc-test" },
      children: [
        {
          name: "stalledChild1",
          queueName: "stalled-wc",
          data: { index: 1 },
        },
        {
          name: "stalledChild2",
          queueName: "stalled-wc",
          data: { index: 2 },
        },
      ],
    });

    // Wait for Damasqas to discover the queue
    await waitForQueueDiscovery("flow-parent", 30_000);
    await sleep(5000);

    const result = await fetchApi<{ jobs: any[] }>(
      "/api/flows/waiting-children?queue=flow-parent",
    );

    // The parent should appear in waiting-children
    const parent = result.jobs.find(
      (j) => j.jobId === flow.job.id,
    );

    expect(parent).toBeDefined();
    expect(parent.pendingChildren).toBeGreaterThanOrEqual(2);
    expect(parent.name).toBe("waitingParent");

    await stalledQueue.close();
    await fp.close();
  });
});
