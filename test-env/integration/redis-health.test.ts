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
  fetchApi,
  waitForCondition,
  waitForQueueDiscovery,
} from "./helpers";

describe("Redis Health Monitoring & OOM Projection", () => {
  beforeAll(async () => {
    await flushRedis();
    await startDamasqas();
  });

  afterAll(async () => {
    await teardown();
  });

  it("collects Redis INFO snapshots with memory data", async () => {
    // Wait for at least one collection cycle (~10s analysis interval)
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ snapshot: any }>("/api/redis/health");
          return data.snapshot && data.snapshot.usedMemory > 0;
        } catch {
          return false;
        }
      },
      30_000,
      3000,
      "Redis health snapshot",
    );

    const health = await fetchApi<{ snapshot: any }>("/api/redis/health");

    expect(health.snapshot).toBeDefined();
    expect(health.snapshot.usedMemory).toBeGreaterThan(0);
    expect(health.snapshot.connectedClients).toBeGreaterThan(0);
    expect(typeof health.snapshot.opsPerSec).toBe("number");
  });

  it("returns Redis memory history timeline", async () => {
    // Wait for at least 2 snapshots
    await sleep(15_000);

    const history = await fetchApi<{ snapshots: any[] }>("/api/redis/history");

    expect(history.snapshots).toBeDefined();
    expect(history.snapshots.length).toBeGreaterThanOrEqual(1);

    const snap = history.snapshots[0];
    expect(snap.usedMemory).toBeGreaterThan(0);
    expect(typeof snap.ts).toBe("number");
  });

  it("tracks key sizes per queue", async () => {
    const redis = getRedis();
    const queue = createQueue("redis-health-test", redis);

    // Add jobs so there are keys to track
    const jobs = Array.from({ length: 50 }, (_, i) => ({
      name: "testJob",
      data: { index: i },
    }));
    await queue.addBulk(jobs);

    await waitForQueueDiscovery("redis-health-test", 30_000);

    // Key sizes are collected every ~5 minutes. For testing, just verify
    // the endpoint returns data (may need to wait for first collection).
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ sizes: any[] }>("/api/redis/key-sizes");
          return data.sizes && data.sizes.length > 0;
        } catch {
          return false;
        }
      },
      90_000, // Key sizes may take a while
      5000,
      "key size collection",
    );

    const sizes = await fetchApi<{ sizes: any[] }>("/api/redis/key-sizes");
    expect(sizes.sizes.length).toBeGreaterThan(0);

    // Should have entries with queue name and key type
    const entry = sizes.sizes[0];
    expect(entry.queue).toBeDefined();
    expect(entry.keyType).toBeDefined();
    expect(typeof entry.entryCount).toBe("number");

    await queue.close();
  });

  it("captures slowlog entries", async () => {
    const redis = getRedis();

    // Generate slow commands using expensive Lua
    const slowLua = `
      local result = 0
      for i = 1, 500000 do result = result + i end
      return result
    `;
    for (let i = 0; i < 3; i++) {
      try {
        await redis.eval(slowLua, 0);
      } catch {
        // Expected
      }
    }

    // Wait for slowlog collection
    await waitForCondition(
      async () => {
        try {
          const data = await fetchApi<{ entries: any[] }>("/api/redis/slowlog");
          return data.entries && data.entries.length > 0;
        } catch {
          return false;
        }
      },
      30_000,
      3000,
      "slowlog entries",
    );

    const slowlog = await fetchApi<{ entries: any[] }>("/api/redis/slowlog");
    expect(slowlog.entries.length).toBeGreaterThan(0);

    const entry = slowlog.entries[0];
    expect(typeof entry.durationUs).toBe("number");
    expect(entry.command).toBeDefined();
  });

  it("projects OOM timeline when memory is growing", async () => {
    const redis = getRedis();

    // Fill Redis with data to create measurable memory growth
    const largeData = "X".repeat(10_000);
    const pipeline = redis.pipeline();
    for (let i = 0; i < 200; i++) {
      pipeline.set(`oom-test:${i}`, largeData);
    }
    await pipeline.exec();

    // Wait for multiple snapshots showing growth
    await sleep(20_000);

    const health = await fetchApi<{
      snapshot: any;
      oomProjection: { hoursUntilOOM: number | null; growthRateMBPerHour: number };
    }>("/api/redis/health");

    expect(health.oomProjection).toBeDefined();
    expect(typeof health.oomProjection.growthRateMBPerHour).toBe("number");
    // hoursUntilOOM may be null if memory is stable/shrinking — that's fine

    // Cleanup
    const cleanPipeline = redis.pipeline();
    for (let i = 0; i < 200; i++) {
      cleanPipeline.del(`oom-test:${i}`);
    }
    await cleanPipeline.exec();
  });
});
