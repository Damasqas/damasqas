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

describe("Rule-Based Alerting", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("creates and lists alert rules via API", async () => {
    const rule = await postApi<{ id: number; name: string }>(
      "/api/alerts/rules",
      {
        name: "Test: failure_spike",
        queue: "alert-spike-test",
        type: "failure_spike",
        config: JSON.stringify({ threshold: 0.1 }),
        cooldownSeconds: 10,
        enabled: true,
      },
    );

    expect(rule.id).toBeDefined();
    expect(rule.name).toBe("Test: failure_spike");

    // List rules
    const list = await fetchApi<{ rules: any[] }>("/api/alerts/rules");
    expect(list.rules.length).toBeGreaterThanOrEqual(1);
    expect(list.rules.some((r: any) => r.id === rule.id)).toBe(true);
  });

  it("fires failure_spike alert when failure rate exceeds threshold", async () => {
    const redis = getRedis();
    const queue = createQueue("alert-spike-test", redis);

    // Worker that always fails
    const worker = createWorker("alert-spike-test", redis, async () => {
      throw new Error("Alert test failure");
    });

    // Add jobs that will all fail
    const jobs = Array.from({ length: 30 }, (_, i) => ({
      name: "failJob",
      data: { index: i },
      opts: { attempts: 1 },
    }));
    await queue.addBulk(jobs);

    await waitForQueueDiscovery("alert-spike-test", 30_000);

    // Wait for the alert to fire (need evaluation cycle + sufficient fail rate)
    await waitForCondition(
      async () => {
        try {
          const fires = await fetchApi<{ fires: any[] }>(
            "/api/alerts/fires?limit=50",
          );
          return fires.fires.some(
            (f: any) => {
              const payload = typeof f.payload === "string" ? JSON.parse(f.payload) : f.payload;
              return payload.ruleType === "failure_spike" && payload.queue === "alert-spike-test";
            },
          );
        } catch {
          return false;
        }
      },
      60_000,
      5000,
      "failure_spike alert fire",
    );

    const fires = await fetchApi<{ fires: any[] }>("/api/alerts/fires?limit=50");
    const spikeFire = fires.fires.find((f: any) => {
      const payload = typeof f.payload === "string" ? JSON.parse(f.payload) : f.payload;
      return payload.ruleType === "failure_spike" && payload.queue === "alert-spike-test";
    });

    expect(spikeFire).toBeDefined();

    await worker.close();
    await queue.close();
  });

  it("creates and fires depth_threshold alert", async () => {
    const redis = getRedis();
    const queue = createQueue("alert-depth-test", redis);

    // Create rule with low threshold
    const rule = await postApi<{ id: number }>("/api/alerts/rules", {
      name: "Test: depth_threshold",
      queue: "alert-depth-test",
      type: "depth_threshold",
      config: JSON.stringify({ threshold: 20 }),
      cooldownSeconds: 10,
      enabled: true,
    });

    // Add jobs without workers to build depth
    const jobs = Array.from({ length: 50 }, (_, i) => ({
      name: "depthJob",
      data: { index: i },
    }));
    await queue.addBulk(jobs);

    await waitForQueueDiscovery("alert-depth-test", 30_000);

    // Wait for depth_threshold alert to fire
    await waitForCondition(
      async () => {
        try {
          const history = await fetchApi<{ fires: any[] }>(
            `/api/alerts/rules/${rule.id}/history`,
          );
          return history.fires.length > 0;
        } catch {
          return false;
        }
      },
      60_000,
      5000,
      "depth_threshold alert fire",
    );

    const history = await fetchApi<{ fires: any[] }>(
      `/api/alerts/rules/${rule.id}/history`,
    );
    expect(history.fires.length).toBeGreaterThanOrEqual(1);

    const payload = typeof history.fires[0].payload === "string"
      ? JSON.parse(history.fires[0].payload)
      : history.fires[0].payload;
    expect(payload.ruleType).toBe("depth_threshold");
    expect(payload.snapshot.waiting).toBeGreaterThan(20);

    await queue.close();
  });

  it("respects cooldown period between alert fires", async () => {
    // Create a rule with a long cooldown
    const rule = await postApi<{ id: number }>("/api/alerts/rules", {
      name: "Test: cooldown_check",
      queue: "alert-depth-test",  // Re-use queue with backlog
      type: "depth_threshold",
      config: JSON.stringify({ threshold: 10 }),
      cooldownSeconds: 300, // 5 minute cooldown
      enabled: true,
    });

    // Wait for one fire
    await waitForCondition(
      async () => {
        try {
          const history = await fetchApi<{ fires: any[] }>(
            `/api/alerts/rules/${rule.id}/history`,
          );
          return history.fires.length >= 1;
        } catch {
          return false;
        }
      },
      30_000,
      3000,
      "first cooldown alert fire",
    );

    // Wait two more evaluation cycles
    await sleep(20_000);

    // Should still only have 1 fire due to cooldown
    const history = await fetchApi<{ fires: any[] }>(
      `/api/alerts/rules/${rule.id}/history`,
    );
    expect(history.fires.length).toBe(1);
  });

  it("updates and deletes alert rules", async () => {
    // Create a rule
    const rule = await postApi<{ id: number }>("/api/alerts/rules", {
      name: "Test: to_delete",
      type: "depth_threshold",
      config: JSON.stringify({ threshold: 999 }),
      cooldownSeconds: 60,
      enabled: false,
    });

    // Update it
    const url = `/api/alerts/rules/${rule.id}`;
    const res = await fetch(`http://localhost:${process.env.DAMASQAS_PORT || 3899}${url}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test: updated_name", enabled: true }),
    });
    expect(res.ok).toBe(true);

    const updated = await fetchApi<any>(url.replace("/api/", "/api/"));
    // Verify through the list
    const list = await fetchApi<{ rules: any[] }>("/api/alerts/rules");
    const found = list.rules.find((r: any) => r.id === rule.id);
    expect(found.name).toBe("Test: updated_name");
    expect(found.enabled).toBe(true);

    // Delete it
    const delRes = await fetch(`http://localhost:${process.env.DAMASQAS_PORT || 3899}/api/alerts/rules/${rule.id}`, {
      method: "DELETE",
    });
    expect(delRes.ok).toBe(true);

    // Verify deletion
    const listAfter = await fetchApi<{ rules: any[] }>("/api/alerts/rules");
    expect(listAfter.rules.find((r: any) => r.id === rule.id)).toBeUndefined();
  });
});
