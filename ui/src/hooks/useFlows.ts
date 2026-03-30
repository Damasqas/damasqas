import { useQuery } from '@tanstack/react-query';

export type FlowJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'waiting-children'
  | 'unknown';

export interface FlowNode {
  jobId: string;
  queue: string;
  name: string;
  state: FlowJobState;
  failedReason?: string;
  attemptsMade: number;
  maxAttempts: number;
  children: FlowNode[];
  isBlocker: boolean;
  isDeadlocked: boolean;
  truncated?: boolean;
}

export interface Deadlock {
  parentQueue: string;
  parentJobId: string;
  parentName: string;
  childQueue: string;
  childJobId: string;
  childName: string;
  childError: string;
  blockedSince: number;
  hasFailParentOnFailure: boolean;
}

export interface WaitingChildrenJob {
  queue: string;
  jobId: string;
  name: string;
  timestamp: number;
  pendingChildren: number;
  failedChildren: number;
  completedChildren: number;
}

export function useDeadlocks() {
  return useQuery<{ deadlocks: Deadlock[]; scannedAt: number }>({
    queryKey: ['flow-deadlocks'],
    queryFn: () => fetch('/api/flows/deadlocks').then((r) => r.json()),
    refetchInterval: 30000,
  });
}

export function useFlowTree(queue: string | null, jobId: string | null) {
  return useQuery<{ tree: FlowNode }>({
    queryKey: ['flow-tree', queue, jobId],
    queryFn: () =>
      fetch(
        `/api/flows/tree/${encodeURIComponent(queue!)}/${encodeURIComponent(jobId!)}`,
      ).then((r) => r.json()),
    enabled: !!queue && !!jobId,
    staleTime: 10000,
  });
}

export function useWaitingChildren(queue?: string) {
  const params = queue ? `?queue=${encodeURIComponent(queue)}` : '';
  return useQuery<{ jobs: WaitingChildrenJob[] }>({
    queryKey: ['flow-waiting-children', queue],
    queryFn: () => fetch(`/api/flows/waiting-children${params}`).then((r) => r.json()),
    refetchInterval: 15000,
  });
}
