import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { QueueSnapshot, QueueMetrics, AnomalyRecord } from './types.js';

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
    this.initSchema();
  }

  private initSchema(): void {
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
        locks INTEGER NOT NULL,
        stalled INTEGER NOT NULL,
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

  insertSnapshot(snapshot: QueueSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (queue, ts, waiting, active, completed, failed, delayed, locks, stalled, oldest_waiting_age, paused)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );
  }

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

  getSnapshotsDownsampled(queue: string, since: number, until: number, bucketMs: number): QueueSnapshot[] {
    const rows = this.db.prepare(`
      SELECT s.*
      FROM snapshots s
      INNER JOIN (
        SELECT MAX(id) as id
        FROM snapshots
        WHERE queue = ? AND ts >= ? AND ts <= ?
        GROUP BY ts / ?
      ) latest ON s.id = latest.id
      ORDER BY s.ts ASC
    `).all(queue, since, until, bucketMs) as Record<string, unknown>[];

    return rows.map((r) => this.rowToSnapshot(r));
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

  getMetricsDownsampled(queue: string, since: number, until: number, bucketMs: number): QueueMetrics[] {
    const rows = this.db.prepare(`
      SELECT
        queue,
        (ts / ?) * ? as ts,
        AVG(throughput) as throughput,
        AVG(failure_rate) as failure_rate,
        AVG(avg_processing_ms) as avg_processing_ms,
        AVG(backlog_growth) as backlog_growth
      FROM metrics
      WHERE queue = ? AND ts >= ? AND ts <= ?
      GROUP BY queue, ts / ?
      ORDER BY ts ASC
    `).all(bucketMs, bucketMs, queue, since, until, bucketMs) as Record<string, unknown>[];

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

  hasData(queue: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM snapshots WHERE queue = ? LIMIT 1',
    ).get(queue) as unknown | undefined;

    return !!row;
  }

  startCleanup(): void {
    // Run cleanup every hour
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    // Also run immediately
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    this.db.prepare('DELETE FROM snapshots WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM metrics WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM anomalies WHERE ts < ? AND resolved_at IS NOT NULL').run(cutoff);
  }

  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.db.close();
  }

  private rowToSnapshot(row: Record<string, unknown>): QueueSnapshot {
    return {
      queue: row.queue as string,
      timestamp: row.ts as number,
      waiting: row.waiting as number,
      active: row.active as number,
      completed: row.completed as number,
      failed: row.failed as number,
      delayed: row.delayed as number,
      locks: row.locks as number,
      stalledCount: row.stalled as number,
      oldestWaitingAge: row.oldest_waiting_age as number | null,
      paused: (row.paused as number) === 1,
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
}
