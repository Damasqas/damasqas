import { useQuery } from '@tanstack/react-query';

export interface AnomalyRecord {
  id: number;
  queue: string;
  timestamp: number;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  currentValue: number;
  baselineValue: number;
  multiplier: number;
  resolvedAt: number | null;
  alertSent: boolean;
}

export function useAnomalies(queue?: string) {
  const params = queue ? `?queue=${encodeURIComponent(queue)}` : '';
  return useQuery<{ active: AnomalyRecord[]; history: AnomalyRecord[] }>({
    queryKey: ['anomalies', queue],
    queryFn: () => fetch(`/api/anomalies${params}`).then((r) => r.json()),
    refetchInterval: 5000,
  });
}
