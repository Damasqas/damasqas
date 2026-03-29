import type {
  QueueSnapshot,
  FailedJob,
  JobDetail,
  ErrorGroup,
} from '../types.js';

export interface QueueAdapter {
  discoverQueues(): Promise<string[]>;

  getSnapshot(queue: string): Promise<QueueSnapshot>;

  getRecentFailed(
    queue: string,
    since: number,
    limit: number,
  ): Promise<FailedJob[]>;

  getJobDetail(queue: string, jobId: string): Promise<JobDetail | null>;

  getActiveLocks(queue: string): Promise<string[]>;

  getStalledJobs(queue: string): Promise<string[]>;

  getErrorGroups(
    queue: string,
    since: number,
    limit: number,
  ): Promise<ErrorGroup[]>;

  getJobsByStatus(
    queue: string,
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    limit: number,
    offset: number,
  ): Promise<JobDetail[]>;

  getCompletedCountSince(queue: string, since: number): Promise<number>;
  getFailedCountSince(queue: string, since: number): Promise<number>;

  getRecentProcessingTimes(
    queue: string,
    limit: number,
  ): Promise<number[]>;

  // Write operations
  pauseQueue(queue: string): Promise<void>;
  resumeQueue(queue: string): Promise<void>;
  retryJob(queue: string, jobId: string): Promise<void>;
  removeJob(queue: string, jobId: string): Promise<void>;
  promoteJob(queue: string, jobId: string): Promise<void>;
  cleanJobs(
    queue: string,
    status: 'completed' | 'failed',
    grace: number,
    limit: number,
  ): Promise<number>;
  retryAllFailed(queue: string): Promise<number>;

  // Lifecycle
  disconnect(): Promise<void>;
}
