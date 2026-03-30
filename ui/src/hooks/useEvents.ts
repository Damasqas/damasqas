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

export interface SearchParams {
  query: string;
  limit?: number;
  offset?: number;
  queue?: string;
  type?: string;
  /** Time range in ms — from/to are computed fresh at fetch time as Date.now() - rangeMs */
  rangeMs?: number;
}

/**
 * Full-text search events with optional filters.
 *
 * IMPORTANT: `from`/`to` are computed inside the queryFn (not in the
 * queryKey) so that Date.now() is evaluated at fetch time, matching
 * the same pattern as useEvents. Using rangeMs in the queryKey keeps
 * it stable across renders and prevents cache thrashing.
 */
export function useEventSearch(params: SearchParams) {
  return useQuery<EventsResponse>({
    queryKey: ['events-search', params.query, params.limit, params.offset, params.queue, params.type, params.rangeMs],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('q', params.query);
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      if (params.queue) qs.set('queue', params.queue);
      if (params.type) qs.set('type', params.type);
      if (params.rangeMs != null) {
        qs.set('from', String(Date.now() - params.rangeMs));
        qs.set('to', String(Date.now()));
      }
      return fetch(`/api/events/search?${qs.toString()}`).then((r) => r.json());
    },
    enabled: params.query.length > 0,
  });
}
