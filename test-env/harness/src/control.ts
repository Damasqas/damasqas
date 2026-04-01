import express from "express";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_CONFIGS } from "./queues";
import {
  startProducer, stopProducer, setProducerRate, startAllProducers,
  stopAllProducers, getProducerStates, addSingleJob, getQueue,
} from "./producer";
import {
  runFlowScenario,
  runOverdueScenario,
  runMemoryPressureScenario,
  runDrainImbalanceScenario,
  runEventDiversityScenario,
  runJobTypeDiversityScenario,
  runAlertRulesScenario,
  runAllScenarios,
  getScenarioStatus,
} from "./scenarios";

const redis = new Redis(process.env.REDIS_URL!);
const app = express();
app.use(express.json());

// ─── Dashboard UI ───────────────────────────────────────
app.get("/", (req, res) => {
  const queueNames = Object.keys(QUEUE_CONFIGS);
  const queueInfo: Record<string, { jobsPerMinute: number; baselineFailureRate: number; processingMs: { min: number; max: number }; workers: number; concurrency: number }> = {};
  for (const [name, cfg] of Object.entries(QUEUE_CONFIGS)) {
    queueInfo[name] = { jobsPerMinute: cfg.jobsPerMinute, baselineFailureRate: cfg.baselineFailureRate, processingMs: cfg.processingMs, workers: cfg.workers, concurrency: cfg.concurrency };
  }
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Damasqas Test Harness</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #000;
      color: #ccc;
      min-height: 100vh;
    }

    .app-container {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .panel {
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
    }

    /* Hero panel */
    .hero-panel {
      padding: 32px;
      text-align: center;
    }
    .hero-panel h2 { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 6px; }
    .hero-panel p { font-size: 13px; color: #888; margin-bottom: 20px; line-height: 1.5; }
    .hero-actions { display: flex; gap: 10px; justify-content: center; margin-bottom: 12px; }
    .hero-info { font-size: 12px; color: #555; }
    .hero-info a { color: #aaa; text-decoration: underline; }

    /* Header */
    .header {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 { font-size: 16px; font-weight: 600; color: #fff; }
    .header-right { display: flex; align-items: center; gap: 12px; }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #888;
      padding: 3px 8px;
      border: 1px solid #222;
      border-radius: 4px;
    }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #333; }
    .status-dot.connected { background: #fff; }
    .status-dot.disconnected { background: #555; }

    .chaos-indicator {
      display: none;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #fff;
      padding: 3px 8px;
      border: 1px solid #444;
      border-radius: 4px;
      cursor: pointer;
    }
    .chaos-indicator.active { display: flex; }
    .chaos-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }

    /* Global bar */
    .global-bar {
      padding: 12px 16px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .global-bar .label {
      color: #555;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 4px;
    }

    /* Section panels */
    .section-panel { padding: 16px; }
    .section-panel h3 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #555;
      margin-bottom: 12px;
      font-weight: 500;
    }

    /* Card grid */
    .card-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .preset-card, .scenario-card {
      flex: 0 0 auto;
      width: 180px;
      padding: 12px;
      border-radius: 6px;
      background: #0a0a0a;
      border: 1px solid #222;
      cursor: pointer;
    }
    .preset-card:hover, .scenario-card:hover { border-color: #444; }
    .preset-card .card-title, .scenario-card .card-title {
      font-size: 13px;
      font-weight: 600;
      color: #ddd;
      margin-bottom: 4px;
    }
    .preset-card .card-desc, .scenario-card .card-desc {
      font-size: 11px;
      color: #777;
      line-height: 1.4;
    }
    .duration-badge {
      display: inline-block;
      font-size: 10px;
      padding: 1px 5px;
      border: 1px solid #333;
      border-radius: 3px;
      color: #777;
      margin-top: 6px;
    }
    .scenario-card .card-tests { font-size: 10px; color: #666; margin-top: 4px; }
    .queue-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .queue-pill {
      font-size: 9px;
      padding: 1px 5px;
      border: 1px solid #222;
      border-radius: 3px;
      color: #555;
    }
    .scenario-card.run-all { border-color: #444; }
    .scenario-card.run-all:hover { border-color: #666; }

    /* Queue grid */
    .queue-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 12px;
    }

    .card { padding: 16px; }
    .card.card-idle { opacity: 0.5; }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .card-name { font-size: 14px; font-weight: 600; color: #fff; }
    .card-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .badge-idle { background: #0a0a0a; color: #555; border: 1px solid #222; }
    .badge-running { background: #1a1a1a; color: #fff; border: 1px solid #444; }
    .badge-chaos { background: #1a1a1a; color: #fff; border: 1px solid #666; }

    .no-activity { font-size: 11px; color: #444; text-align: center; margin-top: 8px; display: none; }
    .card-idle .no-activity { display: block; }

    /* Controls */
    .controls { display: flex; flex-direction: column; gap: 10px; }
    .control-row { display: flex; align-items: center; gap: 10px; }
    .control-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #555;
      width: 75px;
      flex-shrink: 0;
    }
    .control-value {
      font-size: 12px;
      color: #ccc;
      width: 44px;
      text-align: right;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
    }

    /* Sliders */
    input[type="range"] {
      flex: 1;
      height: 2px;
      -webkit-appearance: none;
      appearance: none;
      background: #222;
      border-radius: 1px;
      outline: none;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #666;
      border: 1px solid #888;
      cursor: pointer;
    }
    input[type="range"]::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #666;
      border: 1px solid #888;
      cursor: pointer;
    }

    /* Buttons */
    .btn {
      padding: 5px 10px;
      border: 1px solid #333;
      background: #111;
      color: #aaa;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      white-space: nowrap;
    }
    .btn:hover { background: #1a1a1a; border-color: #444; color: #ddd; }
    .btn-sm { padding: 3px 7px; font-size: 11px; }
    .btn-start { color: #ddd; }
    .btn-stop { color: #888; }
    .btn-action { color: #aaa; }
    .btn-danger { color: #888; }
    .btn-global { color: #ddd; }
    .btn-reset { color: #aaa; }
    .btn-preset { color: #aaa; }

    .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }

    /* Counts */
    .counts {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1px;
      border-radius: 6px;
      overflow: hidden;
      margin-top: 10px;
      background: #0a0a0a;
      border: 1px solid #1a1a1a;
    }
    .count-cell {
      background: #0a0a0a;
      padding: 8px 4px;
      text-align: center;
    }
    .count-cell .num {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
    }
    .count-cell .delta {
      font-size: 10px;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      margin-left: 2px;
    }
    .delta-up { color: #ccc; }
    .delta-down { color: #888; }
    .count-cell .lbl {
      font-size: 10px;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }

    .separator { width: 1px; height: 16px; background: #222; margin: 0 4px; }

    kbd {
      display: inline-block;
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 2px;
      background: #0a0a0a;
      border: 1px solid #333;
      color: #555;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      margin-left: 6px;
      vertical-align: middle;
    }

    /* Toasts */
    .toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 340px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 1000;
      pointer-events: none;
    }
    .toast-item {
      background: #111;
      border: 1px solid #333;
      border-left: 3px solid #666;
      border-radius: 6px;
      padding: 12px 14px;
      pointer-events: all;
    }
    .toast-title {
      font-size: 13px;
      font-weight: 600;
      color: #ddd;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .toast-close {
      background: none;
      border: none;
      color: #555;
      cursor: pointer;
      font-size: 14px;
      padding: 0 0 0 8px;
      line-height: 1;
    }
    .toast-close:hover { color: #aaa; }
    .toast-body { font-size: 12px; color: #888; line-height: 1.5; }
    .toast-time { font-size: 10px; color: #555; text-align: right; margin-top: 4px; }
    .toast-details summary { font-size: 11px; color: #555; cursor: pointer; margin-top: 6px; }
    .toast-details summary:hover { color: #888; }
    .toast-details pre {
      font-size: 11px;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      color: #888;
      background: #0a0a0a;
      padding: 8px;
      border-radius: 4px;
      margin-top: 6px;
      max-height: 200px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* Modals */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      z-index: 2000;
      justify-content: center;
      align-items: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      width: 420px;
      max-width: 90vw;
      padding: 24px;
    }
    .modal h3 { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 16px; }
    .modal-preset-btns { display: flex; gap: 8px; margin-bottom: 12px; }
    .modal-preset-btns .btn { flex: 1; text-align: center; }
    .modal-input {
      width: 100%;
      padding: 8px 12px;
      background: #0a0a0a;
      border: 1px solid #333;
      border-radius: 4px;
      color: #fff;
      font-size: 14px;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      outline: none;
      margin-bottom: 8px;
    }
    .modal-input:focus { border-color: #666; }
    .modal-estimate { font-size: 12px; color: #888; margin-bottom: 16px; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

    .help-table { width: 100%; border-collapse: collapse; }
    .help-table td {
      padding: 5px 0;
      font-size: 13px;
      color: #888;
      border-bottom: 1px solid #1a1a1a;
    }
    .help-table td:first-child { width: 60px; }
  </style>
</head>
<body>
<div class="app-container">

  <!-- Hero Panel -->
  <div id="hero" class="panel hero-panel">
    <h2>Ready to test Damasqas</h2>
    <p>Start producing jobs to see real-time monitoring in action.<br>Pick a scenario below or start individual queues manually.</p>
    <div class="hero-actions">
      <button class="btn btn-global" onclick="apiCall('/producers/start-all', 'POST', null, {type:'info', title:'Started All Producers', bodyFn: function(d) { return 'Started all producers (${queueNames.length} queues)'; }})">Quick Start: All Producers</button>
      <button class="btn btn-preset" onclick="runAllScenarios()">Run All Scenarios</button>
    </div>
    <div class="hero-info">Damasqas dashboard: <a href="http://localhost:3888" target="_blank">localhost:3888</a></div>
  </div>

  <!-- Header -->
  <div class="panel header">
    <h1>Damasqas Test Harness</h1>
    <div class="header-right">
      <div class="status-pill" id="redis-status">
        <span class="status-dot" id="redis-dot"></span>
        <span>Redis</span>
      </div>
      <div class="status-pill" id="damasqas-status">
        <span class="status-dot" id="damasqas-dot"></span>
        <span>Damasqas</span>
      </div>
      <div class="chaos-indicator" id="chaos-indicator" onclick="scrollToDegraded()">
        <span class="chaos-dot"></span>
        <span id="chaos-count">0 queues degraded</span>
      </div>
      <a href="http://localhost:3888" target="_blank" class="btn">Open Dashboard <kbd>d</kbd></a>
      <button class="btn" onclick="toggleHelp()">? <kbd>?</kbd></button>
    </div>
  </div>

  <!-- Global Controls -->
  <div class="panel global-bar">
    <span class="label">Global</span>
    <button class="btn btn-global" onclick="apiCall('/producers/start-all', 'POST', null, {type:'info', title:'Started All Producers', bodyFn: function(d) { return 'Started all producers (${queueNames.length} queues)'; }})">Start All <kbd>s</kbd></button>
    <button class="btn btn-stop" onclick="apiCall('/producers/stop-all', 'POST', null, {type:'info', title:'Stopped All Producers', bodyFn: function() { return 'Stopped all producers'; }})">Stop All <kbd>x</kbd></button>
    <div class="separator"></div>
    <button class="btn btn-reset" onclick="resetAll()">Reset All Chaos <kbd>r</kbd></button>
    <button class="btn btn-danger" onclick="if(confirm('Drain all waiting and delayed jobs from all queues?')) apiCall('/drain-all', 'POST', null, {type:'success', title:'Drained All Queues', bodyFn: function() { return 'Drained all waiting and delayed jobs from all queues'; }})">Drain All Queues</button>
  </div>

  <!-- Chaos Presets -->
  <div class="panel section-panel">
    <h3>Chaos Presets</h3>
    <div class="card-grid">
      <div class="preset-card" onclick="apiCall('/preset/spike', 'POST', null, {type:'chaos', title:'Failure Spike', bodyFn: function() { return 'email-send at 90% failure for 2 minutes. Watch the Damasqas error clustering and failure rate charts.'; }})">
        <div class="card-title">Failure Spike</div>
        <div class="card-desc">90% failure on email-send for 2min</div>
        <div class="duration-badge">2 min</div>
      </div>
      <div class="preset-card" onclick="apiCall('/preset/cascade', 'POST', null, {type:'chaos', title:'Cascade Failure', bodyFn: function() { return 'email-send fails \\u2192 webhook-deliver slows \\u2192 data-enrich floods. 3 stages over 3 minutes. Watch cross-queue impact in Damasqas.'; }})">
        <div class="card-title">Cascade</div>
        <div class="card-desc">Multi-queue cascade failure chain</div>
        <div class="duration-badge">3 min</div>
      </div>
      <div class="preset-card" onclick="apiCall('/preset/flood', 'POST', null, {type:'chaos', title:'Backlog Flood', bodyFn: function() { return '5,000 jobs dumped into email-send. Watch the drain rate projection in Damasqas.'; }})">
        <div class="card-title">Backlog Flood</div>
        <div class="card-desc">5,000 jobs dumped into email-send</div>
      </div>
      <div class="preset-card" onclick="apiCall('/preset/slowdown', 'POST', null, {type:'chaos', title:'System Slowdown', bodyFn: function() { return 'All workers at 5x slowdown for 2 minutes. Watch queue depth growth across all queues.'; }})">
        <div class="card-title">System Slowdown</div>
        <div class="card-desc">All workers at 5x slowdown</div>
        <div class="duration-badge">2 min</div>
      </div>
      <div class="preset-card" onclick="apiCall('/preset/mixed', 'POST', null, {type:'chaos', title:'Mixed Errors', bodyFn: function() { return 'email-send at 50% failure for 2 minutes with diverse error types. Watch error grouping in Damasqas.'; }})">
        <div class="card-title">Mixed Errors</div>
        <div class="card-desc">50% diverse errors on email-send</div>
        <div class="duration-badge">2 min</div>
      </div>
    </div>
  </div>

  <!-- Queue Grid -->
  <div class="queue-grid" id="queues">
    ${queueNames.map(q => {
      const cfg = QUEUE_CONFIGS[q as keyof typeof QUEUE_CONFIGS];
      return `
    <div class="panel card card-idle" id="card-${q}" data-queue="${q}">
      <div class="card-header">
        <span class="card-name">${q}</span>
        <span class="card-badge badge-idle" id="badge-${q}">IDLE</span>
      </div>
      <div class="controls">
        <div class="control-row">
          <span class="control-label">Producer</span>
          <button class="btn btn-sm btn-start" id="start-${q}" onclick="apiCall('/producers/${q}/start', 'POST', null, {type:'info', title:'Producer Started', bodyFn: function(d) { return 'Started producer for ${q} at ' + (document.getElementById('rate-${q}').value) + ' jobs/min'; }})">Start</button>
          <button class="btn btn-sm btn-stop" id="stop-${q}" onclick="apiCall('/producers/${q}/stop', 'POST', null, {type:'info', title:'Producer Stopped', bodyFn: function() { return 'Stopped producer for ${q}'; }})">Stop</button>
          <button class="btn btn-sm btn-action" onclick="apiCall('/producers/${q}/add', 'POST', {count: 1}, {type:'info', title:'Jobs Added', bodyFn: function(d) { return 'Added ' + d.added + ' job to ${q}'; }})">+1</button>
          <button class="btn btn-sm btn-action" onclick="apiCall('/producers/${q}/add', 'POST', {count: 10}, {type:'info', title:'Jobs Added', bodyFn: function(d) { return 'Added ' + d.added + ' jobs to ${q}'; }})">+10</button>
          <button class="btn btn-sm btn-action" onclick="apiCall('/producers/${q}/add', 'POST', {count: 100}, {type:'info', title:'Jobs Added', bodyFn: function(d) { return 'Added ' + d.added + ' jobs to ${q}'; }})">+100</button>
        </div>
        <div class="control-row">
          <span class="control-label">Rate</span>
          <input type="range" id="rate-${q}" min="0" max="${Math.max(cfg.jobsPerMinute * 3, 60)}" value="${cfg.jobsPerMinute}"
                 oninput="document.getElementById('rate-val-${q}').textContent=this.value"
                 onchange="apiCall('/producers/${q}/rate', 'POST', {jobsPerMinute: Number(this.value)}, {type:'info', title:'Rate Changed', bodyFn: function(d) { return '${q} rate changed to ' + d.jobsPerMinute + ' jobs/min'; }})" />
          <span class="control-value" id="rate-val-${q}">${cfg.jobsPerMinute}</span>
          <span style="font-size:11px;color:#555">/min</span>
        </div>
        <div class="control-row">
          <span class="control-label">Failure %</span>
          <input type="range" id="fail-${q}" min="0" max="100" value="${Math.round(cfg.baselineFailureRate * 100)}"
                 oninput="document.getElementById('fail-val-${q}').textContent=this.value+'%'"
                 onchange="apiCall('/chaos/${q}', 'POST', {failureRate: Number(this.value)/100}, {type:'chaos', title:'Failure Rate Changed', bodyFn: function(d) { var v = Math.round(d.config.failureRate*100); return '${q} failure rate set to ' + v + '%' + (v > 50 ? ' \\u2014 expect heavy failures' : ''); }})" />
          <span class="control-value" id="fail-val-${q}">${Math.round(cfg.baselineFailureRate * 100)}%</span>
        </div>
        <div class="control-row">
          <span class="control-label">Slowdown</span>
          <input type="range" id="slow-${q}" min="1" max="20" value="1"
                 oninput="document.getElementById('slow-val-${q}').textContent=this.value+'x'"
                 onchange="apiCall('/chaos/${q}', 'POST', {slowdownFactor: Number(this.value)}, {type:'chaos', title:'Slowdown Changed', bodyFn: function(d) { var v = d.config.slowdownFactor; return '${q} slowdown set to ' + v + 'x' + (v > 5 ? ' \\u2014 workers will crawl' : ''); }})" />
          <span class="control-value" id="slow-val-${q}">1x</span>
        </div>
        <div class="actions">
          <button class="btn btn-sm btn-action" onclick="openFloodModal('${q}')">Flood...</button>
          <button class="btn btn-sm btn-reset" onclick="resetQueue('${q}')">Reset Chaos</button>
          <button class="btn btn-sm btn-danger" onclick="apiCall('/drain/${q}', 'POST', null, {type:'success', title:'Queue Drained', bodyFn: function() { return 'Drained all waiting and delayed jobs from ${q}'; }})">Drain</button>
          <button class="btn btn-sm btn-danger" onclick="apiCall('/clean/${q}/failed', 'POST', null, {type:'success', title:'Failed Jobs Cleared', bodyFn: function(d) { return 'Cleared ' + d.cleaned + ' failed jobs from ${q}'; }})">Clear Failed</button>
        </div>
      </div>
      <div class="counts" id="counts-${q}">
        <div class="count-cell">
          <div class="num" id="w-${q}">0</div>
          <div class="delta" id="wd-${q}"></div>
          <div class="lbl">Wait</div>
        </div>
        <div class="count-cell">
          <div class="num" id="a-${q}">0</div>
          <div class="delta" id="ad-${q}"></div>
          <div class="lbl">Active</div>
        </div>
        <div class="count-cell">
          <div class="num" id="c-${q}">0</div>
          <div class="delta" id="cd-${q}"></div>
          <div class="lbl">Done</div>
        </div>
        <div class="count-cell">
          <div class="num" id="f-${q}">0</div>
          <div class="delta" id="fd-${q}"></div>
          <div class="lbl">Failed</div>
        </div>
        <div class="count-cell">
          <div class="num" id="d-${q}">0</div>
          <div class="delta" id="dd-${q}"></div>
          <div class="lbl">Delay</div>
        </div>
      </div>
      <div class="no-activity">No activity</div>
    </div>`;
    }).join("")}
  </div>

  <!-- Feature Test Scenarios -->
  <div class="panel section-panel">
    <h3>Feature Test Scenarios</h3>
    <div class="card-grid">
      <div class="scenario-card" onclick="apiCall('/scenario/flows', 'POST', null, {type:'scenario', title:'Flow + Deadlock', bodyFn: formatFlowResult})">
        <div class="card-title">Flow + Deadlock <kbd>1</kbd></div>
        <div class="card-tests">Tests: Flow visualization, deadlock detection</div>
        <div class="queue-pills"><span class="queue-pill">report-monthly</span><span class="queue-pill">data-enrich</span><span class="queue-pill">email-send</span></div>
      </div>
      <div class="scenario-card" onclick="apiCall('/scenario/overdue', 'POST', null, {type:'scenario', title:'Overdue Delayed', bodyFn: function(d) { return d.result + '. Open Damasqas \\u2192 scheduled-cleanup \\u2192 Delayed tab to see overdue detection.'; }})">
        <div class="card-title">Overdue Delayed <kbd>2</kbd></div>
        <div class="card-tests">Tests: Overdue job detection</div>
        <div class="queue-pills"><span class="queue-pill">scheduled-cleanup</span></div>
      </div>
      <div class="scenario-card" onclick="apiCall('/scenario/memory', 'POST', null, {type:'scenario', title:'Memory Pressure', bodyFn: function(d) { return d.result + '. Open Damasqas \\u2192 Redis Health to see memory growth and slowlog entries.'; }})">
        <div class="card-title">Memory Pressure <kbd>3</kbd></div>
        <div class="card-tests">Tests: Redis health monitoring</div>
        <div class="queue-pills"><span class="queue-pill">image-resize</span></div>
      </div>
      <div class="scenario-card" onclick="apiCall('/scenario/drain', 'POST', null, {type:'scenario', title:'Drain Imbalance', bodyFn: function(d) { return d.result + '. Open Damasqas \\u2192 webhook-deliver \\u2192 Drain Analysis to see growing trend.'; }})">
        <div class="card-title">Drain Imbalance <kbd>4</kbd></div>
        <div class="card-tests">Tests: Drain rate analysis</div>
        <div class="queue-pills"><span class="queue-pill">webhook-deliver</span></div>
      </div>
      <div class="scenario-card" onclick="apiCall('/scenario/events', 'POST', null, {type:'scenario', title:'Event Diversity', bodyFn: function(d) { return d.result + '. Open Damasqas \\u2192 Events tab and try searching for \\'INV-2026\\' or \\'acme-corp\\'.'; }})">
        <div class="card-title">Event Diversity <kbd>5</kbd></div>
        <div class="card-tests">Tests: Event search, full-text search</div>
        <div class="queue-pills"><span class="queue-pill">email-send</span><span class="queue-pill">payment-process</span></div>
      </div>
      <div class="scenario-card" onclick="apiCall('/scenario/job-types', 'POST', null, {type:'scenario', title:'Job Type Mix', bodyFn: function(d) { return d.result + '. Open Damasqas \\u2192 email-send \\u2192 Job Types to see per-type breakdown.'; }})">
        <div class="card-title">Job Type Mix <kbd>6</kbd></div>
        <div class="card-tests">Tests: Per-type breakdown</div>
        <div class="queue-pills"><span class="queue-pill">email-send</span></div>
      </div>
      <div class="scenario-card" onclick="apiCall('/scenario/alerts', 'POST', null, {type:'scenario', title:'Alert Rules', bodyFn: function(d) { return d.result + '. Open Damasqas \\u2192 Alerts tab to see them fire as conditions are met.'; }})">
        <div class="card-title">Alert Rules <kbd>7</kbd></div>
        <div class="card-tests">Tests: Alert rule triggers</div>
        <div class="queue-pills"><span class="queue-pill">email-send</span><span class="queue-pill">webhook-deliver</span><span class="queue-pill">data-enrich</span></div>
      </div>
      <div class="scenario-card run-all" onclick="runAllScenarios()">
        <div class="card-title">Run All Scenarios <kbd>a</kbd></div>
        <div class="card-desc">Execute all 7 feature test scenarios</div>
      </div>
    </div>
  </div>

</div>

<!-- Flood Modal -->
<div class="modal-overlay" id="flood-modal" onclick="if(event.target===this)closeFloodModal()">
  <div class="modal">
    <h3>Add Jobs to <span id="flood-queue-name"></span></h3>
    <div class="modal-preset-btns">
      <button class="btn btn-action" onclick="setFloodCount(100)">100</button>
      <button class="btn btn-action" onclick="setFloodCount(1000)">1,000</button>
      <button class="btn btn-action" onclick="setFloodCount(5000)">5,000</button>
      <button class="btn btn-action" onclick="setFloodCount(10000)">10,000</button>
    </div>
    <input type="number" class="modal-input" id="flood-input" value="1000" min="1" oninput="updateFloodEstimate()" onkeydown="if(event.key==='Enter'){submitFlood();event.preventDefault()}">
    <div class="modal-estimate" id="flood-estimate"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeFloodModal()">Cancel</button>
      <button class="btn btn-action" onclick="submitFlood()">Flood</button>
    </div>
  </div>
</div>

<!-- Help Modal -->
<div class="modal-overlay" id="help-modal" onclick="if(event.target===this)toggleHelp()">
  <div class="modal">
    <h3>Keyboard Shortcuts</h3>
    <table class="help-table">
      <tr><td><kbd>s</kbd></td><td>Start all producers</td></tr>
      <tr><td><kbd>x</kbd></td><td>Stop all producers</td></tr>
      <tr><td><kbd>r</kbd></td><td>Reset all chaos</td></tr>
      <tr><td><kbd>1</kbd>-<kbd>7</kbd></td><td>Run scenario 1-7</td></tr>
      <tr><td><kbd>a</kbd></td><td>Run all scenarios</td></tr>
      <tr><td><kbd>d</kbd></td><td>Open Damasqas dashboard</td></tr>
      <tr><td><kbd>?</kbd></td><td>Toggle this help</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Close modals</td></tr>
    </table>
    <div class="modal-actions" style="margin-top: 20px;">
      <button class="btn" onclick="toggleHelp()">Close</button>
    </div>
  </div>
</div>

<!-- Toast Container -->
<div class="toast-container" id="toast-container"></div>

<script>
  // ── State ──────────────────────────────────────────────
  var QUEUE_INFO = ${JSON.stringify(queueInfo)};

  var state = {
    queues: {},
    previousCounts: {},
    heroDismissed: false,
    toasts: [],
    toastId: 0,
    redisConnected: false,
    damasqasConnected: false,
  };

  // ── Toast System ───────────────────────────────────────
  function showToast(opts) {
    var id = ++state.toastId;
    var type = opts.type || 'info';
    var duration = opts.duration || 5000;
    var container = document.getElementById('toast-container');

    var el = document.createElement('div');
    el.className = 'toast-item';
    el.dataset.toastId = id;

    var time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    var html = '<div class="toast-title"><span>' + (opts.title || '') + '</span><button class="toast-close" onclick="dismissToast(' + id + ')">&times;</button></div>';
    if (opts.body) html += '<div class="toast-body">' + opts.body + '</div>';
    if (opts.details) {
      html += '<details class="toast-details"><summary>View raw response</summary><pre>' + escapeHtml(JSON.stringify(opts.details, null, 2)) + '</pre></details>';
    }
    html += '<div class="toast-time">' + time + '</div>';
    el.innerHTML = html;

    container.appendChild(el);
    var timerId = setTimeout(function() { dismissToast(id); }, duration);
    state.toasts.push({ id: id, el: el, dismissing: false, timerId: timerId });

    // Max 4 visible — clear timers on evicted toasts
    while (state.toasts.length > 4) {
      var oldest = state.toasts.shift();
      if (oldest) {
        clearTimeout(oldest.timerId);
        if (oldest.el.parentNode) oldest.el.parentNode.removeChild(oldest.el);
      }
    }

    return id;
  }

  function dismissToast(id) {
    var idx = state.toasts.findIndex(function(t) { return t.id === id; });
    if (idx === -1) return;
    var toast = state.toasts[idx];
    if (toast.dismissing) return;
    toast.dismissing = true;
    clearTimeout(toast.timerId);
    if (toast.el.parentNode) toast.el.parentNode.removeChild(toast.el);
    state.toasts = state.toasts.filter(function(t) { return t.id !== id; });
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── API Wrapper ────────────────────────────────────────
  async function apiCall(path, method, body, toastConfig) {
    var opts = { method: method, headers: {'Content-Type':'application/json'} };
    if (body) opts.body = JSON.stringify(body);
    try {
      var res = await fetch(path, opts);
      var data = await res.json();
      if (!res.ok) {
        showToast({ type: 'error', title: 'Error', body: data.error || JSON.stringify(data), details: data });
      } else if (toastConfig) {
        var toastBody = '';
        try { toastBody = toastConfig.bodyFn ? toastConfig.bodyFn(data) : JSON.stringify(data); } catch(e) { toastBody = JSON.stringify(data); }
        showToast({ type: toastConfig.type, title: toastConfig.title, body: toastBody, details: data });
      }
      refresh();
      return data;
    } catch(e) {
      showToast({ type: 'error', title: 'Network Error', body: e.message });
    }
  }

  // ── Scenario Toast Formatters ──────────────────────────
  function formatFlowResult(data) {
    var r = data.result || '';
    var lines = r.split('; ').map(function(s) { return '\\u2022 ' + s.trim(); }).join('<br>');
    return lines + '<br><br>Open Damasqas \\u2192 Flows tab to see the tree visualization and deadlock alerts.';
  }

  async function runAllScenarios() {
    var toastId = showToast({ type: 'scenario', title: 'Running All Scenarios', body: 'Running all 7 scenarios...', duration: 60000 });
    try {
      var data = await apiCall('/scenario/all', 'POST', null, null);
      dismissToast(toastId);
      if (data && data.result) {
        var lines = String(data.result).split('\\n').filter(function(l) { return l.trim(); });
        var summary = lines.map(function(line) {
          var hasError = line.toLowerCase().indexOf('error') !== -1;
          return (hasError ? '\\u2717 ' : '\\u2713 ') + line.trim();
        }).join('<br>');
        showToast({ type: 'scenario', title: 'All Scenarios Complete', body: summary, details: data, duration: 8000 });
      }
    } catch(e) {
      dismissToast(toastId);
      showToast({ type: 'error', title: 'Scenario Error', body: e.message });
    }
  }

  // ── Queue Operations ───────────────────────────────────
  function resetQueue(queue) {
    apiCall('/reset/' + queue, 'POST', null, {type:'success', title:'Queue Reset', bodyFn: function(d) {
      return 'Reset ' + queue + ' to baseline (fail: ' + Math.round((QUEUE_INFO[queue]?.baselineFailureRate || 0) * 100) + '%, slowdown: 1x)';
    }});
    var failSlider = document.getElementById('fail-' + queue);
    var slowSlider = document.getElementById('slow-' + queue);
    var baseline = Math.round((QUEUE_INFO[queue]?.baselineFailureRate || 0) * 100);
    if (failSlider) { failSlider.value = String(baseline); document.getElementById('fail-val-' + queue).textContent = baseline + '%'; }
    if (slowSlider) { slowSlider.value = '1'; document.getElementById('slow-val-' + queue).textContent = '1x'; }
  }

  function resetAll() {
    apiCall('/reset-all', 'POST', null, {type:'success', title:'All Chaos Reset', bodyFn: function() { return 'All queues reset to baseline'; }});
    Object.keys(QUEUE_INFO).forEach(function(queue) {
      var failSlider = document.getElementById('fail-' + queue);
      var slowSlider = document.getElementById('slow-' + queue);
      if (failSlider) { failSlider.value = String(Math.round((QUEUE_INFO[queue].baselineFailureRate || 0) * 100)); document.getElementById('fail-val-' + queue).textContent = failSlider.value + '%'; }
      if (slowSlider) { slowSlider.value = '1'; document.getElementById('slow-val-' + queue).textContent = '1x'; }
    });
  }

  // ── Delta Formatter ────────────────────────────────────
  function formatDelta(current, previous) {
    if (previous === undefined || previous === null) return '';
    var diff = current - previous;
    if (diff === 0) return '';
    if (diff > 0) return '<span class="delta delta-up">+' + diff + '</span>';
    return '<span class="delta delta-down">' + diff + '</span>';
  }

  var METRIC_PREFIXES = { waiting: 'w', active: 'a', completed: 'c', failed: 'f', delayed: 'd' };

  // ── Update Queue Card ──────────────────────────────────
  function updateQueueCard(queue, info) {
    var el = function(id) { return document.getElementById(id); };
    var counts = info.counts;
    var prev = state.previousCounts[queue] || {};

    // Update counts and deltas — skip writes when unchanged
    var metrics = ['waiting', 'active', 'completed', 'failed', 'delayed'];
    metrics.forEach(function(metric) {
      var prefix = METRIC_PREFIXES[metric];
      var val = String(counts[metric] || 0);

      var numEl = el(prefix + '-' + queue);
      if (numEl && numEl.textContent !== val) {
        numEl.textContent = val;
      }
      var deltaEl = el(prefix + 'd-' + queue);
      if (deltaEl) {
        var deltaHtml = formatDelta(counts[metric] || 0, prev[metric]);
        if (deltaEl.innerHTML !== deltaHtml) deltaEl.innerHTML = deltaHtml;
      }
    });

    // Update badge — skip write if already correct
    var badge = el('badge-' + queue);
    if (badge) {
      var baselineRate = info.baseline?.failureRate || 0;
      var elevated = info.chaos.failureRate > baselineRate + 0.01 || info.chaos.slowdownFactor > 1;
      var newText, newClass;
      if (elevated && info.producer?.running) {
        newText = 'DEGRADED'; newClass = 'card-badge badge-chaos';
      } else if (elevated) {
        newText = 'FAULTS ON'; newClass = 'card-badge badge-chaos';
      } else if (info.producer?.running) {
        newText = 'PRODUCING'; newClass = 'card-badge badge-running';
      } else {
        newText = 'IDLE'; newClass = 'card-badge badge-idle';
      }
      if (badge.textContent !== newText) badge.textContent = newText;
      if (badge.className !== newClass) badge.className = newClass;
    }

    // Idle state (card dimming)
    var card = el('card-' + queue);
    if (card) {
      var total = (counts.waiting || 0) + (counts.active || 0) + (counts.completed || 0) + (counts.failed || 0) + (counts.delayed || 0);
      var isIdle = !info.producer?.running && total === 0;
      if (isIdle) { card.classList.add('card-idle'); } else { card.classList.remove('card-idle'); }
    }
  }

  // ── Refresh Cycle ──────────────────────────────────────
  var _refreshing = false;
  async function refresh() {
    if (_refreshing) return;
    _refreshing = true;
    try {
      var res = await fetch('/status');
      if (!res.ok) throw new Error('status endpoint returned ' + res.status);
      var data = await res.json();
      var anyRunning = false;
      var anyJobs = false;
      var degradedCount = 0;
      var degradedQueues = [];

      for (var _i = 0, _e = Object.entries(data); _i < _e.length; _i++) {
        var queue = _e[_i][0];
        var info = _e[_i][1];

        // Store previous counts
        state.previousCounts[queue] = state.queues[queue]?.counts || {};
        state.queues[queue] = info;

        // Update card
        updateQueueCard(queue, info);

        // Track global state
        if (info.producer?.running) anyRunning = true;
        var total = Object.values(info.counts).reduce(function(s, v) { return s + v; }, 0);
        if (total > 0) anyJobs = true;

        var baseRate = info.baseline?.failureRate || 0;
        if (info.chaos.failureRate > baseRate + 0.01 || info.chaos.slowdownFactor > 1) {
          degradedCount++;
          degradedQueues.push(queue);
        }
      }

      // Hero visibility
      if ((anyRunning || anyJobs) && !state.heroDismissed) {
        state.heroDismissed = true;
        var hero = document.getElementById('hero');
        if (hero) { hero.style.display = 'none'; }
      }

      // Chaos indicator
      var chaosEl = document.getElementById('chaos-indicator');
      var chaosCountEl = document.getElementById('chaos-count');
      if (chaosEl) {
        if (degradedCount > 0) {
          chaosEl.classList.add('active');
          chaosCountEl.textContent = degradedCount + ' queue' + (degradedCount > 1 ? 's' : '') + ' degraded';
          chaosEl.dataset.queues = degradedQueues.join(',');
        } else {
          chaosEl.classList.remove('active');
        }
      }

      // Redis connected (status succeeded)
      state.redisConnected = true;
      updateConnectionStatus();
    } catch(e) {
      state.redisConnected = false;
      updateConnectionStatus();
    } finally {
      _refreshing = false;
    }
  }

  // ── Connection Status ──────────────────────────────────
  function updateConnectionStatus() {
    var redisDot = document.getElementById('redis-dot');
    var damasqasDot = document.getElementById('damasqas-dot');
    if (redisDot) {
      redisDot.className = 'status-dot ' + (state.redisConnected ? 'connected' : 'disconnected');
    }
    if (damasqasDot) {
      damasqasDot.className = 'status-dot ' + (state.damasqasConnected ? 'connected' : 'disconnected');
    }
  }

  async function checkDamasqas() {
    try {
      await fetch('http://localhost:3888/api/health', { mode: 'no-cors' });
      state.damasqasConnected = true;
    } catch(e) {
      state.damasqasConnected = false;
    }
    updateConnectionStatus();
  }

  // ── Scroll to Degraded ─────────────────────────────────
  function scrollToDegraded() {
    var chaosEl = document.getElementById('chaos-indicator');
    if (!chaosEl || !chaosEl.dataset.queues) return;
    var queues = chaosEl.dataset.queues.split(',');
    if (queues.length > 0) {
      var card = document.getElementById('card-' + queues[0]);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.boxShadow = '0 0 0 2px rgba(248,113,113,0.4), 0 8px 32px rgba(0,0,0,0.4)';
        setTimeout(function() {
          card.style.boxShadow = '';
        }, 2000);
      }
    }
  }

  // ── Flood Modal ────────────────────────────────────────
  function openFloodModal(queue) {
    var modal = document.getElementById('flood-modal');
    modal.dataset.queue = queue;
    document.getElementById('flood-queue-name').textContent = queue;
    document.getElementById('flood-input').value = '1000';
    updateFloodEstimate();
    modal.classList.add('open');
    setTimeout(function() { document.getElementById('flood-input').focus(); document.getElementById('flood-input').select(); }, 50);
  }

  function closeFloodModal() {
    document.getElementById('flood-modal').classList.remove('open');
  }

  function setFloodCount(count) {
    document.getElementById('flood-input').value = count;
    updateFloodEstimate();
  }

  function updateFloodEstimate() {
    var queue = document.getElementById('flood-modal').dataset.queue;
    var count = Number(document.getElementById('flood-input').value);
    var info = QUEUE_INFO[queue];
    var estimateEl = document.getElementById('flood-estimate');
    if (!info || !count || count <= 0) {
      estimateEl.textContent = '';
      return;
    }
    var avgMs = (info.processingMs.min + info.processingMs.max) / 2;
    var throughput = (info.workers * info.concurrency * 60000) / avgMs;
    var minutes = Math.ceil(count / throughput);
    estimateEl.textContent = '~' + minutes + ' min to process at current capacity (' + Math.round(throughput) + ' jobs/min)';
  }

  function submitFlood() {
    var queue = document.getElementById('flood-modal').dataset.queue;
    var count = Number(document.getElementById('flood-input').value);
    if (count > 0) {
      apiCall('/producers/' + queue + '/add', 'POST', { count: count }, {
        type: 'info', title: 'Jobs Added',
        bodyFn: function(d) { return 'Added ' + d.added + ' jobs to ' + queue; }
      });
    }
    closeFloodModal();
  }

  // ── Help Modal ─────────────────────────────────────────
  function toggleHelp() {
    var modal = document.getElementById('help-modal');
    modal.classList.toggle('open');
  }

  function closeAllModals() {
    document.getElementById('flood-modal').classList.remove('open');
    document.getElementById('help-modal').classList.remove('open');
  }

  // ── Keyboard Shortcuts ─────────────────────────────────
  var SCENARIO_PATHS = [
    '/scenario/flows', '/scenario/overdue', '/scenario/memory',
    '/scenario/drain', '/scenario/events', '/scenario/job-types', '/scenario/alerts'
  ];
  var SCENARIO_NAMES = ['Flow + Deadlock', 'Overdue Delayed', 'Memory Pressure', 'Drain Imbalance', 'Event Diversity', 'Job Type Mix', 'Alert Rules'];

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    var floodOpen = document.getElementById('flood-modal').classList.contains('open');
    var helpOpen = document.getElementById('help-modal').classList.contains('open');
    if (floodOpen || helpOpen) {
      if (e.key === 'Escape') closeAllModals();
      return;
    }

    switch (e.key) {
      case 's':
        apiCall('/producers/start-all', 'POST', null, {type:'info', title:'Started All Producers', bodyFn: function() { return 'Started all producers (' + Object.keys(QUEUE_INFO).length + ' queues)'; }});
        break;
      case 'x':
        apiCall('/producers/stop-all', 'POST', null, {type:'info', title:'Stopped All Producers', bodyFn: function() { return 'Stopped all producers'; }});
        break;
      case 'r':
        resetAll();
        break;
      case '1': case '2': case '3': case '4': case '5': case '6': case '7':
        var idx = Number(e.key) - 1;
        apiCall(SCENARIO_PATHS[idx], 'POST', null, {type:'scenario', title: SCENARIO_NAMES[idx], bodyFn: function(d) { return d.result || JSON.stringify(d); }});
        break;
      case 'a':
        runAllScenarios();
        break;
      case 'd':
        window.open('http://localhost:3888', '_blank');
        break;
      case '?':
        toggleHelp();
        break;
    }
  });

  // ── Init ───────────────────────────────────────────────
  refresh();
  setInterval(refresh, 5000);
  checkDamasqas();
  setInterval(checkDamasqas, 10000);
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

// ─── Feature Test Scenarios ─────────────────────────────

app.post("/scenario/flows", async (_req, res) => {
  try {
    const result = await runFlowScenario();
    res.json({ scenario: "flows", result });
  } catch (err) {
    res.status(500).json({ scenario: "flows", error: String(err) });
  }
});

app.post("/scenario/overdue", async (_req, res) => {
  try {
    const result = await runOverdueScenario();
    res.json({ scenario: "overdue", result });
  } catch (err) {
    res.status(500).json({ scenario: "overdue", error: String(err) });
  }
});

app.post("/scenario/memory", async (_req, res) => {
  try {
    const result = await runMemoryPressureScenario();
    res.json({ scenario: "memory", result });
  } catch (err) {
    res.status(500).json({ scenario: "memory", error: String(err) });
  }
});

app.post("/scenario/drain", async (_req, res) => {
  try {
    const result = await runDrainImbalanceScenario();
    res.json({ scenario: "drain", result });
  } catch (err) {
    res.status(500).json({ scenario: "drain", error: String(err) });
  }
});

app.post("/scenario/events", async (_req, res) => {
  try {
    const result = await runEventDiversityScenario();
    res.json({ scenario: "events", result });
  } catch (err) {
    res.status(500).json({ scenario: "events", error: String(err) });
  }
});

app.post("/scenario/job-types", async (_req, res) => {
  try {
    const result = await runJobTypeDiversityScenario();
    res.json({ scenario: "job-types", result });
  } catch (err) {
    res.status(500).json({ scenario: "job-types", error: String(err) });
  }
});

app.post("/scenario/alerts", async (_req, res) => {
  try {
    const result = await runAlertRulesScenario();
    res.json({ scenario: "alerts", result });
  } catch (err) {
    res.status(500).json({ scenario: "alerts", error: String(err) });
  }
});

app.post("/scenario/all", async (_req, res) => {
  try {
    const result = await runAllScenarios();
    res.json({ scenario: "all", result });
  } catch (err) {
    res.status(500).json({ scenario: "all", error: String(err) });
  }
});

app.get("/scenario/status", (_req, res) => {
  res.json(getScenarioStatus());
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
