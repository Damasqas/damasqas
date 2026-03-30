import { useQuery } from '@tanstack/react-query';

export interface EventRecord {
  id: number;
  queue: string;
  eventType: string;
  jobId: string;
  jobName: string | null;
  ts: number;
  data: string | null;
}

export interface EventsResponse {
  events: EventRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface EventsParams {
  /** Time range in ms — since is computed fresh at fetch time as Date.now() - rangeMs */
  rangeMs: number;
  limit?: number;
  offset?: number;
  queue?: string;
  type?: string;
  jobName?: string;
}

/**
 * Fetches paginated events with a sliding time window.
 *
 * IMPORTANT: `since` is computed inside the queryFn (not memoized in the
 * component) so that refetchInterval always uses a fresh window.
 * The queryKey is based on the stable rangeMs value, not a timestamp,
 * so React Query correctly deduplicates and refetches the same entry.
 */
export function useEvents(params: EventsParams) {
  return useQuery<EventsResponse>({
    queryKey: ['events', params.rangeMs, params.limit, params.offset, params.queue, params.type, params.jobName],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('since', String(Date.now() - params.rangeMs));
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      if (params.queue) qs.set('queue', params.queue);
      if (params.type) qs.set('type', params.type);
      if (params.jobName) qs.set('job_name', params.jobName);
      return fetch(`/api/events?${qs.toString()}`).then((r) => r.json());
    },
    refetchInterval: 5000,
  });
}

export function useEventSearch(query: string, limit = 100) {
  return useQuery<{ events: EventRecord[] }>({
    queryKey: ['events-search', query, limit],
    queryFn: () =>
      fetch(`/api/events/search?q=${encodeURIComponent(query)}&limit=${limit}`).then((r) =>
        r.json(),
      ),
    enabled: query.length > 0,
  });
}
