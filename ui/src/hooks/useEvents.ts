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
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  queue?: string;
  type?: string;
  jobName?: string;
}

export function useEvents(params: EventsParams) {
  const qs = new URLSearchParams();
  if (params.since) qs.set('since', String(params.since));
  if (params.until) qs.set('until', String(params.until));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.queue) qs.set('queue', params.queue);
  if (params.type) qs.set('type', params.type);
  if (params.jobName) qs.set('job_name', params.jobName);

  return useQuery<EventsResponse>({
    queryKey: ['events', params],
    queryFn: () => fetch(`/api/events?${qs.toString()}`).then((r) => r.json()),
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
