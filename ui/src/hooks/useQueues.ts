import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
  processors: { locks: number; stalled: number };
  overdueDelayed: number;
  metrics: {
    throughput: number;
    failureRate: number;
    avgProcessingMs: number | null;
  } | null;
  oldestWaiting: { jobId: string | null; ageMs: number | null };
  anomalies: Array<{
    type: string;
    severity: string;
    multiplier: number;
    currentValue: number;
    baselineValue: number;
  }>;
}

export function useQueues() {
  return useQuery<{ queues: QueueState[] }>({
    queryKey: ['queues'],
    queryFn: () => fetch('/api/queues').then((r) => r.json()),
    refetchInterval: 5000,
  });
}

export function useQueue(name: string) {
  return useQuery<QueueState>({
    queryKey: ['queue', name],
    queryFn: () => fetch(`/api/queues/${encodeURIComponent(name)}`).then((r) => r.json()),
    refetchInterval: 3000,
  });
}

export function usePauseQueue(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`/api/queues/${encodeURIComponent(name)}/pause`, { method: 'POST' }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue', name] });
      qc.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}

export function useResumeQueue(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`/api/queues/${encodeURIComponent(name)}/resume`, { method: 'POST' }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue', name] });
      qc.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}

export function usePromoteAllOverdue(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`/api/queues/${encodeURIComponent(name)}/promote-all`, { method: 'POST' }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue', name] });
      qc.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}
