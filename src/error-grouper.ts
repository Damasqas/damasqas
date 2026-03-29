import type { QueueAdapter } from './adapters/types.js';
import type { ErrorGroup } from './types.js';

export async function getErrorGroups(
  adapter: QueueAdapter,
  queue: string,
  windowMs = 5 * 60 * 1000,
  limit = 500,
): Promise<ErrorGroup[]> {
  const since = Date.now() - windowMs;
  return adapter.getErrorGroups(queue, since, limit);
}
