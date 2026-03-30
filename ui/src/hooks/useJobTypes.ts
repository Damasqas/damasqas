import { useQuery } from '@tanstack/react-query';

export interface JobTypeBreakdown {
  jobName: string;
  completed: number;
  failed: number;
  failRatePct: number;
  avgWaitMs: number | null;
  avgProcessMs: number | null;
  p95ProcessMs: number | null;
}

export function useJobTypes(queue: string, range: '1h' | '6h' | '24h' | '7d' = '1h') {
  return useQuery<{ breakdown: JobTypeBreakdown[]; since: number; until: number }>({
    queryKey: ['job-types', queue, range],
    queryFn: () =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/job-types?range=${range}`).then((r) =>
        r.json(),
      ),
    refetchInterval: 10000,
  });
}
