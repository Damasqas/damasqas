import type { QueueAdapter } from './adapters/types.js';

export interface StallResult {
  queue: string;
  stalledJobIds: string[];
}

export async function detectStalls(
  adapter: QueueAdapter,
  queues: string[],
): Promise<StallResult[]> {
  const results: StallResult[] = [];

  for (const queue of queues) {
    try {
      const stalledJobIds = await adapter.getStalledJobs(queue);
      if (stalledJobIds.length > 0) {
        results.push({ queue, stalledJobIds });
      }
    } catch (err) {
      console.error(`[stall-detector] Error checking ${queue}:`, err);
    }
  }

  return results;
}
