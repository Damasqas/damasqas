import { useQuery } from '@tanstack/react-query';

export interface Snapshot {
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

export interface Metric {
  queue: string;
  timestamp: number;
  throughput: number;
  failureRate: number;
  failureRatio: number;
  avgProcessingMs: number | null;
  backlogGrowthRate: number;
}

export function useMetrics(queue: string, range: '1h' | '6h' | '24h' | '7d' = '1h') {
  return useQuery<{ snapshots: Snapshot[]; metrics: Metric[] }>({
    queryKey: ['metrics', queue, range],
    queryFn: () =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/metrics?range=${range}`).then((r) =>
        r.json(),
      ),
    refetchInterval: 10000,
  });
}
