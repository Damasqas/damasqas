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
} from './types.js';

const SCHEMA_VERSION = 2;

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

  // ── Snapshot Methods ─────────────────────────────────────────────────

  insertSnapshot(snapshot: QueueSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (
        queue, ts, waiting, active, completed, failed, delayed,
        locks, stalled, oldest_waiting_age, paused,
        prioritized, waiting_children, throughput_1m, fail_rate_1m, avg_process_ms, avg_wait_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  searchEvents(query: string, limit = 100): EventRecord[] {
    const rows = this.db.prepare(`
      SELECT e.* FROM events e
      JOIN events_fts fts ON e.id = fts.rowid
      WHERE events_fts MATCH ?
      ORDER BY e.ts DESC LIMIT ?
    `).all(query, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEvent(r));
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

  // ── Cleanup & Lifecycle ──────────────────────────────────────────────

  startCleanup(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    this.db.prepare('DELETE FROM snapshots WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM metrics WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM anomalies WHERE ts < ? AND resolved_at IS NOT NULL').run(cutoff);
    this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM alert_fires WHERE ts < ?').run(cutoff);
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
