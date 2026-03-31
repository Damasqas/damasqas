# damasqas

Standalone observability for [BullMQ](https://docs.bullmq.io/) queues. One command, zero code changes.

Damasqas connects directly to your Redis instance, automatically discovers every BullMQ queue, and gives you a real-time dashboard with anomaly detection, capacity planning, flow visualization, and alerting — all backed by a local SQLite database with no external dependencies.

```
npx damasqas --redis redis://localhost:6379
```

Then open [http://localhost:3888](http://localhost:3888).

---

## Why Damasqas?

Most BullMQ monitoring tools require you to instrument your worker code or only show you a snapshot of current queue state. Damasqas takes a different approach:

- **Zero code changes.** Point it at Redis and it works. No SDK, no middleware, no worker modifications. Reads Redis data structures directly via `ioredis`.
- **Historical analytics.** SQLite (WAL mode) stores up to 30 days of metrics so you can spot trends, not just react to fires. Automatic downsampling keeps storage bounded.
- **Anomaly detection.** Seven anomaly types detected automatically against rolling baselines — failure spikes, backlog growth, stalled jobs, processing slowdowns, idle queues, old waiting jobs, and overdue delayed jobs. Anomalies auto-resolve when conditions clear.
- **Capacity planning.** Real-time drain rate analysis with smoothed rates tells you whether your workers are keeping up, how long until the queue clears, and how much more capacity you need.
- **Flow awareness.** Visualize parent-child job dependencies and detect deadlocked flows where a parent is permanently stuck waiting on a failed child with no retries left.
- **BullMQ v5 native.** Full support for prioritized jobs, waiting-children state, flow dependencies, packed delayed scores, and built-in worker metrics when available.

---

## Features

### Real-Time Dashboard

A React SPA served directly by Damasqas with auto-refreshing data (3–60s intervals depending on the view). Seven pages:

- **Overview** — queue table with throughput, failure rate, waiting depth, trend arrows, lock counts, stalled/overdue indicators. Stat cards show aggregate totals with comparative trend arrows vs yesterday. Critical anomaly banner at top when issues are detected.
- **Queue Detail** — per-queue deep dive with pause/resume/retry-all/promote-all controls, stat cards for all 8 count types, capacity planning panel (drain analysis + inflow vs drain chart), time-series charts for throughput, failures, waiting depth, and active jobs across 4 time ranges (1h / 6h / 24h / 7d), and a sortable job type breakdown table.
- **Failed Jobs** — queue selector with failure count badges, error groups with expandable per-job listings, and inline retry/remove actions for individual jobs.
- **Events** — paginated event timeline with queue, type, and job name filters. Full-text search bar powered by SQLite FTS5. Expandable rows showing raw event JSON. Debounced inputs to avoid wasted API calls during typing.
- **Flows** — deadlock detection panel with severity indicators and "View Flow" buttons, waiting-children jobs table with child completion counts, and an interactive flow tree viewer that auto-expands nodes with problems (deadlocked or blocking children).
- **Redis** — memory usage chart with time-range selector, stat cards (memory, peak, fragmentation, clients, ops/sec, total keys, OOM projection), maxmemory-policy warning banner, top growth contributors table with per-key recommendations, per-queue key size aggregation, and slowlog table with BullMQ command tagging.
- **Alerts** — active anomalies with severity badges and historical anomaly log. (Rule-based alert management is API-only — see the Alert Rules API below.)

Toast notifications provide immediate feedback on operations (pause, resume, retry, promote). The dashboard uses IBM Plex Sans and IBM Plex Mono typography on a dark theme.

### Automatic Queue Discovery

Scans Redis for `{prefix}:*:meta` keys every 60 seconds (configurable via `--discovery-interval`) using `SCAN` with `TYPE hash` server-side filtering and `COUNT 200` for efficient iteration. New queues appear in the dashboard automatically and emit a `queue:added` event. Queues missing from 3 consecutive scans are marked stale and emit a `queue:stale` event — they remain visible in the UI but are flagged so you know they may have been removed.

### Historical Data Backfill

On first startup, Damasqas backfills up to 7 days of historical data from Redis for each discovered queue. It reads cumulative completed and failed counts from Redis sorted sets and distributes them into synthetic 5-minute snapshots with derived metrics rows (throughput, failure rate, backlog growth), giving the rolling-average anomaly detection an immediate baseline without waiting days for data to accumulate. Queues that already have data in SQLite are skipped.

### Anomaly Detection

Seven anomaly types detected automatically against rolling baselines:

- **Failure spike** — failure rate exceeds Nx the 7-day rolling average (default threshold: 3x)
- **Backlog growth** — waiting depth exceeds Nx the 24-hour average (default threshold: 5x)
- **Processing slowdown** — average processing time exceeds Nx the 7-day baseline
- **Stalled jobs** — active jobs without worker locks detected (zero-baseline — always fires as critical)
- **Queue idle** — throughput drops to zero for 10+ minutes on a queue with a historical average above 0.5 jobs/min
- **Oldest waiting job** — a job has been sitting in the wait list longer than 10 minutes
- **Overdue delayed jobs** — delayed jobs past their scheduled execution time (zero-baseline — always fires as critical)

Anomalies auto-resolve when the triggering condition clears. Severity escalates from `warning` to `critical` when the multiplier crosses 10x. A configurable cooldown period (default 300s) prevents alert fatigue from repeated fires.

### Error Clustering

Failed job errors are automatically grouped by normalized signature. The normalizer strips variable content — hex IDs, long numbers, stack trace locations, and excess whitespace — so that errors like `Cannot read property 'email' of undefined` from different jobs collapse into a single group with a count and sample job IDs.

Error groups are persisted to SQLite with atomic `ON CONFLICT` upserts — each new failure event from the Redis Stream increments the group's count and updates the last-seen timestamp and sample job ID in a single statement. Groups are surfaced on the dashboard and via the `/api/queues/:name/errors` endpoint, with per-job retry and remove actions.

### Rule-Based Alerting

Create alert rules via the REST API with per-rule webhooks, cooldown periods, and optional queue scoping. Six rule types:

| Rule Type | Fires When |
|-----------|------------|
| `failure_spike` | Fail rate per minute exceeds configured threshold |
| `depth_threshold` | Waiting count exceeds configured threshold |
| `overdue_delayed` | Oldest overdue delayed job exceeds configured millisecond threshold |
| `orphaned_active` | Number of active jobs without locks (stalled) exceeds threshold |
| `redis_memory` | Redis `used_memory` exceeds configured byte threshold |
| `drain_negative` | Queue has been growing for 5+ consecutive analysis intervals |

Alerts fire to Slack (Block Kit formatted), Discord (rich embeds), or any generic webhook URL. Each rule can specify its own webhook URLs; if a rule has no rule-specific webhooks, Damasqas falls back to the global `--slack-webhook` and `--discord-webhook` configured at startup. Each alert fire is persisted with a full context payload including snapshot state, sample overdue jobs, drain analysis with capacity deficit, and Redis health with OOM projection and top growth contributors.

Rules without queue scoping evaluate against all discovered queues. Cooldown periods are per-rule. Fire history is queryable via the API.

### Drain Rate Analysis & Capacity Planning

Per-queue analysis computed every ~10 seconds using a smoothed sliding window over the last 5 snapshots in a circular buffer of 10:

- **Inflow rate** — jobs entering the wait list per minute (derived from depth change + drain rate)
- **Drain rate** — jobs leaving the wait list per minute (completed + failed, since both paths drain the queue)
- **Net rate** — drain rate minus inflow rate (positive = draining, negative = growing)
- **Trend classification** — `draining` (net > 1/min), `stable` (net between -1 and +1), `growing` (net < -1), or `stalled` (no active workers with non-zero depth, unless the queue is paused)
- **Projected time to drain** — at the current net rate, how long until the queue is empty (null if growing)
- **Capacity deficit** — percentage more processing capacity needed to stabilize a growing queue
- **Inflow vs drain chart** — time-series overlay on the queue detail page

Total depth includes all BullMQ v5 backlog sources: the `wait` list, `prioritized` sorted set, and `waiting-children` list.

When BullMQ built-in worker metrics are enabled (via the `metrics` option on your Worker), Damasqas automatically detects and prefers them over snapshot-delta calculations for more accurate throughput data. This detection runs at queue discovery time and is cached per queue.

### Event Timeline & Full-Text Search

Consumes BullMQ's Redis Streams (`{prefix}:{queue}:events`) in real-time via a dedicated blocking `XREAD` connection. For installations with many queues, streams are chunked into groups of 20 per `XREAD` call — single-chunk installations use efficient blocking reads while multi-chunk installations use non-blocking reads with backoff to avoid serialized blocking across chunks.

Events are persisted to SQLite with:

- **Job name hydration** — resolved from Redis job hashes every 5 seconds via a pipelined batch across all queues. Uses a server-side Lua script to truncate payloads to 500 characters inside Redis, avoiding multi-MB transfers over the network.
- **Job timing hydration** — a separate 10-second cycle fetches `timestamp`, `processedOn`, and `finishedOn` from completed job hashes to compute wait and processing times. Jobs with deleted hashes (e.g., `removeOnComplete: true`) get sentinel rows to prevent infinite retry.
- **Job payload indexing** — truncated payloads are merged into the event data field and indexed via SQLite FTS5 (content-sync table backed by the events table). The FTS index is manually kept in sync on every insert, job name hydration update, and tiered retention deletion — each operation issues the corresponding FTS `delete` and re-`insert` to keep search results accurate as data changes. Search by order ID, customer name, or any content in the job payload.
- **Cursor persistence** — stream read positions are saved to SQLite per queue, so restarts resume from where they left off without replaying or missing events.
- **NOSCRIPT recovery** — if Redis restarts and evicts the cached Lua script, the hydration cycle detects the error, clears the SHA, and retries on the next cycle instead of permanently marking jobs as errors.
- **Hydration performance** — a partial index (`WHERE job_name IS NULL`) on the events table keeps the 5-second hydration query fast as the table grows to millions of rows, avoiding full table scans.

**Tiered event retention** keeps storage bounded while preserving what matters:

| Age | What's kept |
|-----|-------------|
| 0–1 hour | All events at full resolution |
| 1–24 hours | `failed`, `stalled`, and `error` events only |
| 1–7 days | `failed` and `stalled` events only |
| 7+ days | Deleted (aggregated counts live in snapshots and job type summaries) |

### Job Type Breakdown

Per-job-name analytics within each queue:

- Completed and failed counts per job type
- Failure rate percentage
- Average wait time (time from job creation to processing start)
- Average processing time (time from processing start to completion)
- P95 processing time (computed application-side from sorted timing data)
- Pre-aggregated per-minute summaries for long-range queries (6h / 24h / 7d) that survive event pruning

The 1-hour range queries raw events and timings directly. Longer ranges use pre-aggregated `job_type_summaries` that are computed every ~60 seconds by the collector, ensuring consistent data even after tiered event retention deletes completed events.

### Flow Visualization & Deadlock Detection

For BullMQ flows (parent-child job dependencies):

- **Flow tree viewer** — given any job, walks up the parent chain (up to 20 hops) to find the root, then recursively builds the full child tree (up to depth 10, max 200 nodes). Each node shows job name, queue, state badge, retry progress (attempts/maxAttempts), and blocker/deadlock indicators. Cycle detection prevents infinite loops in corrupted parent chains.
- **Deadlock detection** — scans all queues every ~5 minutes for parents in `waiting-children` state that have children in the `failed` sorted set with `attemptsMade >= maxAttempts` and no `failParentOnFailure` option. These parents will wait forever unless manually resolved. Deadlocks are cached and served via the API.
- **Waiting-children table** — lists all parent jobs blocked on child completion with pending, completed, and failed child counts. Click any row to expand its flow tree.

Flow state is resolved from multiple Redis data structures in a single pipeline: `ZSCORE` against completed/failed/delayed/prioritized/waiting-children sorted sets, `LPOS` against the wait list, `EXISTS` on the job hash and lock key.

### Redis Health Monitoring

Infrastructure-level visibility into the Redis instance powering your queues:

- **Memory tracking** — used memory, peak memory, RSS, fragmentation ratio. Memory percentage shown when `maxmemory` is configured.
- **OOM projection** — linear regression over the last ~10 minutes of snapshots. Projects hours until Redis hits `maxmemory`, with growth rate in MB/hour. Returns null when memory is stable or shrinking.
- **`maxmemory-policy` validation** — BullMQ requires `noeviction`. Damasqas checks on startup and warns in the dashboard and logs if a different policy is detected. With wrong policies, Redis may silently evict BullMQ keys under memory pressure.
- **Per-queue key size tracking** — every 5 minutes, collects entry counts for 8 key types per queue: `events` stream, `completed` set, `failed` set, `wait` list, `active` list, `delayed` set, `prioritized` set, and `waiting-children` list.
- **Per-key `MEMORY USAGE` sampling** — optionally (every 30 minutes), runs Redis `MEMORY USAGE` against the top 3 key types per queue (events, completed, failed) for byte-level memory attribution. Disable with `--no-redis-key-memory` if this is too expensive for your setup.
- **Slowlog capture** — polls Redis `SLOWLOG GET` every ~10 seconds with deduplication by monotonic slowlog entry ID. Commands are tagged as BullMQ-related if they contain the configured prefix (typically `EVALSHA` calls with `bull:` key arguments).
- **Growth attribution with actionable recommendations** — identifies which queues and key types are growing fastest and generates BullMQ-specific remediation advice:

| Key Type | Example Recommendation |
|----------|----------------------|
| `events` | Configure `streams.events.maxLen` in queue options, or `XTRIM` manually |
| `completed` | Configure `removeOnComplete: { count: 1000 }` on the queue |
| `failed` | Review and retry failed jobs; configure `removeOnFail: { count: 5000 }` |
| `wait` / `prioritized` | Add more workers or increase concurrency |
| `delayed` | Check if scheduled jobs are being created faster than processed |
| `waiting-children` | Check for stuck child jobs blocking parent flows |
| `active` | Check for stalled processors or increase stalled job check interval |

### Comparative Analytics

Compare current metrics against the same time window yesterday and last week:

- **Overview page** — aggregate throughput, failure rate, and queue depth trends across all queues with trend arrows (only includes queues with data in both periods to avoid skewing)
- **Per-queue event-based comparison** — completed count, failed count, fail rate, and average processing time for the current hour vs same hour yesterday vs same hour last week. Current hour uses raw events; historical periods use pre-aggregated summaries (since completed events are pruned after 1 hour).
- **Per-queue snapshot-based comparison** — waiting depth, throughput rate, and fail rate averaged over 5-minute windows (instead of single snapshots) to smooth out the noise from instantaneous 1-second rates.

Trend significance thresholds: rates are significant at 2x change, absolute values at 50% change. Below threshold shows as "stable" with the multiplier.

### Clock Skew Compensation

On startup, Damasqas compares the local system clock against Redis `TIME` to detect skew. If the difference exceeds 5 seconds, all time-sensitive operations — overdue delayed job detection, drain analysis timestamps, and `ZRANGEBYSCORE` filters — automatically compensate. This prevents false positives when Damasqas runs on a different host than Redis with drifting clocks (common in containerized deployments).

### Operations

Pause, resume, retry, remove, promote, and clean jobs directly from the dashboard or API without touching your application code:

- **Pause / Resume** — halt and restart job processing for a queue
- **Retry** — retry a single failed job, or retry all failed jobs in bulk
- **Remove** — delete a specific job from any state
- **Promote** — move a delayed job to the wait list immediately, or promote all overdue delayed jobs in bulk
- **Clean** — remove completed or failed jobs with configurable grace period and limit

All write operations use a dedicated Redis connection (`ops`) via BullMQ's `Queue` and `Job` classes, ensuring proper Lua script execution and state transitions.

### Headless Mode

Run Damasqas as a pure collector without the web dashboard using `--no-dashboard`. Useful for deployments where you only need the API (e.g., feeding data to Grafana or a custom UI), or when running multiple Damasqas instances with only one serving the dashboard.

### Graceful Shutdown

Damasqas handles `SIGINT` and `SIGTERM` signals with a clean shutdown sequence: stops the collector polling loop, stops the event stream consumer (disconnects the blocking `XREAD` connection), flushes and closes the SQLite database, disconnects all three Redis connections, and closes the HTTP server. This ensures no data corruption on deploys, container restarts, or `Ctrl+C`.

---

## Quick Start

### npx (no install)

```bash
npx damasqas --redis redis://localhost:6379
```

### Global Install

```bash
npm install -g damasqas
damasqas --redis redis://localhost:6379
```

### Docker

The Dockerfile uses a multi-stage build (compile TypeScript + build Vite UI in the build stage, copy only `dist/` and `node_modules/` to the runtime stage) and includes a built-in health check:

```bash
docker build -t damasqas .
docker run -p 3888:3888 \
  -v damasqas-data:/data \
  -e DAMASQAS_DATA_DIR=/data \
  damasqas node dist/index.js --redis redis://host.docker.internal:6379
```

### Docker Compose

```yaml
services:
  damasqas:
    build: .
    ports:
      - "3888:3888"
    command: node dist/index.js --redis redis://redis:6379
    environment:
      DAMASQAS_DATA_DIR: /data
    volumes:
      - damasqas-data:/data
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3888/api/health"]
      interval: 5s
      timeout: 3s

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 512mb --maxmemory-policy noeviction
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s

volumes:
  damasqas-data:
```

### From Source

```bash
git clone https://github.com/Damasqas/damasqas.git
cd damasqas
npm install
npm run build
npm run build:ui
node dist/index.js --redis redis://localhost:6379
```

---

## Configuration

Damasqas is configured via CLI flags, environment variables, or a config file. Priority: **CLI > environment variables > config file > defaults**.

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--redis <url>` | **(required)** | Redis connection URL |
| `--port <number>` | `3888` | Dashboard and API port |
| `--prefix <string>` | `bull` | BullMQ key prefix |
| `--poll-interval <seconds>` | `1` | Snapshot collection interval |
| `--discovery-interval <seconds>` | `60` | Queue discovery scan interval |
| `--retention-days <number>` | `30` | How long to keep historical data in SQLite |
| `--slack-webhook <url>` | — | Slack incoming webhook URL for anomaly alerts |
| `--discord-webhook <url>` | — | Discord webhook URL for anomaly alerts |
| `--cooldown <seconds>` | `300` | Minimum seconds between repeat anomaly alerts |
| `--failure-threshold <n>` | `3` | Alert when failures exceed Nx baseline |
| `--backlog-threshold <n>` | `5` | Alert when backlog exceeds Nx baseline |
| `--no-redis-key-memory` | — | Disable per-key `MEMORY USAGE` collection (saves Redis CPU every 30 min) |
| `--api-key <key>` | — | Damasqas Cloud API key (future) |
| `--no-dashboard` | — | Run collector only, no web UI (headless mode) |
| `--verbose` | — | Enable debug logging for all subsystems |

### Environment Variables

| Variable | Maps to |
|----------|---------|
| `REDIS_URL` | `--redis` |
| `DAMASQAS_PORT` | `--port` |
| `DAMASQAS_PREFIX` | `--prefix` |
| `DAMASQAS_POLL_INTERVAL` | `--poll-interval` |
| `DAMASQAS_DISCOVERY_INTERVAL` | `--discovery-interval` |
| `DAMASQAS_RETENTION_DAYS` | `--retention-days` |
| `SLACK_WEBHOOK` | `--slack-webhook` |
| `DISCORD_WEBHOOK` | `--discord-webhook` |
| `DAMASQAS_COOLDOWN` | `--cooldown` |
| `DAMASQAS_FAILURE_THRESHOLD` | `--failure-threshold` |
| `DAMASQAS_BACKLOG_THRESHOLD` | `--backlog-threshold` |
| `DAMASQAS_REDIS_KEY_MEMORY` | Set to `false` to disable per-key memory sampling |
| `DAMASQAS_API_KEY` | `--api-key` |
| `DAMASQAS_DATA_DIR` | SQLite data directory (default: `~/.damasqas`) |

### Config File

Place a `damasqas.config.json` in your working directory or at `~/.damasqas/config.json`:

```json
{
  "redis": "redis://localhost:6379",
  "port": 3888,
  "prefix": "bull",
  "pollInterval": 1,
  "discoveryInterval": 60,
  "retentionDays": 30,
  "slackWebhook": "https://hooks.slack.com/services/...",
  "discordWebhook": "https://discord.com/api/webhooks/...",
  "cooldown": 300,
  "failureThreshold": 3,
  "backlogThreshold": 5,
  "stallAlert": true,
  "redisKeyMemoryUsage": true,
  "noDashboard": false,
  "verbose": false
}
```

---

## Architecture

### Redis Connections

Damasqas uses three dedicated Redis connections (all with `maxRetriesPerRequest: null` for BullMQ compatibility) to avoid interference between subsystems:

| Connection | Purpose |
|------------|---------|
| **cmd** | Read-only: `SCAN`, `LLEN`, `ZCARD`, `HGETALL`, `INFO`, `CONFIG GET`, `SLOWLOG`, `MEMORY USAGE`, pipelined batch snapshots, Lua script evaluation for job hydration |
| **stream** | Dedicated blocking `XREAD` for real-time event stream consumption. Uses `enableReadyCheck: false` since it may block for seconds at a time. |
| **ops** | Write operations only: pause, resume, retry, remove, promote, clean — all via BullMQ's `Queue` and `Job` classes to ensure proper Lua script state transitions. All `Queue` instances share this single connection (no `duplicate()`) to avoid connection proliferation. |

### Startup Sequence

On boot, Damasqas runs a deterministic startup sequence before starting the polling loop:

1. Connect three Redis connections (cmd, stream, ops)
2. Check clock skew against Redis `TIME`
3. Validate `maxmemory-policy` is `noeviction` (warns if not)
4. Initialize SQLite with schema migrations (V1–V6)
5. Run initial queue discovery scan
6. Check which queues have BullMQ built-in metrics enabled
7. Backfill historical data for newly discovered queues
8. Run initial snapshot collection for all queues (so the dashboard is never blank)
9. Start the unified collector polling loop
10. Start the event stream consumer on the dedicated stream connection
11. Start the anomaly alert dispatch loop
12. Start the HTTP server

This means the dashboard has data immediately on first page load — no waiting for the first poll cycle.

### SQLite Storage

All collected data is stored in a local SQLite database at `~/.damasqas/data.db` (or the path specified by `DAMASQAS_DATA_DIR`). Configuration:

- **WAL mode** — concurrent readers don't block the writer (critical since the collector writes every second while the API reads concurrently)
- **SYNCHRONOUS = NORMAL** — balanced durability and performance
- **Incremental schema migrations** — V1 through V6, versioned in a `schema_version` table. New columns and tables are added safely with `ALTER TABLE` and `CREATE TABLE IF NOT EXISTS`.

No external database, no network dependency beyond Redis.

### API Server

The API is built on Express with CORS enabled by default (all origins), allowing custom dashboards, Grafana integrations, or any HTTP client to query Damasqas without additional proxy configuration. The dashboard UI is a React SPA served as static files with a catch-all route for client-side routing.

### Collection Cadences

The collector runs a unified polling loop at the configured `--poll-interval` (default 1 second). Heavier work runs at multiples of the tick interval:

| Cadence | What runs |
|---------|-----------|
| Every tick (1s) | Queue snapshots via 4-phase batched Redis pipeline (see below) |
| Every ~10s | Metrics row insertion, drain analysis, anomaly detection, alert rule evaluation, Redis INFO + slowlog collection |
| Every ~60s | Queue discovery scan, job type summary aggregation |
| Every ~5min | Per-queue key size collection (`XLEN`, `ZCARD`, `LLEN` for 8 key types per queue) |
| Every ~5min | Flow deadlock detection scan |
| Every ~30min | Per-key `MEMORY USAGE` sampling (optional, disable with `--no-redis-key-memory`) |

**Batched snapshot pipeline.** Collecting snapshots for N queues does not issue N separate round-trips to Redis. Instead, `getSnapshotBatch()` runs four pipelined phases:

1. **Core counts** — a single pipeline of `LLEN`, `ZCARD`, `HGET`, `LINDEX` commands for all queues (9 commands per queue, 1 round-trip total)
2. **Oldest-waiting-age lookups** — one pipeline of `HGET` calls for queues that have a waiting job (fetches the timestamp of the oldest job)
3. **Active job lock checks** — one pipeline of `LRANGE` to fetch active job IDs, then a second pipeline of `EXISTS` to check each job's lock key (detects stalled jobs)
4. **Overdue delayed counts** — one pipeline of `ZCOUNT` per queue against the delayed sorted set with clock-skew-compensated score bounds and a 60-second grace period to avoid false positives from normal BullMQ promotion latency

For 50 queues, this is 4 Redis round-trips regardless of queue count, compared to 50+ round-trips with naive per-queue fetching.

The event stream consumer runs independently on the dedicated `stream` connection:

| Cadence | What runs |
|---------|-----------|
| Continuous | `XREAD BLOCK 5000` for event ingestion (chunked into groups of 20 queues) |
| Every 5s | Job name + payload hydration batch (Lua-based, pipelined across all queues) |
| Every 10s | Job timing hydration batch (wait time + processing time from job hashes) |

**Anomaly alert dispatch** runs on its own interval, decoupled from anomaly detection. The collector's analysis cycle detects and persists anomalies to SQLite; a separate dispatch loop checks for unsent anomalies and delivers them to Slack/Discord channels with enriched payloads (including the top error groups for the affected queue). This separation ensures detection is never blocked by slow webhook delivery.

**Cloud integration** (future) — a stub in `src/cloud.ts` is wired to post structured anomaly events to the Damasqas Cloud API when `--api-key` is configured. Currently a no-op awaiting the cloud layer.

### Data Retention

Automatic cleanup runs every hour:

| Data type | Retention |
|-----------|-----------|
| **Snapshots** | 1-second resolution for 1 hour, then downsampled to one-per-10-seconds, deleted after retention period |
| **Metrics** | Full retention period (default 30 days) |
| **Events** | 1h full → 1-24h failed/stalled/error only → 1-7d failed/stalled only → deleted |
| **Job timings** | Raw data for 24 hours; per-minute summaries for full retention period |
| **Job type summaries** | Full retention period |
| **Redis snapshots** | Full retention period |
| **Redis key sizes** | Full retention period |
| **Slowlog entries** | Full retention period |
| **Alert fires** | Full retention period |
| **Anomalies** | Resolved anomalies deleted after retention period; active anomalies kept indefinitely |

### BullMQ Compatibility

Damasqas is designed for BullMQ v4+ and fully supports BullMQ v5:

- **Packed delayed scores** — BullMQ v4+ encodes delayed job scores as `timestamp * 0x1000 + counter`. Damasqas correctly unpacks these for overdue detection and promotion.
- **Prioritized sorted set** — BullMQ v5 stores priority jobs in a separate `{prefix}:{queue}:prioritized` sorted set (distinct from the `wait` list). Damasqas tracks this in snapshots and includes it in drain analysis total depth.
- **Waiting-children list** — BullMQ v5 uses `{prefix}:{queue}:waiting-children` for parent jobs blocked on child flows. Tracked in snapshots, drain analysis, and the flow inspector.
- **Built-in worker metrics** — when workers are configured with `metrics: { maxDataPoints: ... }`, BullMQ writes per-minute completed/failed counts to `{prefix}:{queue}:metrics:completed:data`. Damasqas auto-detects these via `EXISTS` checks at discovery time and prefers them over snapshot-delta calculations when available.
- **`removeOnComplete` / `removeOnFail` handling** — when job hashes are deleted by these options, the timing hydration loop inserts sentinel rows (wait_ms = -1) to prevent infinite retry. Completed count deltas are clamped with `Math.max(0, delta)` to handle cases where the completed sorted set shrinks between snapshots.

---

## API Reference

All endpoints are served under `/api/` at the configured port (default 3888).

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Service health check — returns `{ status, queues, uptime }` |

### Queues

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queues` | List all discovered queues with full state (counts, metrics, anomalies, drain analysis, stale flag) |
| `GET` | `/api/queues/:name` | Single queue detail with all fields |
| `GET` | `/api/queues/:name/drain` | Drain rate analysis for a queue |
| `GET` | `/api/queues/:name/overdue-delayed` | List overdue delayed jobs with total count and per-job detail |
| `GET` | `/api/queues/:name/metrics?range=1h` | Snapshot and metric time series. Ranges: `1h`, `6h` (raw), `24h` (5-min buckets), `7d` (30-min buckets) |
| `GET` | `/api/queues/:name/comparison` | Compare current hour vs yesterday vs last week (event-based + snapshot-based) |
| `GET` | `/api/queues/:name/job-types?range=1h` | Per-job-type breakdown (completed, failed, fail rate, avg wait, avg process, P95) |
| `GET` | `/api/queues/:name/jobs?status=failed&limit=20&offset=0` | List jobs by status: `waiting`, `active`, `completed`, `failed`, `delayed` |
| `GET` | `/api/queues/:name/jobs/:id` | Single job detail (data, opts, timestamps, stacktrace, return value) |
| `GET` | `/api/queues/:name/errors` | Error groups for the last 5 minutes with counts and sample job IDs |
| `GET` | `/api/queues/:name/events?since=&until=&type=&job_name=&limit=&offset=` | Paginated events for a specific queue |

### Operations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/queues/:name/pause` | Pause a queue |
| `POST` | `/api/queues/:name/resume` | Resume a paused queue |
| `POST` | `/api/queues/:name/clean` | Clean jobs — body: `{ status: "completed"|"failed", grace: 0, limit: 1000 }` |
| `POST` | `/api/queues/:name/retry-all` | Retry all failed jobs in the queue |
| `POST` | `/api/queues/:name/promote-all` | Promote all overdue delayed jobs to the wait list |
| `POST` | `/api/queues/:name/jobs/:id/retry` | Retry a single failed job |
| `POST` | `/api/queues/:name/jobs/:id/remove` | Remove a single job from any state |
| `POST` | `/api/queues/:name/jobs/:id/promote` | Promote a single delayed job |

### Events & Search

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/events?since=&until=&queue=&type=&job_name=&limit=&offset=` | Paginated event listing with filters |
| `GET` | `/api/events/search?q=&queue=&type=&from=&to=&limit=&offset=` | Full-text search across job IDs, names, queues, event types, and payloads |
| `GET` | `/api/search?q=` | Alias for `/api/events/search` |

### Anomalies

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/anomalies?queue=` | Active and historical anomalies, optionally filtered by queue |

### Alert Rules

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/alerts/rules` | List all alert rules |
| `POST` | `/api/alerts/rules` | Create a new rule — body: `{ name, queue?, type, config, webhookUrl?, slackWebhook?, discordWebhook?, enabled?, cooldownSeconds? }` |
| `PUT` | `/api/alerts/rules/:id` | Update any fields on an existing rule |
| `DELETE` | `/api/alerts/rules/:id` | Delete a rule and its fire history |
| `GET` | `/api/alerts/rules/:id/history?limit=50` | Fire history for a specific rule |
| `GET` | `/api/alerts/fires?limit=100` | Recent fires across all rules |

### Flows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/flows/deadlocks` | Cached deadlocked flows with last scan timestamp |
| `GET` | `/api/flows/tree/:queue/:jobId` | Full flow tree starting from any job (walks to root, then builds child tree) |
| `GET` | `/api/flows/waiting-children?queue=` | Jobs in waiting-children state with child counts |

### Redis Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/redis/health` | Current snapshot, OOM projection, maxmemory-policy warning, top growth contributors |
| `GET` | `/api/redis/history?range=1h` | Redis memory time series. Ranges: `1h` (raw), `6h` (1-min buckets), `24h` (5-min), `7d` (30-min) |
| `GET` | `/api/redis/key-sizes` | Latest key sizes with growth deltas and recommendations |
| `GET` | `/api/redis/key-sizes/history?queue=&range=1h` | Key size time series for a specific queue |
| `GET` | `/api/redis/slowlog` | Recent slow commands (last 24 hours, up to 50 entries) |
| `GET` | `/api/redis` | Basic Redis info — version, memory, clients, uptime (legacy endpoint) |

### Comparative Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/comparison` | Cross-queue comparative analytics — current vs yesterday for all queues |

---

## Local Development

### Prerequisites

- Node.js 20+
- A running Redis instance (7.x recommended)

### Setup

```bash
git clone https://github.com/Damasqas/damasqas.git
cd damasqas
npm install
cd ui && npm install && cd ..
```

### Running in Dev Mode

```bash
npm run dev -- --redis redis://localhost:6379
```

This builds the UI, then starts the server with `tsx` for TypeScript execution without a separate compile step.

For UI-only development with Vite's hot module replacement:

```bash
# Terminal 1: start the backend
npx tsx src/index.ts --redis redis://localhost:6379

# Terminal 2: start the Vite dev server (proxies /api to :3888)
cd ui && npx vite
```

The Vite dev server runs on port 5173 and proxies all `/api` requests to the backend on port 3888.

### Test Harness

The `test-env/` directory contains a full chaos testing environment with Docker Compose:

```bash
cd test-env
docker compose up --build
```

This starts:

- **Redis** on port 6379 (configured with `maxmemory 512mb`, `noeviction`, slowlog enabled)
- **Damasqas** on port 3888 (dashboard + API)
- **Test harness** on port 4000 (chaos control panel)

The harness provides 8 realistic queues with distinct processing profiles:

| Queue | Rate | Processing Time | Workers | Use Case |
|-------|------|-----------------|---------|----------|
| `email-send` | 120/min | 100–500ms | 3 × concurrency 5 | High-throughput transactional email |
| `webhook-deliver` | 60/min | 50ms–2s | 2 × concurrency 8 | External HTTP delivery with timeouts |
| `data-enrich` | 10/min | 2–10s | 1 × concurrency 3 | Slow third-party API calls |
| `pdf-generate` | 3/min | 5–30s | 1 × concurrency 1 | CPU-heavy document generation |
| `image-resize` | 200/min | 100–800ms | 2 × concurrency 10 | High-volume media processing |
| `payment-process` | 20/min | 300ms–1.5s | 2 × concurrency 3 | Financial transactions with retries |
| `scheduled-cleanup` | 5/min | 500ms–2s | 1 × concurrency 2 | Delayed/scheduled maintenance |
| `report-monthly` | idle | 10–30s | 1 × concurrency 1 | Flow parent for dependency testing |

Each queue has realistic weighted error distributions (SMTP timeouts, rate limits, card declines, etc.) with configurable failure injection and processing slowdown via the control panel.

**Chaos presets** trigger multi-queue failure scenarios: failure spike, cascade failure, backlog flood, system-wide slowdown, and mixed errors.

**Feature test scenarios** exercise specific Damasqas capabilities: flow + deadlock creation, overdue delayed job injection, Redis memory pressure, drain imbalance, event diversity with searchable payloads, job type diversity, and alert rule creation.

### Running Tests

```bash
# Unit tests
npm test

# Integration tests (requires Redis on localhost:6379 and a built dist/)
npm run build
cd test-env/integration
npm install
npm test
```

Integration tests cover: rule-based alerting with fire verification, comparative analytics, drain rate analysis, event capture and FTS search, flow tree building and deadlock detection, job type breakdown with timing analytics, overdue delayed job detection and promotion, and Redis health monitoring with OOM projection.

---

## License

[FSL-1.1-MIT](LICENSE.md) — Functional Source License, Version 1.1, MIT Future License.

Source-available with all non-competing uses permitted. Automatically converts to the MIT license on the second anniversary of each version's release date. See [LICENSE.md](LICENSE.md) for full terms.