import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface JobDetail {
  id: string;
  name: string;
  data: string;
  opts: string;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  failedReason: string | null;
  stacktrace: string | null;
  returnvalue: string | null;
  attemptsMade: number;
  delay: number;
  priority: number;
}

export interface ErrorGroup {
  reason: string;
  count: number;
  jobIds: string[];
}

export function useJobs(
  queue: string,
  status: string = 'failed',
  limit = 20,
  offset = 0,
) {
  return useQuery<{ jobs: JobDetail[] }>({
    queryKey: ['jobs', queue, status, limit, offset],
    queryFn: () =>
      fetch(
        `/api/queues/${encodeURIComponent(queue)}/jobs?status=${status}&limit=${limit}&offset=${offset}`,
      ).then((r) => r.json()),
    refetchInterval: 10000,
  });
}

export function useErrorGroups(queue: string) {
  return useQuery<{ groups: ErrorGroup[] }>({
    queryKey: ['errors', queue],
    queryFn: () =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/errors`).then((r) => r.json()),
    refetchInterval: 10000,
  });
}

export function useRetryJob(queue: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/jobs/${jobId}/retry`, {
        method: 'POST',
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', queue] });
      qc.invalidateQueries({ queryKey: ['errors', queue] });
    },
  });
}

export function useRemoveJob(queue: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/jobs/${jobId}/remove`, {
        method: 'POST',
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', queue] });
      qc.invalidateQueries({ queryKey: ['errors', queue] });
    },
  });
}

export function useRetryAll(queue: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/retry-all`, {
        method: 'POST',
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', queue] });
      qc.invalidateQueries({ queryKey: ['errors', queue] });
      qc.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}
