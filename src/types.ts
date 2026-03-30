export interface QueueSnapshot {
  queue: string;
  timestamp: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  prioritized: number;
  waitingChildren: number;
  locks: number;
  stalledCount: number;
  overdueDelayed: number;
  oldestWaitingAge: number | null;
  paused: boolean;
  throughput1m: number | null;
  failRate1m: number | null;
  avgProcessMs: number | null;
  avgWaitMs: number | null;
}

export interface QueueMetrics {
  queue: string;
  timestamp: number;
  throughput: number;
  failureRate: number;
  failureRatio: number;
  avgProcessingMs: number | null;
  backlogGrowthRate: number;
}

export interface QueueRecord {
  name: string;
  prefix: string;
  discoveredAt: number;
  lastSeenAt: number;
}

export interface EventRecord {
  id?: number;
  queue: string;
  eventType: string;
  jobId: string;
  jobName: string | null;
  ts: number;
  data: string | null;
}

export interface ErrorGroupRecord {
  id?: number;
  queue: string;
  signature: string;
  sampleError: string;
  sampleJobId: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export type AlertRuleType =
  | 'failure_spike'
  | 'depth_threshold'
  | 'overdue_delayed'
  | 'orphaned_active'
  | 'redis_memory'
  | 'drain_negative';

export interface AlertRule {
  id?: number;
  name: string;
  queue: string | null;
  type: AlertRuleType;
  config: string;
  webhookUrl: string | null;
  slackWebhook: string | null;
  discordWebhook: string | null;
  enabled: boolean;
  cooldownSeconds: number;
  lastFiredAt: number | null;
}

export interface AlertFire {
  id?: number;
  ruleId: number;
  ts: number;
  payload: string;
}

export interface FailedJob {
  id: string;
  name: string;
  failedReason: string;
  timestamp: number;
  finishedOn: number | null;
  attemptsMade: number;
  data: string;
}

export interface JobDetail {
  id: string;
  name: string;
  data: string;
  opts: string;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  failedReason: string | null;
  stacktrace: string | null;
  returnvalue: string | null;
  attemptsMade: number;
  delay: number;
  priority: number;
}

export interface ErrorGroup {
  reason: string;
  count: number;
  jobIds: string[];
}

export type AnomalyType =
  | 'failure_spike'
  | 'backlog_growth'
  | 'processing_slow'
  | 'stalled_job'
  | 'overdue_delayed'
  | 'queue_idle'
  | 'oldest_waiting';

export type AnomalySeverity = 'critical' | 'warning' | 'info';

export interface AnomalyRecord {
  id?: number;
  queue: string;
  timestamp: number;
  type: AnomalyType;
  severity: AnomalySeverity;
  currentValue: number;
  baselineValue: number;
  multiplier: number;
  resolvedAt: number | null;
  alertSent: boolean;
}

export interface AlertPayload {
  queue: string;
  anomaly: AnomalyRecord;
  snapshot: QueueSnapshot;
  metrics: QueueMetrics | null;
  topErrors: ErrorGroup[];
}

export interface DamasqasConfig {
  redis: string;
  port: number;
  prefix: string;
  pollInterval: number;
  discoveryInterval: number;
  retentionDays: number;
  slackWebhook: string | null;
  discordWebhook: string | null;
  cooldown: number;
  failureThreshold: number;
  backlogThreshold: number;
  stallAlert: boolean;
  redisKeyMemoryUsage: boolean;
  apiKey: string | null;
  noDashboard: boolean;
  verbose: boolean;
  dataDir: string;
}

export interface QueueState {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  paused: boolean;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    prioritized: number;
    waitingChildren: number;
  };
  processors: {
    locks: number;
    stalled: number;
  };
  metrics: {
    throughput: number;
    failureRate: number;
    avgProcessingMs: number | null;
  } | null;
  oldestWaiting: {
    jobId: string | null;
    ageMs: number | null;
  };
  overdueDelayed: number;
  anomalies: AnomalyRecord[];
  drain: DrainAnalysis | null;
}

export interface DrainAnalysis {
  queue: string;
  currentDepth: number;
  depthDelta: number;           // change since last snapshot (positive = growing)
  inflowRate: number;           // jobs entering wait per minute
  drainRate: number;            // jobs leaving wait per minute (= throughput)
  netRate: number;              // drainRate - inflowRate (positive = draining)
  projectedDrainMinutes: number | null;  // null if netRate <= 0 (will never drain)
  capacityDeficit: number;      // percentage more processing capacity needed (0 if draining)
  trend: 'draining' | 'stable' | 'growing' | 'stalled';
}

export interface OverdueDelayedJob {
  id: string;
  name: string;
  delay: number;
  timestamp: number;
  scheduledFor: number;
  overdueByMs: number;
}

// ── Redis Health Types ────────────────────────────────────────────────

export interface RedisSnapshot {
  ts: number;
  usedMemory: number;
  usedMemoryPeak: number;
  maxmemory: number;
  memFragmentationRatio: number | null;
  connectedClients: number;
  opsPerSec: number;
  totalKeys: number;
  usedMemoryRss: number | null;
  maxmemoryPolicy: string | null;
}

export interface RedisKeySize {
  ts: number;
  queue: string;
  keyType: string;
  entryCount: number;
  memoryBytes: number | null;
}

export interface SlowlogEntry {
  slowlogId?: number;  // Redis slowlog unique ID (monotonically increasing), used for dedup
  ts: number;
  durationUs: number;
  command: string;
  isBullMQ: boolean;
}

export interface OOMProjection {
  hoursUntilOOM: number | null;
  growthRateMBPerHour: number;
}

export interface KeyGrowth {
  queue: string;
  keyType: string;
  entries: number;
  entryDelta: number;
  memoryBytes: number | null;
  memoryDelta: number | null;
  recommendation: string | null;
}

// ── Job Type Breakdown Types ─────────────────────────────────────────

export interface JobTimingRecord {
  id?: number;
  queue: string;
  jobName: string;
  jobId: string;
  ts: number;
  waitMs: number;
  processMs: number;
}

export interface JobTypeSummary {
  queue: string;
  jobName: string;
  minuteTs: number;
  completed: number;
  failed: number;
  avgWaitMs: number | null;
  avgProcessMs: number | null;
  p95ProcessMs: number | null;
}

export interface JobTypeBreakdown {
  jobName: string;
  completed: number;
  failed: number;
  failRatePct: number;
  avgWaitMs: number | null;
  avgProcessMs: number | null;
  p95ProcessMs: number | null;
}
