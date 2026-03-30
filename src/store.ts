import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  QueueSnapshot,
  QueueMetrics,
  AnomalyRecord,
  QueueRecord,
  EventRecord,
  ErrorGroupRecord,
  AlertRule,
  AlertFire,
  RedisSnapshot,
  RedisKeySize,
  SlowlogEntry,
  JobTimingRecord,
  JobTypeBreakdown,
} from './types.js';

const SCHEMA_VERSION = 6;

export class MetricsStore {
  private db: Database.Database;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private retentionMs: number;

  constructor(dataDir: string, retentionDays: number) {
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'data.db');
    this.db = new Database(dbPath);
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  // ── Schema Migration ─────────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
    `);

    const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    const currentVersion = row?.version ?? 0;

    if (currentVersion < 1) {
      this.migrateV1();
    }
    if (currentVersion < 2) {
      this.migrateV2();
    }
    if (currentVersion < 3) {
      this.migrateV3();
    }
    if (currentVersion < 4) {
      this.migrateV4();
    }
    if (currentVersion < 5) {
      this.migrateV5();
    }
    if (currentVersion < 6) {
      this.migrateV6();
    }

    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    } else if (currentVersion < SCHEMA_VERSION) {
      this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    }
  }

  /** V1: Original schema (snapshots, metrics, anomalies) */
  private migrateV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        ts INTEGER NOT NULL,
        waiting INTEGER NOT NULL,
        active INTEGER NOT NULL,
        completed INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        delayed INTEGER NOT NULL,
        locks INTEGER NOT NULL DEFAULT 0,
        stalled INTEGER NOT NULL DEFAULT 0,
        oldest_waiting_age INTEGER,
        paused INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_queue_ts ON snapshots(queue, ts);

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        ts INTEGER NOT NULL,
        throughput REAL,
        failure_rate REAL,
        avg_processing_ms REAL,
        backlog_growth REAL
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_queue_ts ON metrics(queue, ts);

      CREATE TABLE IF NOT EXISTS anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        current_value REAL,
        baseline_value REAL,
        multiplier REAL,
        resolved_at INTEGER,
        alert_sent INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_anomalies_queue ON anomalies(queue, ts);
    `);
  }

  /** V2: Extended schema — new columns on snapshots, new tables */
  private migrateV2(): void {
    // Add new columns to snapshots (safe with IF NOT EXISTS via try/catch for ALTER)
    const newCols = [
      ['prioritized', 'INTEGER NOT NULL DEFAULT 0'],
      ['waiting_children', 'INTEGER NOT NULL DEFAULT 0'],
      ['throughput_1m', 'REAL'],
      ['fail_rate_1m', 'REAL'],
      ['avg_process_ms', 'REAL'],
      ['avg_wait_ms', 'REAL'],
    ];
    for (const [col, def] of newCols) {
      try {
        this.db.exec(`ALTER TABLE snapshots ADD COLUMN ${col} ${def}`);
      } catch {
        // Column already exists — ignore
      }
    }

    // Queues table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queues (
        name TEXT PRIMARY KEY,
        prefix TEXT NOT NULL DEFAULT 'bull:',
        discovered_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
    `);

    // Events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        event_type TEXT NOT NULL,
        job_id TEXT NOT NULL,
        job_name TEXT,
        ts INTEGER NOT NULL,
        data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_queue_ts ON events(queue, ts);
      CREATE INDEX IF NOT EXISTS idx_events_job_id ON events(job_id);
      CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(event_type, ts);
    `);

    // FTS index for events
    // Virtual tables don't support IF NOT EXISTS in all SQLite versions,
    // so we check if it exists first
    const ftsExists = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='events_fts'",
    ).get();
    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE events_fts USING fts5(
          job_id, job_name, queue, event_type, data,
          content='events', content_rowid='id'
        );
      `);
    }

    // Error groups table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS error_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        signature TEXT NOT NULL,
        sample_error TEXT NOT NULL,
        sample_job_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        UNIQUE(queue, signature)
      );
    `);

    // Alert rules table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        queue TEXT,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        webhook_url TEXT,
        slack_webhook TEXT,
        discord_webhook TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        cooldown_seconds INTEGER NOT NULL DEFAULT 300,
        last_fired_at INTEGER
      );
    `);

    // Alert fires table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_fires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
      );
    `);
  }

  /** V3: Add overdue_delayed column to snapshots */
  private migrateV3(): void {
    try {
      this.db.exec(`ALTER TABLE snapshots ADD COLUMN overdue_delayed INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists — ignore
    }
  }

  /** V4: Redis health correlation tables */
  private migrateV4(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS redis_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        used_memory INTEGER NOT NULL,
        used_memory_peak INTEGER NOT NULL,
        maxmemory INTEGER NOT NULL,
        mem_fragmentation_ratio REAL,
        connected_clients INTEGER NOT NULL,
        ops_per_sec INTEGER NOT NULL,
        total_keys INTEGER NOT NULL,
        used_memory_rss INTEGER,
        maxmemory_policy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_redis_ts ON redis_snapshots(ts);

      CREATE TABLE IF NOT EXISTS redis_key_sizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        queue TEXT NOT NULL,
        key_type TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        memory_bytes INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_keysizes_queue_ts ON redis_key_sizes(queue, ts);

      CREATE TABLE IF NOT EXISTS slowlog_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        duration_us INTEGER NOT NULL,
        command TEXT NOT NULL,
        is_bullmq INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  /** V5: Stream cursor persistence + hydration index for event stream consumer */
  private migrateV5(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stream_cursors (
        queue TEXT PRIMARY KEY,
        last_stream_id TEXT NOT NULL
      );
    `);

    // Partial index for the hydration query (runs every 5s).
    // Without this, getUnhydratedEventJobIds does a full scan on events
    // WHERE queue = ? AND job_name IS NULL, which degrades as the table grows.
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_unhydrated
        ON events(queue, job_id) WHERE job_name IS NULL;
    `);
  }

  /** V6: Job type breakdown — timing data and per-type summaries */
  private migrateV6(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_timings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        job_name TEXT NOT NULL,
        job_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        wait_ms INTEGER NOT NULL,
        process_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timings_queue_name_ts ON job_timings(queue, job_name, ts);
      CREATE INDEX IF NOT EXISTS idx_timings_queue_jobid ON job_timings(queue, job_id);

      CREATE TABLE IF NOT EXISTS job_type_summaries (
        queue TEXT NOT NULL,
        job_name TEXT NOT NULL,
        minute_ts INTEGER NOT NULL,
        completed INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        avg_wait_ms REAL,
        avg_process_ms REAL,
        p95_process_ms REAL,
        PRIMARY KEY (queue, job_name, minute_ts)
      );
    `);
  }

  // ── Snapshot Methods ─────────────────────────────────────────────────

  insertSnapshot(snapshot: QueueSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (
        queue, ts, waiting, active, completed, failed, delayed,
        locks, stalled, oldest_waiting_age, paused,
        prioritized, waiting_children, throughput_1m, fail_rate_1m, avg_process_ms, avg_wait_ms,
        overdue_delayed
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.queue,
      snapshot.timestamp,
      snapshot.waiting,
      snapshot.active,
      snapshot.completed,
      snapshot.failed,
      snapshot.delayed,
      snapshot.locks,
      snapshot.stalledCount,
      snapshot.oldestWaitingAge,
      snapshot.paused ? 1 : 0,
      snapshot.prioritized,
      snapshot.waitingChildren,
      snapshot.throughput1m,
      snapshot.failRate1m,
      snapshot.avgProcessMs,
      snapshot.avgWaitMs,
      snapshot.overdueDelayed,
    );
  }

  getLatestSnapshot(queue: string): QueueSnapshot | null {
    const row = this.db.prepare(
      'SELECT * FROM snapshots WHERE queue = ? ORDER BY ts DESC LIMIT 1',
    ).get(queue) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToSnapshot(row);
  }

  getSnapshots(queue: string, since: number, until: number): QueueSnapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM snapshots WHERE queue = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC',
    ).all(queue, since, until) as Record<string, unknown>[];

    return rows.map((r) => this.rowToSnapshot(r));
  }

  getSnapshotsAggregated(queue: string, since: number, until: number, bucketMs: number): QueueSnapshot[] {
    const rows = this.db.prepare(`
      SELECT
        (ts / ?) * ? AS ts,
        AVG(waiting) AS waiting,
        AVG(active) AS active,
        AVG(completed) AS completed,
        AVG(failed) AS failed,
        AVG(delayed) AS delayed,
        MAX(locks) AS locks,
        MAX(stalled) AS stalled,
        MAX(overdue_delayed) AS overdue_delayed,
        MAX(oldest_waiting_age) AS oldest_waiting_age,
        MAX(paused) AS paused,
        AVG(prioritized) AS prioritized,
        AVG(waiting_children) AS waiting_children,
        AVG(throughput_1m) AS throughput_1m,
        AVG(fail_rate_1m) AS fail_rate_1m,
        AVG(avg_process_ms) AS avg_process_ms,
        AVG(avg_wait_ms) AS avg_wait_ms
      FROM snapshots
      WHERE queue = ? AND ts >= ? AND ts <= ?
      GROUP BY ts / ?
      ORDER BY ts ASC
    `).all(bucketMs, bucketMs, queue, since, until, bucketMs) as Record<string, unknown>[];

    return rows.map((r) => this.rowToSnapshot({ ...r, queue }));
  }

  hasData(queue: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM snapshots WHERE queue = ? LIMIT 1',
    ).get(queue) as unknown | undefined;

    return !!row;
  }

  // ── Metrics Methods ──────────────────────────────────────────────────

  insertMetrics(metrics: QueueMetrics): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (queue, ts, throughput, failure_rate, avg_processing_ms, backlog_growth)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      metrics.queue,
      metrics.timestamp,
      metrics.throughput,
      metrics.failureRate,
      metrics.avgProcessingMs,
      metrics.backlogGrowthRate,
    );
  }

  getMetrics(queue: string, since: number, until: number): QueueMetrics[] {
    const rows = this.db.prepare(
      'SELECT * FROM metrics WHERE queue = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC',
    ).all(queue, since, until) as Record<string, unknown>[];

    return rows.map((r) => ({
      queue: r.queue as string,
      timestamp: r.ts as number,
      throughput: r.throughput as number,
      failureRate: r.failure_rate as number,
      failureRatio: 0,
      avgProcessingMs: r.avg_processing_ms as number | null,
      backlogGrowthRate: r.backlog_growth as number,
    }));
  }

  getMetricsAggregated(queue: string, since: number, until: number, bucketMs: number): QueueMetrics[] {
    const rows = this.db.prepare(`
      SELECT
        (ts / ?) * ? AS ts,
        AVG(throughput) AS throughput,
        AVG(failure_rate) AS failure_rate,
        AVG(avg_processing_ms) AS avg_processing_ms,
        AVG(backlog_growth) AS backlog_growth
      FROM metrics
      WHERE queue = ? AND ts >= ? AND ts <= ?
      GROUP BY ts / ?
      ORDER BY ts ASC
    `).all(bucketMs, bucketMs, queue, since, until, bucketMs) as Record<string, unknown>[];

    return rows.map((r) => ({
      queue,
      timestamp: r.ts as number,
      throughput: r.throughput as number,
      failureRate: r.failure_rate as number,
      failureRatio: 0,
      avgProcessingMs: r.avg_processing_ms as number | null,
      backlogGrowthRate: r.backlog_growth as number,
    }));
  }

  getLatestMetrics(queue: string): QueueMetrics | null {
    const row = this.db.prepare(
      'SELECT * FROM metrics WHERE queue = ? ORDER BY ts DESC LIMIT 1',
    ).get(queue) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      queue: row.queue as string,
      timestamp: row.ts as number,
      throughput: row.throughput as number,
      failureRate: row.failure_rate as number,
      failureRatio: 0,
      avgProcessingMs: row.avg_processing_ms as number | null,
      backlogGrowthRate: row.backlog_growth as number,
    };
  }

  getRollingAverage(queue: string, field: 'throughput' | 'failure_rate' | 'avg_processing_ms' | 'backlog_growth', windowMs: number): number | null {
    const since = Date.now() - windowMs;
    const column = field;
    const row = this.db.prepare(
      `SELECT AVG(${column}) as avg FROM metrics WHERE queue = ? AND ts >= ? AND ${column} IS NOT NULL`,
    ).get(queue, since) as { avg: number | null } | undefined;

    return row?.avg ?? null;
  }

  getWaitingAverage(queue: string, windowMs: number): number | null {
    const since = Date.now() - windowMs;
    const row = this.db.prepare(
      'SELECT AVG(waiting) as avg FROM snapshots WHERE queue = ? AND ts >= ?',
    ).get(queue, since) as { avg: number | null } | undefined;

    return row?.avg ?? null;
  }

  // ── Anomaly Methods ──────────────────────────────────────────────────

  insertAnomaly(anomaly: AnomalyRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO anomalies (queue, ts, type, severity, current_value, baseline_value, multiplier, resolved_at, alert_sent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      anomaly.queue,
      anomaly.timestamp,
      anomaly.type,
      anomaly.severity,
      anomaly.currentValue,
      anomaly.baselineValue,
      anomaly.multiplier,
      anomaly.resolvedAt,
      anomaly.alertSent ? 1 : 0,
    );
    return Number(result.lastInsertRowid);
  }

  markAnomalyResolved(id: number, resolvedAt: number): void {
    this.db.prepare('UPDATE anomalies SET resolved_at = ? WHERE id = ?').run(resolvedAt, id);
  }

  markAlertSent(id: number): void {
    this.db.prepare('UPDATE anomalies SET alert_sent = 1 WHERE id = ?').run(id);
  }

  getActiveAnomalies(queue?: string): AnomalyRecord[] {
    let sql = 'SELECT * FROM anomalies WHERE resolved_at IS NULL';
    const params: unknown[] = [];

    if (queue) {
      sql += ' AND queue = ?';
      params.push(queue);
    }
    sql += ' ORDER BY ts DESC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAnomaly(r));
  }

  getAllAnomalies(queue?: string, limit = 100): AnomalyRecord[] {
    let sql = 'SELECT * FROM anomalies';
    const params: unknown[] = [];

    if (queue) {
      sql += ' WHERE queue = ?';
      params.push(queue);
    }
    sql += ' ORDER BY ts DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAnomaly(r));
  }

  getRecentAnomaly(queue: string, type: string, withinMs: number): AnomalyRecord | null {
    const since = Date.now() - withinMs;
    const row = this.db.prepare(
      'SELECT * FROM anomalies WHERE queue = ? AND type = ? AND ts >= ? ORDER BY ts DESC LIMIT 1',
    ).get(queue, type, since) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToAnomaly(row);
  }

  // ── Queue Registry Methods ───────────────────────────────────────────

  upsertQueue(name: string, prefix: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO queues (name, prefix, discovered_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(name, prefix, now, now);
  }

  markQueueSeen(name: string): void {
    this.db.prepare('UPDATE queues SET last_seen_at = ? WHERE name = ?').run(Date.now(), name);
  }

  getQueueRecords(): QueueRecord[] {
    const rows = this.db.prepare('SELECT * FROM queues ORDER BY name').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      name: r.name as string,
      prefix: r.prefix as string,
      discoveredAt: r.discovered_at as number,
      lastSeenAt: r.last_seen_at as number,
    }));
  }

  getStaleQueues(staleCutoffMs: number): QueueRecord[] {
    const cutoff = Date.now() - staleCutoffMs;
    const rows = this.db.prepare(
      'SELECT * FROM queues WHERE last_seen_at < ? ORDER BY name',
    ).all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => ({
      name: r.name as string,
      prefix: r.prefix as string,
      discoveredAt: r.discovered_at as number,
      lastSeenAt: r.last_seen_at as number,
    }));
  }

  // ── Event Methods ────────────────────────────────────────────────────

  insertEvent(event: EventRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO events (queue, event_type, job_id, job_name, ts, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      event.queue,
      event.eventType,
      event.jobId,
      event.jobName,
      event.ts,
      event.data,
    );
    const id = Number(result.lastInsertRowid);

    // Keep FTS index in sync
    this.db.prepare(`
      INSERT INTO events_fts (rowid, job_id, job_name, queue, event_type, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, event.jobId, event.jobName, event.queue, event.eventType, event.data);

    return id;
  }

  getEvents(queue: string, since: number, until: number, limit = 200): EventRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE queue = ? AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT ?',
    ).all(queue, since, until, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEvent(r));
  }

  getEventsByType(eventType: string, since: number, until: number, limit = 200): EventRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE event_type = ? AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT ?',
    ).all(eventType, since, until, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEvent(r));
  }

  getAllEvents(since: number, until: number, limit = 200, queue?: string, eventType?: string): EventRecord[] {
    let sql = 'SELECT * FROM events WHERE ts >= ? AND ts <= ?';
    const params: unknown[] = [since, until];

    if (queue) {
      sql += ' AND queue = ?';
      params.push(queue);
    }
    if (eventType) {
      sql += ' AND event_type = ?';
      params.push(eventType);
    }
    sql += ' ORDER BY ts DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  searchEvents(
    query: string,
    limit = 100,
    offset = 0,
    queue?: string,
    eventType?: string,
    from?: number,
    to?: number,
  ): { events: EventRecord[]; total: number } {
    let sql = `SELECT e.* FROM events e
      JOIN events_fts fts ON e.id = fts.rowid
      WHERE events_fts MATCH ?`;
    let countSql = `SELECT COUNT(*) as cnt FROM events e
      JOIN events_fts fts ON e.id = fts.rowid
      WHERE events_fts MATCH ?`;
    const params: unknown[] = [query];

    if (queue) {
      const clause = ' AND e.queue = ?';
      sql += clause;
      countSql += clause;
      params.push(queue);
    }
    if (eventType) {
      const clause = ' AND e.event_type = ?';
      sql += clause;
      countSql += clause;
      params.push(eventType);
    }
    if (from != null) {
      const clause = ' AND e.ts >= ?';
      sql += clause;
      countSql += clause;
      params.push(from);
    }
    if (to != null) {
      const clause = ' AND e.ts <= ?';
      sql += clause;
      countSql += clause;
      params.push(to);
    }

    const countRow = this.db.prepare(countSql).get(...params) as { cnt: number };

    sql += ' ORDER BY e.ts DESC LIMIT ? OFFSET ?';
    const rows = this.db.prepare(sql).all(...params, limit, offset) as Record<string, unknown>[];

    return {
      events: rows.map((r) => this.rowToEvent(r)),
      total: countRow.cnt,
    };
  }

  // ── Stream Cursor Methods ─────────────────────────────────────────────

  getStreamCursor(queue: string): string | null {
    const row = this.db.prepare(
      'SELECT last_stream_id FROM stream_cursors WHERE queue = ?',
    ).get(queue) as { last_stream_id: string } | undefined;
    return row?.last_stream_id ?? null;
  }

  setStreamCursor(queue: string, streamId: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO stream_cursors (queue, last_stream_id) VALUES (?, ?)',
    ).run(queue, streamId);
  }

  getAllStreamCursors(): Map<string, string> {
    const rows = this.db.prepare('SELECT queue, last_stream_id FROM stream_cursors').all() as {
      queue: string;
      last_stream_id: string;
    }[];
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.queue, row.last_stream_id);
    }
    return map;
  }

  // ── Event Hydration Methods ──────────────────────────────────────────

  getUnhydratedEventJobIds(queue: string, limit = 200): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT job_id FROM events WHERE queue = ? AND job_name IS NULL AND job_id != '' LIMIT ?",
    ).all(queue, limit) as { job_id: string }[];
    return rows.map((r) => r.job_id);
  }

  batchUpdateJobNames(updates: { queue: string; jobId: string; jobName: string; jobData?: string | null }[]): void {
    if (updates.length === 0) return;

    const selectStmt = this.db.prepare(
      'SELECT id, job_id, job_name, queue, event_type, data FROM events WHERE queue = ? AND job_id = ? AND job_name IS NULL',
    );
    const updateNameStmt = this.db.prepare(
      'UPDATE events SET job_name = ? WHERE queue = ? AND job_id = ? AND job_name IS NULL',
    );
    const updateRowStmt = this.db.prepare(
      'UPDATE events SET job_name = ?, data = ? WHERE id = ?',
    );
    const ftsDelete = this.db.prepare(
      "INSERT INTO events_fts (events_fts, rowid, job_id, job_name, queue, event_type, data) VALUES ('delete', ?, ?, ?, ?, ?, ?)",
    );
    const ftsInsert = this.db.prepare(
      'INSERT INTO events_fts (rowid, job_id, job_name, queue, event_type, data) VALUES (?, ?, ?, ?, ?, ?)',
    );

    const tx = this.db.transaction(() => {
      for (const { queue, jobId, jobName, jobData } of updates) {
        // Get affected rows for FTS sync before updating
        const rows = selectStmt.all(queue, jobId) as Record<string, unknown>[];

        if (jobData) {
          // Merge job payload into each event's data for FTS indexing.
          // Each event may have different event-specific data, so we
          // update per-row to preserve individual event fields.
          for (const row of rows) {
            const mergedData = this.mergeJobPayload(row.data as string | null, jobData);
            ftsDelete.run(row.id, row.job_id, row.job_name, row.queue, row.event_type, row.data);
            updateRowStmt.run(jobName, mergedData, row.id);
            ftsInsert.run(row.id, row.job_id, jobName, row.queue, row.event_type, mergedData);
          }
        } else {
          // No payload — bulk update job name
          updateNameStmt.run(jobName, queue, jobId);

          // Re-index FTS for affected rows
          for (const row of rows) {
            ftsDelete.run(row.id, row.job_id, row.job_name, row.queue, row.event_type, row.data);
            ftsInsert.run(row.id, row.job_id, jobName, row.queue, row.event_type, row.data);
          }
        }
      }
    });
    tx();
  }

  // ── Job Timing Methods ───────────────────────────────────────────────

  insertJobTiming(timing: JobTimingRecord): void {
    this.db.prepare(`
      INSERT INTO job_timings (queue, job_name, job_id, ts, wait_ms, process_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(timing.queue, timing.jobName, timing.jobId, timing.ts, timing.waitMs, timing.processMs);
  }

  batchInsertJobTimings(timings: JobTimingRecord[]): void {
    if (timings.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT INTO job_timings (queue, job_name, job_id, ts, wait_ms, process_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const t of timings) {
        stmt.run(t.queue, t.jobName, t.jobId, t.ts, t.waitMs, t.processMs);
      }
    });
    tx();
  }

  /**
   * Find completed events that haven't been timing-hydrated yet.
   * Uses LEFT JOIN against job_timings to find events without a matching row.
   * Bounded to the last hour since tiered event retention deletes completed
   * events after 1 hour anyway — no point scanning older data.
   */
  getUnhydratedTimingEvents(queue: string, limit = 200): { id: number; queue: string; jobId: string; jobName: string; ts: number }[] {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return this.db.prepare(`
      SELECT e.id, e.queue, e.job_id as jobId, e.job_name as jobName, e.ts
      FROM events e
      LEFT JOIN job_timings jt ON e.queue = jt.queue AND e.job_id = jt.job_id
      WHERE e.queue = ? AND e.event_type = 'completed' AND e.job_name IS NOT NULL AND e.ts >= ? AND jt.id IS NULL
      LIMIT ?
    `).all(queue, oneHourAgo, limit) as { id: number; queue: string; jobId: string; jobName: string; ts: number }[];
  }

  /**
   * Get per-job-type breakdown for a queue within a time range.
   * Combines failure rates from events table with timing stats from job_timings.
   */
  getJobTypeBreakdown(queue: string, since: number, until: number): JobTypeBreakdown[] {
    // Get failure rates from events table
    const eventRows = this.db.prepare(`
      SELECT
        job_name,
        COUNT(*) FILTER (WHERE event_type = 'completed') as completed,
        COUNT(*) FILTER (WHERE event_type = 'failed') as failed
      FROM events
      WHERE queue = ? AND ts >= ? AND ts <= ? AND event_type IN ('completed', 'failed') AND job_name IS NOT NULL
      GROUP BY job_name
      ORDER BY failed DESC
    `).all(queue, since, until) as { job_name: string; completed: number; failed: number }[];

    // Get timing averages from job_timings table.
    // Filter wait_ms >= 0 to exclude sentinel rows (-1) inserted when
    // the job hash was already deleted from Redis (removeOnComplete).
    const timingRows = this.db.prepare(`
      SELECT
        job_name,
        AVG(wait_ms) as avg_wait_ms,
        AVG(process_ms) as avg_process_ms
      FROM job_timings
      WHERE queue = ? AND ts >= ? AND ts <= ? AND wait_ms >= 0
      GROUP BY job_name
    `).all(queue, since, until) as { job_name: string; avg_wait_ms: number | null; avg_process_ms: number | null }[];

    const timingMap = new Map(timingRows.map((r) => [r.job_name, r]));

    // Compute p95 per job type (Option A: application code)
    const p95Map = new Map<string, number>();
    const jobNames = eventRows.map((r) => r.job_name);
    for (const jobName of jobNames) {
      const processTimes = this.db.prepare(
        'SELECT process_ms FROM job_timings WHERE queue = ? AND job_name = ? AND ts >= ? AND ts <= ? AND wait_ms >= 0 ORDER BY process_ms',
      ).all(queue, jobName, since, until) as { process_ms: number }[];
      if (processTimes.length > 0) {
        const idx = Math.floor(processTimes.length * 0.95);
        p95Map.set(jobName, processTimes[Math.min(idx, processTimes.length - 1)]!.process_ms);
      }
    }

    return eventRows.map((r) => {
      const total = r.completed + r.failed;
      const timing = timingMap.get(r.job_name);
      return {
        jobName: r.job_name,
        completed: r.completed,
        failed: r.failed,
        failRatePct: total > 0 ? Math.round(r.failed * 1000 / total) / 10 : 0,
        avgWaitMs: timing?.avg_wait_ms ? Math.round(timing.avg_wait_ms) : null,
        avgProcessMs: timing?.avg_process_ms ? Math.round(timing.avg_process_ms) : null,
        p95ProcessMs: p95Map.get(r.job_name) ?? null,
      };
    });
  }

  /**
   * Get per-job-type breakdown from pre-aggregated summaries (for longer time ranges).
   */
  getJobTypeBreakdownFromSummaries(queue: string, since: number, until: number): JobTypeBreakdown[] {
    const rows = this.db.prepare(`
      SELECT
        job_name,
        SUM(completed) as completed,
        SUM(failed) as failed,
        SUM(COALESCE(avg_wait_ms, 0) * completed) / NULLIF(SUM(CASE WHEN avg_wait_ms IS NOT NULL THEN completed ELSE 0 END), 0) as avg_wait_ms,
        SUM(COALESCE(avg_process_ms, 0) * completed) / NULLIF(SUM(CASE WHEN avg_process_ms IS NOT NULL THEN completed ELSE 0 END), 0) as avg_process_ms,
        MAX(p95_process_ms) as p95_process_ms
      FROM job_type_summaries
      WHERE queue = ? AND minute_ts >= ? AND minute_ts <= ?
      GROUP BY job_name
      ORDER BY failed DESC
    `).all(queue, since, until) as {
      job_name: string;
      completed: number;
      failed: number;
      avg_wait_ms: number | null;
      avg_process_ms: number | null;
      p95_process_ms: number | null;
    }[];

    return rows.map((r) => {
      const total = r.completed + r.failed;
      return {
        jobName: r.job_name,
        completed: r.completed,
        failed: r.failed,
        failRatePct: total > 0 ? Math.round(r.failed * 1000 / total) / 10 : 0,
        avgWaitMs: r.avg_wait_ms ? Math.round(r.avg_wait_ms) : null,
        avgProcessMs: r.avg_process_ms ? Math.round(r.avg_process_ms) : null,
        p95ProcessMs: r.p95_process_ms ? Math.round(r.p95_process_ms) : null,
      };
    });
  }

  /**
   * Aggregate raw job_timings + events into per-minute job_type_summaries.
   * Called every ~60 seconds by the collector.
   */
  aggregateJobTypeSummaries(since: number, until: number): void {
    // Get per-minute event counts
    const eventRows = this.db.prepare(`
      SELECT
        queue, job_name,
        (ts / 60000) * 60000 as minute_ts,
        COUNT(*) FILTER (WHERE event_type = 'completed') as completed,
        COUNT(*) FILTER (WHERE event_type = 'failed') as failed
      FROM events
      WHERE ts >= ? AND ts <= ? AND event_type IN ('completed', 'failed') AND job_name IS NOT NULL
      GROUP BY queue, job_name, minute_ts
    `).all(since, until) as {
      queue: string; job_name: string; minute_ts: number;
      completed: number; failed: number;
    }[];

    // Get per-minute timing averages (exclude sentinel rows from deleted hashes)
    const timingRows = this.db.prepare(`
      SELECT
        queue, job_name,
        (ts / 60000) * 60000 as minute_ts,
        AVG(wait_ms) as avg_wait_ms,
        AVG(process_ms) as avg_process_ms
      FROM job_timings
      WHERE ts >= ? AND ts <= ? AND wait_ms >= 0
      GROUP BY queue, job_name, minute_ts
    `).all(since, until) as {
      queue: string; job_name: string; minute_ts: number;
      avg_wait_ms: number | null; avg_process_ms: number | null;
    }[];

    // Build a nested lookup: timingLookup[queue][job_name][minute_ts] -> timing row
    const timingLookup = new Map<string, Map<string, Map<number, typeof timingRows[0]>>>();
    for (const r of timingRows) {
      if (!timingLookup.has(r.queue)) timingLookup.set(r.queue, new Map());
      const qMap = timingLookup.get(r.queue)!;
      if (!qMap.has(r.job_name)) qMap.set(r.job_name, new Map());
      qMap.get(r.job_name)!.set(r.minute_ts, r);
    }

    // Compute p95 per (queue, job_name, minute) bucket
    const p95Lookup = new Map<string, Map<string, Map<number, number>>>();
    const p95Stmt = this.db.prepare(
      'SELECT process_ms FROM job_timings WHERE queue = ? AND job_name = ? AND ts >= ? AND ts < ? AND wait_ms >= 0 ORDER BY process_ms',
    );

    // Deduplicate buckets to avoid redundant queries
    const seen = new Set<string>();
    for (const r of eventRows) {
      const bucketKey = JSON.stringify([r.queue, r.job_name, r.minute_ts]);
      if (seen.has(bucketKey)) continue;
      seen.add(bucketKey);

      const processTimes = p95Stmt.all(r.queue, r.job_name, r.minute_ts, r.minute_ts + 60000) as { process_ms: number }[];
      if (processTimes.length > 0) {
        const idx = Math.floor(processTimes.length * 0.95);
        const p95 = processTimes[Math.min(idx, processTimes.length - 1)]!.process_ms;
        if (!p95Lookup.has(r.queue)) p95Lookup.set(r.queue, new Map());
        const qMap = p95Lookup.get(r.queue)!;
        if (!qMap.has(r.job_name)) qMap.set(r.job_name, new Map());
        qMap.get(r.job_name)!.set(r.minute_ts, p95);
      }
    }

    const upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO job_type_summaries (queue, job_name, minute_ts, completed, failed, avg_wait_ms, avg_process_ms, p95_process_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const r of eventRows) {
        const timing = timingLookup.get(r.queue)?.get(r.job_name)?.get(r.minute_ts);
        const p95 = p95Lookup.get(r.queue)?.get(r.job_name)?.get(r.minute_ts);
        upsertStmt.run(
          r.queue, r.job_name, r.minute_ts,
          r.completed, r.failed,
          timing?.avg_wait_ms ?? null,
          timing?.avg_process_ms ?? null,
          p95 ?? null,
        );
      }
    });
    tx();
  }

  // ── Enhanced Event Query Methods ─────────────────────────────────────

  getEventsPage(
    since: number,
    until: number,
    limit: number,
    offset: number,
    queue?: string,
    eventType?: string,
    jobName?: string,
  ): { events: EventRecord[]; total: number } {
    let whereClauses = 'ts >= ? AND ts <= ?';
    const params: unknown[] = [since, until];

    if (queue) {
      whereClauses += ' AND queue = ?';
      params.push(queue);
    }
    if (eventType) {
      whereClauses += ' AND event_type = ?';
      params.push(eventType);
    }
    if (jobName) {
      whereClauses += ' AND job_name = ?';
      params.push(jobName);
    }

    const countRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM events WHERE ${whereClauses}`,
    ).get(...params) as { cnt: number };
    const total = countRow.cnt;

    const rows = this.db.prepare(
      `SELECT * FROM events WHERE ${whereClauses} ORDER BY ts DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return {
      events: rows.map((r) => this.rowToEvent(r)),
      total,
    };
  }

  // ── Error Group Methods ──────────────────────────────────────────────

  upsertErrorGroup(queue: string, signature: string, sampleError: string, sampleJobId: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO error_groups (queue, signature, sample_error, sample_job_id, count, first_seen, last_seen)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(queue, signature) DO UPDATE SET
        count = count + 1,
        last_seen = excluded.last_seen,
        sample_error = excluded.sample_error,
        sample_job_id = excluded.sample_job_id
    `).run(queue, signature, sampleError, sampleJobId, now, now);
  }

  getErrorGroupsByQueue(queue: string, limit = 50): ErrorGroupRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM error_groups WHERE queue = ? ORDER BY last_seen DESC LIMIT ?',
    ).all(queue, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToErrorGroup(r));
  }

  getAllErrorGroups(limit = 100): ErrorGroupRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM error_groups ORDER BY last_seen DESC LIMIT ?',
    ).all(limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToErrorGroup(r));
  }

  // ── Alert Rule Methods ───────────────────────────────────────────────

  insertAlertRule(rule: AlertRule): number {
    const result = this.db.prepare(`
      INSERT INTO alert_rules (name, queue, type, config, webhook_url, slack_webhook, discord_webhook, enabled, cooldown_seconds, last_fired_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rule.name,
      rule.queue,
      rule.type,
      rule.config,
      rule.webhookUrl,
      rule.slackWebhook,
      rule.discordWebhook,
      rule.enabled ? 1 : 0,
      rule.cooldownSeconds,
      rule.lastFiredAt,
    );
    return Number(result.lastInsertRowid);
  }

  getAlertRules(enabledOnly = false): AlertRule[] {
    const sql = enabledOnly
      ? 'SELECT * FROM alert_rules WHERE enabled = 1 ORDER BY id'
      : 'SELECT * FROM alert_rules ORDER BY id';
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToAlertRule(r));
  }

  getAlertRule(id: number): AlertRule | null {
    const row = this.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToAlertRule(row);
  }

  updateAlertRule(id: number, updates: Partial<AlertRule>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.queue !== undefined) { fields.push('queue = ?'); values.push(updates.queue); }
    if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.config !== undefined) { fields.push('config = ?'); values.push(updates.config); }
    if (updates.webhookUrl !== undefined) { fields.push('webhook_url = ?'); values.push(updates.webhookUrl); }
    if (updates.slackWebhook !== undefined) { fields.push('slack_webhook = ?'); values.push(updates.slackWebhook); }
    if (updates.discordWebhook !== undefined) { fields.push('discord_webhook = ?'); values.push(updates.discordWebhook); }
    if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
    if (updates.cooldownSeconds !== undefined) { fields.push('cooldown_seconds = ?'); values.push(updates.cooldownSeconds); }
    if (updates.lastFiredAt !== undefined) { fields.push('last_fired_at = ?'); values.push(updates.lastFiredAt); }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteAlertRule(id: number): void {
    this.db.prepare('DELETE FROM alert_fires WHERE rule_id = ?').run(id);
    this.db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
  }

  updateAlertRuleLastFired(ruleId: number, ts: number): void {
    this.db.prepare('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?').run(ts, ruleId);
  }

  // ── Alert Fire Methods ───────────────────────────────────────────────

  insertAlertFire(ruleId: number, payload: string): number {
    const result = this.db.prepare(`
      INSERT INTO alert_fires (rule_id, ts, payload) VALUES (?, ?, ?)
    `).run(ruleId, Date.now(), payload);
    return Number(result.lastInsertRowid);
  }

  getAlertFires(ruleId: number, limit = 50): AlertFire[] {
    const rows = this.db.prepare(
      'SELECT * FROM alert_fires WHERE rule_id = ? ORDER BY ts DESC LIMIT ?',
    ).all(ruleId, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as number,
      ruleId: r.rule_id as number,
      ts: r.ts as number,
      payload: r.payload as string,
    }));
  }

  getRecentAlertFires(limit = 100): AlertFire[] {
    const rows = this.db.prepare(
      'SELECT * FROM alert_fires ORDER BY ts DESC LIMIT ?',
    ).all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as number,
      ruleId: r.rule_id as number,
      ts: r.ts as number,
      payload: r.payload as string,
    }));
  }

  // ── Redis Snapshot Methods ────────────────────────────────────────────

  insertRedisSnapshot(snapshot: RedisSnapshot): void {
    this.db.prepare(`
      INSERT INTO redis_snapshots (
        ts, used_memory, used_memory_peak, maxmemory,
        mem_fragmentation_ratio, connected_clients, ops_per_sec, total_keys,
        used_memory_rss, maxmemory_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.ts,
      snapshot.usedMemory,
      snapshot.usedMemoryPeak,
      snapshot.maxmemory,
      snapshot.memFragmentationRatio,
      snapshot.connectedClients,
      snapshot.opsPerSec,
      snapshot.totalKeys,
      snapshot.usedMemoryRss,
      snapshot.maxmemoryPolicy,
    );
  }

  getLatestRedisSnapshot(): RedisSnapshot | null {
    const row = this.db.prepare(
      'SELECT * FROM redis_snapshots ORDER BY ts DESC LIMIT 1',
    ).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToRedisSnapshot(row);
  }

  getRedisSnapshots(since: number, until: number): RedisSnapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM redis_snapshots WHERE ts >= ? AND ts <= ? ORDER BY ts ASC',
    ).all(since, until) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRedisSnapshot(r));
  }

  getRedisSnapshotsAggregated(since: number, until: number, bucketMs: number): RedisSnapshot[] {
    const rows = this.db.prepare(`
      SELECT
        (ts / ?) * ? AS ts,
        AVG(used_memory) AS used_memory,
        MAX(used_memory_peak) AS used_memory_peak,
        MAX(maxmemory) AS maxmemory,
        AVG(mem_fragmentation_ratio) AS mem_fragmentation_ratio,
        AVG(connected_clients) AS connected_clients,
        AVG(ops_per_sec) AS ops_per_sec,
        AVG(total_keys) AS total_keys,
        AVG(used_memory_rss) AS used_memory_rss,
        MAX(maxmemory_policy) AS maxmemory_policy
      FROM redis_snapshots
      WHERE ts >= ? AND ts <= ?
      GROUP BY ts / ?
      ORDER BY ts ASC
    `).all(bucketMs, bucketMs, since, until, bucketMs) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRedisSnapshot(r));
  }

  getRecentRedisSnapshots(count: number): RedisSnapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM redis_snapshots ORDER BY ts DESC LIMIT ?',
    ).all(count) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRedisSnapshot(r)).reverse();
  }

  // ── Redis Key Size Methods ───────────────────────────────────────────

  insertRedisKeySizes(sizes: RedisKeySize[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO redis_key_sizes (ts, queue, key_type, entry_count, memory_bytes)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertAll = this.db.transaction(() => {
      for (const s of sizes) {
        stmt.run(s.ts, s.queue, s.keyType, s.entryCount, s.memoryBytes);
      }
    });
    insertAll();
  }

  getLatestKeySizes(): RedisKeySize[] {
    // Key sizes (entry counts) and memory usage are collected at different
    // cadences (5min vs 30min) and stored with different timestamps.
    // We merge: take the latest entry-count rows, then overlay the latest
    // memory-bytes data on top by matching (queue, key_type).

    // Latest entry-count rows (entry_count > 0)
    const entryTsRow = this.db.prepare(
      'SELECT MAX(ts) as max_ts FROM redis_key_sizes WHERE entry_count > 0',
    ).get() as { max_ts: number | null } | undefined;
    if (!entryTsRow?.max_ts) return [];

    const entryRows = this.db.prepare(
      'SELECT * FROM redis_key_sizes WHERE ts = ? AND entry_count > 0 ORDER BY entry_count DESC',
    ).all(entryTsRow.max_ts) as Record<string, unknown>[];

    const sizes = entryRows.map((r) => this.rowToRedisKeySize(r));

    // Latest memory-bytes rows (memory_bytes IS NOT NULL)
    const memTsRow = this.db.prepare(
      'SELECT MAX(ts) as max_ts FROM redis_key_sizes WHERE memory_bytes IS NOT NULL',
    ).get() as { max_ts: number | null } | undefined;

    if (memTsRow?.max_ts) {
      const memRows = this.db.prepare(
        'SELECT queue, key_type, memory_bytes FROM redis_key_sizes WHERE ts = ? AND memory_bytes IS NOT NULL',
      ).all(memTsRow.max_ts) as Record<string, unknown>[];

      // Overlay memory data onto entry-count rows
      const memMap = new Map<string, number>();
      for (const r of memRows) {
        memMap.set(`${r.queue}:${r.key_type}`, r.memory_bytes as number);
      }
      for (const s of sizes) {
        const mem = memMap.get(`${s.queue}:${s.keyType}`);
        if (mem !== undefined) s.memoryBytes = mem;
      }
    }

    return sizes;
  }

  getPreviousKeySizes(beforeTs: number): RedisKeySize[] {
    // Same merge strategy as getLatestKeySizes but looking before the given timestamp.
    const entryTsRow = this.db.prepare(
      'SELECT MAX(ts) as max_ts FROM redis_key_sizes WHERE ts < ? AND entry_count > 0',
    ).get(beforeTs) as { max_ts: number | null } | undefined;
    if (!entryTsRow?.max_ts) return [];

    const entryRows = this.db.prepare(
      'SELECT * FROM redis_key_sizes WHERE ts = ? AND entry_count > 0 ORDER BY entry_count DESC',
    ).all(entryTsRow.max_ts) as Record<string, unknown>[];

    const sizes = entryRows.map((r) => this.rowToRedisKeySize(r));

    // Overlay memory data from the latest memory collection before this point
    const memTsRow = this.db.prepare(
      'SELECT MAX(ts) as max_ts FROM redis_key_sizes WHERE ts < ? AND memory_bytes IS NOT NULL',
    ).get(beforeTs) as { max_ts: number | null } | undefined;

    if (memTsRow?.max_ts) {
      const memRows = this.db.prepare(
        'SELECT queue, key_type, memory_bytes FROM redis_key_sizes WHERE ts = ? AND memory_bytes IS NOT NULL',
      ).all(memTsRow.max_ts) as Record<string, unknown>[];

      const memMap = new Map<string, number>();
      for (const r of memRows) {
        memMap.set(`${r.queue}:${r.key_type}`, r.memory_bytes as number);
      }
      for (const s of sizes) {
        const mem = memMap.get(`${s.queue}:${s.keyType}`);
        if (mem !== undefined) s.memoryBytes = mem;
      }
    }

    return sizes;
  }

  getKeySizeHistory(queue: string, since: number, until: number): RedisKeySize[] {
    const rows = this.db.prepare(
      'SELECT * FROM redis_key_sizes WHERE queue = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC',
    ).all(queue, since, until) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRedisKeySize(r));
  }

  // ── Slowlog Methods ──────────────────────────────────────────────────

  insertSlowlogEntries(entries: SlowlogEntry[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO slowlog_entries (ts, duration_us, command, is_bullmq)
      VALUES (?, ?, ?, ?)
    `);
    const insertAll = this.db.transaction(() => {
      for (const e of entries) {
        stmt.run(e.ts, e.durationUs, e.command, e.isBullMQ ? 1 : 0);
      }
    });
    insertAll();
  }

  getSlowlogEntries(since: number, limit = 50): SlowlogEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM slowlog_entries WHERE ts >= ? ORDER BY ts DESC LIMIT ?',
    ).all(since, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      ts: r.ts as number,
      durationUs: r.duration_us as number,
      command: r.command as string,
      isBullMQ: (r.is_bullmq as number) === 1,
    }));
  }

  // ── Cleanup & Lifecycle ──────────────────────────────────────────────

  startCleanup(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;

    // Snapshots are collected at 1s intervals so they accumulate fast.
    // Downsample: keep 1-second resolution for the last 1 hour,
    // then only keep one snapshot per 10-second window for older data.
    // We find the IDs to KEEP first (one per 10s bucket per queue),
    // then delete everything else in that time range.
    const downsampleCutoff = Date.now() - 60 * 60 * 1000; // 1 hour ago

    // Step 1: Find the minimum id per (queue, 10-second-bucket) to keep
    const keepRows = this.db.prepare(`
      SELECT MIN(id) as keep_id FROM snapshots
      WHERE ts < ? AND ts >= ?
      GROUP BY queue, ts / 10000
    `).all(downsampleCutoff, cutoff) as { keep_id: number }[];

    if (keepRows.length > 0) {
      // Step 2: Build a set of IDs to keep and delete everything else
      // in that time range. Use batched DELETE to avoid huge IN clauses.
      const keepIds = new Set(keepRows.map((r) => r.keep_id));
      const allInRange = this.db.prepare(
        'SELECT id FROM snapshots WHERE ts < ? AND ts >= ?',
      ).all(downsampleCutoff, cutoff) as { id: number }[];

      const toDelete = allInRange.filter((r) => !keepIds.has(r.id)).map((r) => r.id);
      if (toDelete.length > 0) {
        const deleteStmt = this.db.prepare('DELETE FROM snapshots WHERE id = ?');
        const deleteTransaction = this.db.transaction(() => {
          for (const id of toDelete) {
            deleteStmt.run(id);
          }
        });
        deleteTransaction();
      }
    }

    // Then delete anything older than the retention window entirely
    this.db.prepare('DELETE FROM snapshots WHERE ts < ?').run(cutoff);

    this.db.prepare('DELETE FROM metrics WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM anomalies WHERE ts < ? AND resolved_at IS NOT NULL').run(cutoff);

    // ── Tiered event retention ──────────────────────────────────────────
    // Last 1 hour: full resolution (all events kept)
    // 1–24 hours: drop completed, active, added, waiting, progress events
    // 1–7 days: keep only failed and stalled events
    // 7+ days / beyond retention: delete everything
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const ftsDeleteStmt = this.db.prepare(
      "INSERT INTO events_fts (events_fts, rowid, job_id, job_name, queue, event_type, data) VALUES ('delete', ?, ?, ?, ?, ?, ?)",
    );
    const eventDeleteStmt = this.db.prepare('DELETE FROM events WHERE id = ?');

    const deleteEventsWithFts = (rows: Record<string, unknown>[]) => {
      if (rows.length === 0) return;
      const tx = this.db.transaction(() => {
        for (const row of rows) {
          ftsDeleteStmt.run(row.id, row.job_id, row.job_name, row.queue, row.event_type, row.data);
          eventDeleteStmt.run(row.id);
        }
      });
      tx();
    };

    // 1-24h: keep only failed, stalled, and error events (per spec).
    // BullMQ emits 'error' for queue-level errors (connection failures,
    // Lua script errors) — critical for incident debugging.
    const tier1Events = this.db.prepare(
      "SELECT id, job_id, job_name, queue, event_type, data FROM events WHERE ts < ? AND ts >= ? AND event_type NOT IN ('failed', 'stalled', 'error')",
    ).all(oneHourAgo, oneDayAgo) as Record<string, unknown>[];
    deleteEventsWithFts(tier1Events);

    // 1-7d: keep only failed and stalled events
    const tier2Events = this.db.prepare(
      "SELECT id, job_id, job_name, queue, event_type, data FROM events WHERE ts < ? AND ts >= ? AND event_type NOT IN ('failed', 'stalled')",
    ).all(oneDayAgo, sevenDaysAgo) as Record<string, unknown>[];
    deleteEventsWithFts(tier2Events);

    // 7+ days: delete all events (aggregated counts live in snapshots table)
    const oldEvents = this.db.prepare(
      'SELECT id, job_id, job_name, queue, event_type, data FROM events WHERE ts < ?',
    ).all(sevenDaysAgo) as Record<string, unknown>[];
    deleteEventsWithFts(oldEvents);

    this.db.prepare('DELETE FROM alert_fires WHERE ts < ?').run(cutoff);

    // Job timings: keep raw data for 24 hours only
    const timingCutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM job_timings WHERE ts < ?').run(timingCutoff);

    // Job type summaries: keep for full retention period
    this.db.prepare('DELETE FROM job_type_summaries WHERE minute_ts < ?').run(cutoff);

    // Redis health tables
    this.db.prepare('DELETE FROM redis_snapshots WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM redis_key_sizes WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM slowlog_entries WHERE ts < ?').run(cutoff);
  }

  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.db.close();
  }

  // ── Row Mappers ──────────────────────────────────────────────────────

  private rowToSnapshot(row: Record<string, unknown>): QueueSnapshot {
    return {
      queue: row.queue as string,
      timestamp: row.ts as number,
      waiting: row.waiting as number,
      active: row.active as number,
      completed: row.completed as number,
      failed: row.failed as number,
      delayed: row.delayed as number,
      prioritized: (row.prioritized as number) ?? 0,
      waitingChildren: (row.waiting_children as number) ?? 0,
      locks: row.locks as number,
      stalledCount: row.stalled as number,
      overdueDelayed: (row.overdue_delayed as number) ?? 0,
      oldestWaitingAge: row.oldest_waiting_age as number | null,
      paused: (row.paused as number) === 1,
      throughput1m: row.throughput_1m as number | null,
      failRate1m: row.fail_rate_1m as number | null,
      avgProcessMs: row.avg_process_ms as number | null,
      avgWaitMs: row.avg_wait_ms as number | null,
    };
  }

  private rowToAnomaly(row: Record<string, unknown>): AnomalyRecord {
    return {
      id: row.id as number,
      queue: row.queue as string,
      timestamp: row.ts as number,
      type: row.type as AnomalyRecord['type'],
      severity: row.severity as AnomalyRecord['severity'],
      currentValue: row.current_value as number,
      baselineValue: row.baseline_value as number,
      multiplier: row.multiplier as number,
      resolvedAt: row.resolved_at as number | null,
      alertSent: (row.alert_sent as number) === 1,
    };
  }

  private rowToEvent(row: Record<string, unknown>): EventRecord {
    return {
      id: row.id as number,
      queue: row.queue as string,
      eventType: row.event_type as string,
      jobId: row.job_id as string,
      jobName: row.job_name as string | null,
      ts: row.ts as number,
      data: row.data as string | null,
    };
  }

  /**
   * Merge a truncated job payload into the event's existing data JSON.
   * The payload is stored under the `_jobData` key so it becomes searchable
   * via FTS without clobbering the original event fields.
   *
   * Attempts to parse the payload JSON to avoid double-encoding (the Redis
   * `data` field is already JSON-stringified by BullMQ). Falls back to
   * storing as a string if parsing fails (e.g. truncated payload).
   */
  private mergeJobPayload(existingData: string | null, jobPayload: string): string {
    try {
      const parsed = existingData ? JSON.parse(existingData) : {};
      try {
        parsed._jobData = JSON.parse(jobPayload);
      } catch {
        // Payload may be truncated (500-char limit) producing invalid JSON.
        // Store as string — FTS tokenizer still extracts searchable terms.
        parsed._jobData = jobPayload;
      }
      return JSON.stringify(parsed);
    } catch {
      // If existing data isn't valid JSON, wrap both
      return JSON.stringify({ _raw: existingData, _jobData: jobPayload });
    }
  }

  private rowToErrorGroup(row: Record<string, unknown>): ErrorGroupRecord {
    return {
      id: row.id as number,
      queue: row.queue as string,
      signature: row.signature as string,
      sampleError: row.sample_error as string,
      sampleJobId: row.sample_job_id as string,
      count: row.count as number,
      firstSeen: row.first_seen as number,
      lastSeen: row.last_seen as number,
    };
  }

  private rowToRedisSnapshot(row: Record<string, unknown>): RedisSnapshot {
    return {
      ts: row.ts as number,
      usedMemory: row.used_memory as number,
      usedMemoryPeak: row.used_memory_peak as number,
      maxmemory: row.maxmemory as number,
      memFragmentationRatio: row.mem_fragmentation_ratio as number | null,
      connectedClients: row.connected_clients as number,
      opsPerSec: row.ops_per_sec as number,
      totalKeys: row.total_keys as number,
      usedMemoryRss: row.used_memory_rss as number | null,
      maxmemoryPolicy: row.maxmemory_policy as string | null,
    };
  }

  private rowToRedisKeySize(row: Record<string, unknown>): RedisKeySize {
    return {
      ts: row.ts as number,
      queue: row.queue as string,
      keyType: row.key_type as string,
      entryCount: row.entry_count as number,
      memoryBytes: row.memory_bytes as number | null,
    };
  }

  // ── Comparative Analytics Methods ─────────────────────────────────

  /**
   * Compare event-based metrics (completed, failed, fail rate, avg process time)
   * for the current hour vs the same hour yesterday and same hour last week.
   *
   * Current hour uses the events table (full resolution within 1h retention).
   * Yesterday and last week use pre-aggregated job_type_summaries since
   * completed events are pruned after 1 hour by tiered retention.
   */
  getEventComparison(queue: string): {
    current: { completed: number; failed: number; failRate: number | null; avgProcessMs: number | null };
    yesterday: { completed: number; failed: number; failRate: number | null; avgProcessMs: number | null } | null;
    lastWeek: { completed: number; failed: number; failRate: number | null; avgProcessMs: number | null } | null;
  } {
    const now = Date.now();
    const hourStart = now - (now % 3600000);
    const hourEnd = now;

    // Current hour: use events table (within 1h retention window)
    const currentRow = this.db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'completed') as completed,
        COUNT(*) FILTER (WHERE event_type = 'failed') as failed
      FROM events
      WHERE queue = ? AND ts BETWEEN ? AND ? AND event_type IN ('completed', 'failed')
    `).get(queue, hourStart, hourEnd) as { completed: number; failed: number } | undefined;

    // Current hour timing from job_timings (also within retention)
    const currentTimingRow = this.db.prepare(`
      SELECT AVG(process_ms) as avg_process_ms
      FROM job_timings
      WHERE queue = ? AND ts BETWEEN ? AND ? AND wait_ms >= 0
    `).get(queue, hourStart, hourEnd) as { avg_process_ms: number | null } | undefined;

    const buildResult = (completed: number, failed: number, avgProcessMs: number | null) => {
      const total = completed + failed;
      if (total === 0) return null;
      return {
        completed,
        failed,
        failRate: total > 0 ? Math.round(failed * 1000 / total) / 10 : null,
        avgProcessMs: avgProcessMs ? Math.round(avgProcessMs) : null,
      };
    };

    const current = buildResult(
      currentRow?.completed ?? 0,
      currentRow?.failed ?? 0,
      currentTimingRow?.avg_process_ms ?? null,
    ) ?? { completed: 0, failed: 0, failRate: null, avgProcessMs: null };

    // Yesterday & last week: use job_type_summaries (survives event pruning)
    const querySummaryPeriod = (since: number, until: number) => {
      const row = this.db.prepare(`
        SELECT
          SUM(completed) as completed,
          SUM(failed) as failed,
          SUM(COALESCE(avg_process_ms, 0) * completed) / NULLIF(SUM(CASE WHEN avg_process_ms IS NOT NULL THEN completed ELSE 0 END), 0) as avg_process_ms
        FROM job_type_summaries
        WHERE queue = ? AND minute_ts BETWEEN ? AND ?
      `).get(queue, since, until) as { completed: number | null; failed: number | null; avg_process_ms: number | null } | undefined;

      if (!row || ((row.completed ?? 0) === 0 && (row.failed ?? 0) === 0)) return null;
      return buildResult(row.completed ?? 0, row.failed ?? 0, row.avg_process_ms);
    };

    const yesterday = querySummaryPeriod(hourStart - 86400000, hourEnd - 86400000);
    const lastWeek = querySummaryPeriod(hourStart - 7 * 86400000, hourEnd - 7 * 86400000);

    return { current, yesterday, lastWeek };
  }

  /**
   * Compare snapshot-based metrics (queue depth, throughput, fail rate)
   * for the current latest snapshot vs the closest snapshot at the same time yesterday and last week.
   */
  getSnapshotComparison(queue: string): {
    current: { waiting: number; throughput: number | null; failRate: number | null; avgProcessMs: number | null } | null;
    yesterday: { waiting: number; throughput: number | null; failRate: number | null; avgProcessMs: number | null } | null;
    lastWeek: { waiting: number; throughput: number | null; failRate: number | null; avgProcessMs: number | null } | null;
  } {
    const mapRow = (row: Record<string, unknown> | undefined) => {
      if (!row) return null;
      return {
        waiting: row.waiting as number,
        throughput: row.throughput_1m as number | null,
        failRate: row.fail_rate_1m as number | null,
        avgProcessMs: row.avg_process_ms as number | null,
      };
    };

    // Get latest snapshot for this queue
    const currentRow = this.db.prepare(
      'SELECT * FROM snapshots WHERE queue = ? ORDER BY ts DESC LIMIT 1',
    ).get(queue) as Record<string, unknown> | undefined;

    if (!currentRow) return { current: null, yesterday: null, lastWeek: null };

    const currentTs = currentRow.ts as number;

    // Find closest snapshot at same time yesterday (within 30s window)
    const yesterdayRow = this.db.prepare(`
      SELECT * FROM snapshots
      WHERE queue = ? AND ts BETWEEN ? AND ?
      ORDER BY ABS(ts - ?) ASC
      LIMIT 1
    `).get(queue, currentTs - 86400000 - 30000, currentTs - 86400000 + 30000, currentTs - 86400000) as Record<string, unknown> | undefined;

    // Find closest snapshot at same time last week (within 30s window)
    const lastWeekRow = this.db.prepare(`
      SELECT * FROM snapshots
      WHERE queue = ? AND ts BETWEEN ? AND ?
      ORDER BY ABS(ts - ?) ASC
      LIMIT 1
    `).get(queue, currentTs - 7 * 86400000 - 30000, currentTs - 7 * 86400000 + 30000, currentTs - 7 * 86400000) as Record<string, unknown> | undefined;

    return {
      current: mapRow(currentRow),
      yesterday: mapRow(yesterdayRow),
      lastWeek: mapRow(lastWeekRow),
    };
  }

  /**
   * Get comparison data for all queues at once (for Overview page).
   * Returns snapshot-based comparison per queue.
   */
  getAllQueuesComparison(): Map<string, {
    current: { waiting: number; throughput: number | null; failRate: number | null };
    yesterday: { waiting: number; throughput: number | null; failRate: number | null } | null;
  }> {
    const result = new Map<string, {
      current: { waiting: number; throughput: number | null; failRate: number | null };
      yesterday: { waiting: number; throughput: number | null; failRate: number | null } | null;
    }>();

    // Get latest snapshot per queue
    const latestRows = this.db.prepare(`
      SELECT s.* FROM snapshots s
      INNER JOIN (SELECT queue, MAX(ts) as max_ts FROM snapshots GROUP BY queue) latest
        ON s.queue = latest.queue AND s.ts = latest.max_ts
    `).all() as Record<string, unknown>[];

    for (const row of latestRows) {
      const queue = row.queue as string;
      const currentTs = row.ts as number;

      const yesterdayRow = this.db.prepare(`
        SELECT waiting, throughput_1m, fail_rate_1m FROM snapshots
        WHERE queue = ? AND ts BETWEEN ? AND ?
        ORDER BY ABS(ts - ?) ASC
        LIMIT 1
      `).get(queue, currentTs - 86400000 - 30000, currentTs - 86400000 + 30000, currentTs - 86400000) as Record<string, unknown> | undefined;

      result.set(queue, {
        current: {
          waiting: row.waiting as number,
          throughput: row.throughput_1m as number | null,
          failRate: row.fail_rate_1m as number | null,
        },
        yesterday: yesterdayRow ? {
          waiting: yesterdayRow.waiting as number,
          throughput: yesterdayRow.throughput_1m as number | null,
          failRate: yesterdayRow.fail_rate_1m as number | null,
        } : null,
      });
    }

    return result;
  }

  private rowToAlertRule(row: Record<string, unknown>): AlertRule {
    return {
      id: row.id as number,
      name: row.name as string,
      queue: row.queue as string | null,
      type: row.type as AlertRule['type'],
      config: row.config as string,
      webhookUrl: row.webhook_url as string | null,
      slackWebhook: row.slack_webhook as string | null,
      discordWebhook: row.discord_webhook as string | null,
      enabled: (row.enabled as number) === 1,
      cooldownSeconds: row.cooldown_seconds as number,
      lastFiredAt: row.last_fired_at as number | null,
    };
  }
}
