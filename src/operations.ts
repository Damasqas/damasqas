import type { QueueAdapter } from './adapters/types.js';

export class Operations {
  private adapter: QueueAdapter;

  constructor(adapter: QueueAdapter) {
    this.adapter = adapter;
  }

  async pause(queue: string): Promise<void> {
    await this.adapter.pauseQueue(queue);
  }

  async resume(queue: string): Promise<void> {
    await this.adapter.resumeQueue(queue);
  }

  async retryJob(queue: string, jobId: string): Promise<void> {
    await this.adapter.retryJob(queue, jobId);
  }

  async removeJob(queue: string, jobId: string): Promise<void> {
    await this.adapter.removeJob(queue, jobId);
  }

  async promoteJob(queue: string, jobId: string): Promise<void> {
    await this.adapter.promoteJob(queue, jobId);
  }

  async clean(
    queue: string,
    status: 'completed' | 'failed',
    grace: number,
    limit: number,
  ): Promise<number> {
    return this.adapter.cleanJobs(queue, status, grace, limit);
  }

  async retryAll(queue: string): Promise<number> {
    return this.adapter.retryAllFailed(queue);
  }

  async promoteAllOverdue(queue: string): Promise<number> {
    return this.adapter.promoteAllOverdue(queue);
  }
}
