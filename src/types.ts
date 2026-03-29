export interface QueueSnapshot {
  queue: string;
  timestamp: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  locks: number;
  stalledCount: number;
  oldestWaitingAge: number | null;
  paused: boolean;
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
