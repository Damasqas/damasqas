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
  anomalies: AnomalyRecord[];
}
