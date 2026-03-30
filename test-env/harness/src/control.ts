import express from "express";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_CONFIGS } from "./queues";
import {
  startProducer, stopProducer, setProducerRate, startAllProducers,
  stopAllProducers, getProducerStates, addSingleJob, getQueue,
} from "./producer";

const redis = new Redis(process.env.REDIS_URL!);
const app = express();
app.use(express.json());

// ─── Dashboard UI ───────────────────────────────────────
app.get("/", (req, res) => {
  const queueNames = Object.keys(QUEUE_CONFIGS);
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Damasqas Test Harness</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #d4d4d4; }

    .header { padding: 24px 32px; border-bottom: 1px solid #1e1e1e; display: flex; align-items: center; justify-content: space-between; }
    .header h1 { font-size: 18px; color: #fff; font-weight: 600; }
    .header-actions { display: flex; gap: 8px; }

    .global-bar { padding: 16px 32px; background: #111; border-bottom: 1px solid #1e1e1e; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .global-bar .label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 1px; background: #1e1e1e; }

    .card { background: #111; padding: 20px; }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .card-name { font-size: 15px; font-weight: 600; color: #fff; }
    .card-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
    .badge-idle { background: #1e1e1e; color: #666; }
    .badge-running { background: #052e16; color: #4ade80; }
    .badge-chaos { background: #350a0a; color: #ef4444; }

    .controls { display: flex; flex-direction: column; gap: 12px; }
    .control-row { display: flex; align-items: center; gap: 12px; }
    .control-label { font-size: 12px; color: #888; width: 80px; flex-shrink: 0; }
    .control-value { font-size: 12px; color: #fff; width: 48px; text-align: right; font-variant-numeric: tabular-nums; }

    input[type="range"] { flex: 1; height: 4px; -webkit-appearance: none; appearance: none; background: #2a2a2a; border-radius: 2px; outline: none; }
    input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; }
    input[type="range"].danger::-webkit-slider-thumb { background: #ef4444; }
    input[type="range"].warn::-webkit-slider-thumb { background: #f59e0b; }

    .btn { padding: 6px 12px; border: 1px solid #333; background: #1a1a1a; color: #d4d4d4; border-radius: 6px;
           font-size: 12px; cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
    .btn:hover { background: #252525; border-color: #444; }
    .btn-sm { padding: 4px 8px; font-size: 11px; }
    .btn-start { border-color: #166534; color: #4ade80; }
    .btn-start:hover { background: #052e16; }
    .btn-stop { border-color: #7f1d1d; color: #ef4444; }
    .btn-stop:hover { background: #350a0a; }
    .btn-action { border-color: #1e40af; color: #60a5fa; }
    .btn-action:hover { background: #0c1a3d; }
    .btn-danger { border-color: #7f1d1d; color: #ef4444; }
    .btn-danger:hover { background: #350a0a; }
    .btn-global { border-color: #166534; color: #4ade80; }
    .btn-global:hover { background: #052e16; }
    .btn-reset { border-color: #854d0e; color: #fbbf24; }
    .btn-reset:hover { background: #1c1004; }
    .btn-preset { border-color: #6b21a8; color: #c084fc; }
    .btn-preset:hover { background: #1a0533; }

    .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }

    .counts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: #1e1e1e; border-radius: 6px; overflow: hidden; margin-top: 12px; }
    .count-cell { background: #151515; padding: 8px; text-align: center; }
    .count-cell .num { font-size: 16px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
    .count-cell .lbl { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }

    .presets { padding: 16px 32px; border-top: 1px solid #1e1e1e; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .presets .label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px; }

    .toast { position: fixed; bottom: 24px; right: 24px; background: #1a1a1a; border: 1px solid #333; color: #fff;
             padding: 10px 16px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
    .toast.show { opacity: 1; }

    .separator { width: 1px; height: 20px; background: #2a2a2a; margin: 0 4px; }
  </style>
</head>
<body>

<div class="header">
  <h1>Damasqas Test Harness</h1>
  <div class="header-actions">
    <a href="http://localhost:3888" target="_blank" class="btn btn-action">Open Dashboard</a>
  </div>
</div>

<div class="global-bar">
  <span class="label">Global</span>
  <button class="btn btn-global" onclick="api('/producers/start-all', 'POST')">Start All Producers</button>
  <button class="btn btn-stop" onclick="api('/producers/stop-all', 'POST')">Stop All Producers</button>
  <div class="separator"></div>
  <button class="btn btn-reset" onclick="api('/reset-all', 'POST')">Reset All Chaos</button>
  <button class="btn btn-danger" onclick="if(confirm('Drain all failed/waiting jobs from all queues?')) api('/drain-all', 'POST')">Drain All Queues</button>
</div>

<div class="grid" id="queues">
  ${queueNames.map(q => `
  <div class="card" id="card-${q}" data-queue="${q}">
    <div class="card-header">
      <span class="card-name">${q}</span>
      <span class="card-badge badge-idle" id="badge-${q}">IDLE</span>
    </div>
    <div class="controls">
      <div class="control-row">
        <span class="control-label">Producer</span>
        <button class="btn btn-sm btn-start" id="start-${q}" onclick="api('/producers/${q}/start', 'POST')">Start</button>
        <button class="btn btn-sm btn-stop" id="stop-${q}" onclick="api('/producers/${q}/stop', 'POST')">Stop</button>
        <button class="btn btn-sm btn-action" onclick="api('/producers/${q}/add', 'POST', {count: 1})">+1 Job</button>
        <button class="btn btn-sm btn-action" onclick="api('/producers/${q}/add', 'POST', {count: 10})">+10</button>
        <button class="btn btn-sm btn-action" onclick="api('/producers/${q}/add', 'POST', {count: 100})">+100</button>
      </div>
      <div class="control-row">
        <span class="control-label">Rate</span>
        <input type="range" id="rate-${q}" min="0" max="${Math.max(QUEUE_CONFIGS[q as keyof typeof QUEUE_CONFIGS].jobsPerMinute * 3, 60)}" value="${QUEUE_CONFIGS[q as keyof typeof QUEUE_CONFIGS].jobsPerMinute}"
               oninput="document.getElementById('rate-val-${q}').textContent=this.value"
               onchange="api('/producers/${q}/rate', 'POST', {jobsPerMinute: Number(this.value)})" />
        <span class="control-value" id="rate-val-${q}">${QUEUE_CONFIGS[q as keyof typeof QUEUE_CONFIGS].jobsPerMinute}</span>
        <span style="font-size:11px;color:#666">/min</span>
      </div>
      <div class="control-row">
        <span class="control-label">Failure %</span>
        <input type="range" class="danger" id="fail-${q}" min="0" max="100" value="${Math.round(QUEUE_CONFIGS[q as keyof typeof QUEUE_CONFIGS].baselineFailureRate * 100)}"
               oninput="document.getElementById('fail-val-${q}').textContent=this.value+'%'"
               onchange="api('/chaos/${q}', 'POST', {failureRate: Number(this.value)/100})" />
        <span class="control-value" id="fail-val-${q}">${Math.round(QUEUE_CONFIGS[q as keyof typeof QUEUE_CONFIGS].baselineFailureRate * 100)}%</span>
      </div>
      <div class="control-row">
        <span class="control-label">Slowdown</span>
        <input type="range" class="warn" id="slow-${q}" min="1" max="20" value="1"
               oninput="document.getElementById('slow-val-${q}').textContent=this.value+'x'"
               onchange="api('/chaos/${q}', 'POST', {slowdownFactor: Number(this.value)})" />
        <span class="control-value" id="slow-val-${q}">1x</span>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-action" onclick="promptFlood('${q}')">Flood...</button>
        <button class="btn btn-sm btn-reset" onclick="resetQueue('${q}')">Reset Chaos</button>
        <button class="btn btn-sm btn-danger" onclick="api('/drain/${q}', 'POST')">Drain</button>
        <button class="btn btn-sm btn-danger" onclick="api('/clean/${q}/failed', 'POST')">Clear Failed</button>
      </div>
    </div>
    <div class="counts" id="counts-${q}">
      <div class="count-cell"><div class="num" id="w-${q}">0</div><div class="lbl">Wait</div></div>
      <div class="count-cell"><div class="num" id="a-${q}">0</div><div class="lbl">Active</div></div>
      <div class="count-cell"><div class="num" id="c-${q}">0</div><div class="lbl">Done</div></div>
      <div class="count-cell"><div class="num" id="f-${q}">0</div><div class="lbl">Failed</div></div>
      <div class="count-cell"><div class="num" id="d-${q}">0</div><div class="lbl">Delay</div></div>
    </div>
  </div>
  `).join("")}
</div>

<div class="presets">
  <span class="label">Presets</span>
  <button class="btn btn-preset" onclick="api('/preset/spike', 'POST')">Failure Spike (2m)</button>
  <button class="btn btn-preset" onclick="api('/preset/cascade', 'POST')">Cascade (3m)</button>
  <button class="btn btn-preset" onclick="api('/preset/flood', 'POST')">Backlog Flood</button>
  <button class="btn btn-preset" onclick="api('/preset/slowdown', 'POST')">System Slowdown (2m)</button>
  <button class="btn btn-preset" onclick="api('/preset/mixed', 'POST')">Mixed Errors (2m)</button>
</div>

<div class="toast" id="toast"></div>

<script>
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  async function api(path, method, body) {
    const opts = { method, headers: {'Content-Type':'application/json'} };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    toast(JSON.stringify(data).slice(0, 80));
    refresh();
    return data;
  }

  function promptFlood(queue) {
    const count = prompt('How many jobs to add to ' + queue + '?', '1000');
    if (count && !isNaN(Number(count))) {
      api('/producers/' + queue + '/add', 'POST', { count: Number(count) });
    }
  }

  function resetQueue(queue) {
    api('/reset/' + queue, 'POST');
    const failSlider = document.getElementById('fail-' + queue);
    const slowSlider = document.getElementById('slow-' + queue);
    if (failSlider) { failSlider.value = '0'; document.getElementById('fail-val-' + queue).textContent = '0%'; }
    if (slowSlider) { slowSlider.value = '1'; document.getElementById('slow-val-' + queue).textContent = '1x'; }
  }

  async function refresh() {
    try {
      const res = await fetch('/status');
      const data = await res.json();
      for (const [queue, info] of Object.entries(data)) {
        const { chaos, counts, producer } = info;
        // Update counts
        const el = (id) => document.getElementById(id);
        if (el('w-'+queue)) el('w-'+queue).textContent = counts.waiting || 0;
        if (el('a-'+queue)) el('a-'+queue).textContent = counts.active || 0;
        if (el('c-'+queue)) el('c-'+queue).textContent = counts.completed || 0;
        if (el('f-'+queue)) {
          el('f-'+queue).textContent = counts.failed || 0;
          el('f-'+queue).style.color = (counts.failed > 0) ? '#ef4444' : '#fff';
        }
        if (el('d-'+queue)) el('d-'+queue).textContent = counts.delayed || 0;

        // Update badge
        const badge = el('badge-'+queue);
        if (badge) {
          const baselineRate = info.baseline?.failureRate || 0;
          const elevated = chaos.failureRate > baselineRate + 0.01 || chaos.slowdownFactor > 1;
          if (elevated && producer?.running) {
            badge.textContent = 'DEGRADED';
            badge.className = 'card-badge badge-chaos';
          } else if (elevated) {
            badge.textContent = 'FAULTS ON';
            badge.className = 'card-badge badge-chaos';
          } else if (producer?.running) {
            badge.textContent = 'PRODUCING';
            badge.className = 'card-badge badge-running';
          } else {
            badge.textContent = 'IDLE';
            badge.className = 'card-badge badge-idle';
          }
        }
      }
    } catch(e) { /* ignore */ }
  }

  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>`);
});

// ─── Producer Controls ──────────────────────────────────

app.post("/producers/start-all", (req, res) => {
  startAllProducers();
  res.json({ status: "all producers started" });
});

app.post("/producers/stop-all", (req, res) => {
  stopAllProducers();
  res.json({ status: "all producers stopped" });
});

app.post("/producers/:queue/start", (req, res) => {
  startProducer(req.params.queue);
  res.json({ queue: req.params.queue, status: "started" });
});

app.post("/producers/:queue/stop", (req, res) => {
  stopProducer(req.params.queue);
  res.json({ queue: req.params.queue, status: "stopped" });
});

app.post("/producers/:queue/rate", (req, res) => {
  const { jobsPerMinute } = req.body;
  setProducerRate(req.params.queue, jobsPerMinute);
  res.json({ queue: req.params.queue, jobsPerMinute });
});

app.post("/producers/:queue/add", async (req, res) => {
  const { count = 1 } = req.body;
  const added = addSingleJob(req.params.queue, count);
  res.json({ queue: req.params.queue, added });
});

// ─── Chaos Controls ─────────────────────────────────────

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

// ─── Queue Operations ───────────────────────────────────

app.post("/drain/:queue", async (req, res) => {
  const q = getQueue(req.params.queue);
  if (!q) return res.status(404).json({ error: "queue not found" });
  await q.drain();
  console.log(`[ops] Drained ${req.params.queue}`);
  res.json({ queue: req.params.queue, status: "drained" });
});

app.post("/drain-all", async (req, res) => {
  for (const queueName of Object.keys(QUEUE_CONFIGS)) {
    const q = getQueue(queueName);
    if (q) await q.drain();
  }
  console.log("[ops] Drained all queues");
  res.json({ status: "all drained" });
});

app.post("/clean/:queue/:state", async (req, res) => {
  const q = getQueue(req.params.queue);
  if (!q) return res.status(404).json({ error: "queue not found" });
  const cleaned = await q.clean(0, 0, req.params.state as any);
  console.log(`[ops] Cleaned ${cleaned.length} ${req.params.state} jobs from ${req.params.queue}`);
  res.json({ queue: req.params.queue, state: req.params.state, cleaned: cleaned.length });
});

// ─── Reset ──────────────────────────────────────────────

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

export async function resetAllChaos() {
  for (const [queue, config] of Object.entries(QUEUE_CONFIGS)) {
    await redis.set(`chaos:${queue}`, JSON.stringify({
      failureRate: config.baselineFailureRate,
      slowdownFactor: 1,
    }));
  }
  console.log("[chaos] All queues reset to baseline");
}

app.post("/reset-all", async (req, res) => {
  await resetAllChaos();
  res.json({ status: "all normal" });
});

// ─── Presets ────────────────────────────────────────────

app.post("/preset/:name", async (req, res) => {
  const { name } = req.params;

  switch (name) {
    case "spike":
      startProducer("email-send");
      await redis.set(`chaos:email-send`, JSON.stringify({ failureRate: 0.9, slowdownFactor: 1 }));
      setTimeout(async () => {
        const config = QUEUE_CONFIGS["email-send"];
        await redis.set(`chaos:email-send`, JSON.stringify({
          failureRate: config.baselineFailureRate, slowdownFactor: 1,
        }));
        console.log("[chaos] Spike preset auto-reset");
      }, 120000);
      res.json({ preset: "spike", duration: "2 min", queue: "email-send" });
      break;

    case "cascade":
      startProducer("email-send");
      startProducer("webhook-deliver");
      startProducer("data-enrich");
      await redis.set(`chaos:email-send`, JSON.stringify({ failureRate: 0.7, slowdownFactor: 1 }));
      setTimeout(async () => {
        await redis.set(`chaos:webhook-deliver`, JSON.stringify({ failureRate: 0.03, slowdownFactor: 5 }));
      }, 30000);
      setTimeout(async () => {
        addSingleJob("data-enrich", 500);
      }, 60000);
      setTimeout(async () => {
        for (const queue of ["email-send", "webhook-deliver", "data-enrich"]) {
          const config = QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS];
          await redis.set(`chaos:${queue}`, JSON.stringify({
            failureRate: config.baselineFailureRate, slowdownFactor: 1,
          }));
        }
        console.log("[chaos] Cascade preset auto-reset");
      }, 180000);
      res.json({ preset: "cascade", duration: "3 min", queues: ["email-send", "webhook-deliver", "data-enrich"] });
      break;

    case "flood":
      startProducer("email-send");
      addSingleJob("email-send", 5000);
      res.json({ preset: "flood", queue: "email-send", added: 5000 });
      break;

    case "slowdown":
      startAllProducers();
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
      startProducer("email-send");
      await redis.set(`chaos:email-send`, JSON.stringify({ failureRate: 0.5, slowdownFactor: 1 }));
      setTimeout(async () => {
        const config = QUEUE_CONFIGS["email-send"];
        await redis.set(`chaos:email-send`, JSON.stringify({
          failureRate: config.baselineFailureRate, slowdownFactor: 1,
        }));
        console.log("[chaos] Mixed preset auto-reset");
      }, 120000);
      res.json({ preset: "mixed", duration: "2 min", queue: "email-send" });
      break;

    default:
      res.status(404).json({ error: "Unknown preset" });
  }
});

// ─── Status ─────────────────────────────────────────────

app.get("/status", async (req, res) => {
  const producerStates = getProducerStates();
  const status: Record<string, any> = {};
  for (const queue of Object.keys(QUEUE_CONFIGS)) {
    const raw = await redis.get(`chaos:${queue}`);
    const chaosConfig = raw ? JSON.parse(raw) : {
      failureRate: QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS].baselineFailureRate,
      slowdownFactor: 1,
    };
    const q = getQueue(queue);
    const counts = q
      ? await q.getJobCounts("waiting", "active", "completed", "failed", "delayed")
      : { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

    const qConfig = QUEUE_CONFIGS[queue as keyof typeof QUEUE_CONFIGS];
    status[queue] = {
      chaos: chaosConfig,
      counts,
      producer: producerStates[queue] || { running: false, jobsPerMinute: 0 },
      baseline: { failureRate: qConfig.baselineFailureRate },
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
