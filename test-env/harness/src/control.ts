import express from "express";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_CONFIGS } from "./queues";

const redis = new Redis(process.env.REDIS_URL!);
const app = express();
app.use(express.json());

// ─── Status ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(`
    <html>
    <head><title>Chaos Control</title>
    <style>
      body { font-family: monospace; background: #111; color: #aaa; padding: 40px; }
      h1 { color: #fff; }
      h2 { color: #fca5a5; margin-top: 30px; }
      button { background: #222; color: #fca5a5; border: 1px solid #333; padding: 8px 16px;
               margin: 4px; cursor: pointer; font-family: monospace; font-size: 13px; border-radius: 6px; }
      button:hover { background: #333; }
      .green { color: #4ade80; }
      .red { color: #ef4444; }
      pre { background: #1a1a1a; padding: 12px; border-radius: 6px; margin: 8px 0; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    </style>
    </head>
    <body>
    <h1>Damasqas Chaos Control</h1>
    <p>Click buttons to inject failures. Watch <a href="http://localhost:3888" style="color:#60a5fa">localhost:3888</a> react.</p>

    <div class="grid">
      <div>
        <h2>Failure Injection</h2>
        <p>Set failure rate for a queue (0.0 = no failures, 1.0 = 100% failure)</p>
        <button onclick="chaos('email-send', 0.9)">email-send &rarr; 90% failures</button>
        <button onclick="chaos('email-send', 0.5)">email-send &rarr; 50% failures</button>
        <button onclick="chaos('webhook-deliver', 0.8)">webhook-deliver &rarr; 80% failures</button>
        <button onclick="chaos('data-enrich', 1.0)">data-enrich &rarr; 100% failures</button>
        <button onclick="chaos('payment-process', 0.7)">payment-process &rarr; 70% failures</button>

        <h2>Slowdown</h2>
        <p>Multiply processing time (1 = normal, 10 = 10x slower)</p>
        <button onclick="slow('pdf-generate', 10)">pdf-generate &rarr; 10x slower</button>
        <button onclick="slow('data-enrich', 5)">data-enrich &rarr; 5x slower</button>
        <button onclick="slow('email-send', 3)">email-send &rarr; 3x slower</button>

        <h2>Bulk Produce</h2>
        <p>Flood a queue with jobs to test backlog detection</p>
        <button onclick="flood('email-send', 5000)">email-send &larr; 5000 jobs</button>
        <button onclick="flood('webhook-deliver', 2000)">webhook-deliver &larr; 2000 jobs</button>
        <button onclick="flood('image-resize', 10000)">image-resize &larr; 10000 jobs</button>
        <button onclick="flood('report-monthly', 50)">report-monthly &larr; 50 jobs (idle queue)</button>
      </div>
      <div>
        <h2>Recovery</h2>
        <button onclick="reset('email-send')">Reset email-send</button>
        <button onclick="reset('webhook-deliver')">Reset webhook-deliver</button>
        <button onclick="reset('data-enrich')">Reset data-enrich</button>
        <button onclick="reset('pdf-generate')">Reset pdf-generate</button>
        <button onclick="reset('payment-process')">Reset payment-process</button>
        <button onclick="resetAll()">Reset ALL to normal</button>

        <h2>Presets</h2>
        <p>Run a full scenario with one click</p>
        <button onclick="preset('spike')">Failure Spike (email-send 90% for 2 min)</button>
        <button onclick="preset('cascade')">Cascading Failure (spike &rarr; backlog &rarr; slow)</button>
        <button onclick="preset('flood')">Backlog Flood (5k jobs on email-send)</button>
        <button onclick="preset('slowdown')">System Slowdown (all queues 5x slower)</button>
        <button onclick="preset('mixed')">Mixed Errors (all error types on email-send)</button>

        <h2>Status</h2>
        <pre id="status">Loading...</pre>
        <button onclick="loadStatus()">Refresh Status</button>
      </div>
    </div>

    <script>
      async function chaos(queue, rate) {
        await fetch('/chaos/' + queue, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ failureRate: rate }) });
        loadStatus();
      }
      async function slow(queue, factor) {
        await fetch('/chaos/' + queue, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ slowdownFactor: factor }) });
        loadStatus();
      }
      async function flood(queue, count) {
        await fetch('/flood/' + queue, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ count }) });
        loadStatus();
      }
      async function reset(queue) {
        await fetch('/reset/' + queue, { method: 'POST' });
        loadStatus();
      }
      async function resetAll() {
        await fetch('/reset-all', { method: 'POST' });
        loadStatus();
      }
      async function preset(name) {
        await fetch('/preset/' + name, { method: 'POST' });
        loadStatus();
      }
      async function loadStatus() {
        const res = await fetch('/status');
        document.getElementById('status').textContent = JSON.stringify(await res.json(), null, 2);
      }
      loadStatus();
      setInterval(loadStatus, 5000);
    </script>
    </body></html>
  `);
});

// ─── Chaos Controls ─────────────────────────────────────

// Set chaos config for a queue
app.post("/chaos/:queue", async (req, res) => {
  const { queue } = req.params;
  const existing = await redis.get(`chaos:${queue}`);
  const current = existing ? JSON.parse(existing) : {
    failureRate: QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS]?.baselineFailureRate || 0.01,
    slowdownFactor: 1,
  };
  const updated = { ...current, ...req.body };
  await redis.set(`chaos:${queue}`, JSON.stringify(updated));
  console.log(`[chaos] ${queue} -> failureRate=${updated.failureRate}, slowdown=${updated.slowdownFactor}`);
  res.json({ queue, config: updated });
});

// Flood a queue with N jobs
app.post("/flood/:queue", async (req, res) => {
  const { queue } = req.params;
  const { count = 1000 } = req.body;
  const q = new Queue(queue, { connection: redis.duplicate() });
  const config = QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS];
  const jobName = config?.jobNames?.[0] || "floodJob";

  const jobs = Array.from({ length: count }, (_, i) => ({
    name: jobName,
    data: { userId: `flood_${i}`, flooded: true, index: i },
    opts: { attempts: 1 },
  }));

  await q.addBulk(jobs);
  console.log(`[chaos] Flooded ${queue} with ${count} jobs`);
  res.json({ queue, added: count });
});

// Reset a single queue to normal
app.post("/reset/:queue", async (req, res) => {
  const { queue } = req.params;
  const config = QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS];
  await redis.set(`chaos:${queue}`, JSON.stringify({
    failureRate: config?.baselineFailureRate || 0.01,
    slowdownFactor: 1,
  }));
  console.log(`[chaos] Reset ${queue} to normal`);
  res.json({ queue, status: "normal" });
});

// Reset everything
app.post("/reset-all", async (req, res) => {
  for (const [queue, config] of Object.entries(QUEUE_CONFIGS)) {
    await redis.set(`chaos:${queue}`, JSON.stringify({
      failureRate: config.baselineFailureRate,
      slowdownFactor: 1,
    }));
  }
  console.log("[chaos] All queues reset to normal");
  res.json({ status: "all normal" });
});

// Presets — one-click scenarios
app.post("/preset/:name", async (req, res) => {
  const { name } = req.params;

  switch (name) {
    case "spike":
      await redis.set(`chaos:email-send`, JSON.stringify({ failureRate: 0.9, slowdownFactor: 1 }));
      // Auto-reset after 2 minutes
      setTimeout(async () => {
        const config = QUEUE_CONFIGS["email-send"];
        await redis.set(`chaos:email-send`, JSON.stringify({
          failureRate: config.baselineFailureRate,
          slowdownFactor: 1,
        }));
        console.log("[chaos] Spike preset auto-reset");
      }, 120000);
      res.json({ preset: "spike", duration: "2 min", queue: "email-send" });
      break;

    case "cascade":
      // Step 1: email-send failures
      await redis.set(`chaos:email-send`, JSON.stringify({ failureRate: 0.7, slowdownFactor: 1 }));
      // Step 2: 30s later, slow down webhook-deliver
      setTimeout(async () => {
        await redis.set(`chaos:webhook-deliver`, JSON.stringify({ failureRate: 0.03, slowdownFactor: 5 }));
      }, 30000);
      // Step 3: 60s later, flood data-enrich
      setTimeout(async () => {
        const q = new Queue("data-enrich", { connection: redis.duplicate() });
        await q.addBulk(Array.from({ length: 500 }, (_, i) => ({
          name: "enrichCompany",
          data: { companyId: `cascade_${i}` },
          opts: { attempts: 1 },
        })));
      }, 60000);
      // Auto-reset after 3 minutes
      setTimeout(async () => {
        for (const queue of ["email-send", "webhook-deliver", "data-enrich"]) {
          const config = QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS];
          await redis.set(`chaos:${queue}`, JSON.stringify({
            failureRate: config.baselineFailureRate,
            slowdownFactor: 1,
          }));
        }
        console.log("[chaos] Cascade preset auto-reset");
      }, 180000);
      res.json({ preset: "cascade", duration: "3 min", queues: ["email-send", "webhook-deliver", "data-enrich"] });
      break;

    case "flood": {
      const q = new Queue("email-send", { connection: redis.duplicate() });
      await q.addBulk(Array.from({ length: 5000 }, (_, i) => ({
        name: "sendWelcomeEmail",
        data: { userId: `flood_${i}` },
        opts: { attempts: 1 },
      })));
      res.json({ preset: "flood", queue: "email-send", added: 5000 });
      break;
    }

    case "slowdown":
      for (const queue of Object.keys(QUEUE_CONFIGS)) {
        const existing = await redis.get(`chaos:${queue}`);
        const current = existing ? JSON.parse(existing) : { failureRate: 0.01, slowdownFactor: 1 };
        await redis.set(`chaos:${queue}`, JSON.stringify({ ...current, slowdownFactor: 5 }));
      }
      setTimeout(async () => {
        for (const queue of Object.keys(QUEUE_CONFIGS)) {
          const existing = await redis.get(`chaos:${queue}`);
          const current = existing ? JSON.parse(existing) : { failureRate: 0.01, slowdownFactor: 1 };
          await redis.set(`chaos:${queue}`, JSON.stringify({ ...current, slowdownFactor: 1 }));
        }
        console.log("[chaos] Slowdown preset auto-reset");
      }, 120000);
      res.json({ preset: "slowdown", duration: "2 min" });
      break;

    case "mixed":
      // All error types on email-send — 50% failure, evenly distributed errors
      await redis.set(`chaos:email-send`, JSON.stringify({ failureRate: 0.5, slowdownFactor: 1 }));
      setTimeout(async () => {
        const config = QUEUE_CONFIGS["email-send"];
        await redis.set(`chaos:email-send`, JSON.stringify({
          failureRate: config.baselineFailureRate,
          slowdownFactor: 1,
        }));
        console.log("[chaos] Mixed preset auto-reset");
      }, 120000);
      res.json({ preset: "mixed", duration: "2 min", queue: "email-send" });
      break;

    default:
      res.status(404).json({ error: "Unknown preset" });
  }
});

// Status
app.get("/status", async (req, res) => {
  const status: Record<string, any> = {};
  for (const queue of Object.keys(QUEUE_CONFIGS)) {
    const raw = await redis.get(`chaos:${queue}`);
    const chaosConfig = raw ? JSON.parse(raw) : { failureRate: QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS].baselineFailureRate, slowdownFactor: 1 };

    const q = new Queue(queue, { connection: redis.duplicate() });
    const counts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed");

    status[queue] = {
      chaos: chaosConfig,
      counts,
    };
  }
  res.json(status);
});

export function startControlPanel() {
  app.listen(4000, () => {
    console.log("\n  Chaos control panel: http://localhost:4000");
    console.log("  Damasqas dashboard:  http://localhost:3888\n");
  });
}
