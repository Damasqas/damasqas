import { useQuery } from '@tanstack/react-query';

export interface PeriodMetrics {
  completed: number;
  failed: number;
  failRate: number | null;
  avgProcessMs: number | null;
}

export interface SnapshotMetrics {
  waiting: number;
  throughput: number | null;
  failRate: number | null;
  avgProcessMs?: number | null;
}

export interface QueueComparison {
  queue: string;
  events: {
    current: PeriodMetrics;
    yesterday: PeriodMetrics | null;
    lastWeek: PeriodMetrics | null;
  };
  snapshots: {
    current: SnapshotMetrics | null;
    yesterday: SnapshotMetrics | null;
    lastWeek: SnapshotMetrics | null;
  };
}

export interface OverviewComparison {
  comparisons: Record<string, {
    current: { waiting: number; throughput: number | null; failRate: number | null };
    yesterday: { waiting: number; throughput: number | null; failRate: number | null } | null;
  }>;
}

export function useQueueComparison(queue: string) {
  return useQuery<QueueComparison>({
    queryKey: ['comparison', queue],
    queryFn: () =>
      fetch(`/api/queues/${encodeURIComponent(queue)}/comparison`).then((r) =>
        r.json(),
      ),
    refetchInterval: 15000,
  });
}

export function useOverviewComparison() {
  return useQuery<OverviewComparison>({
    queryKey: ['comparison-overview'],
    queryFn: () =>
      fetch('/api/comparison').then((r) => r.json()),
    refetchInterval: 15000,
  });
}

export type TrendDirection = 'up' | 'down' | 'stable';
export type TrendSentiment = 'good' | 'bad' | 'neutral';

export interface TrendInfo {
  direction: TrendDirection;
  sentiment: TrendSentiment;
  multiplier: number | null;
  label: string;
}

/**
 * Compute trend info for a metric comparing current vs previous.
 * @param current - Current value
 * @param previous - Previous value (from yesterday or last week)
 * @param higherIsBad - Whether a higher value is worse (true for failure rate, waiting)
 */
export function computeTrend(
  current: number | null,
  previous: number | null,
  higherIsBad: boolean,
): TrendInfo | null {
  if (current == null || previous == null || previous === 0) return null;

  const ratio = current / previous;

  // Determine if change is significant
  const isSignificant = higherIsBad
    ? ratio > 2 || ratio < 0.5  // >2x for rates
    : Math.abs(ratio - 1) > 0.5;  // >50% for absolute values

  if (!isSignificant) {
    return {
      direction: 'stable',
      sentiment: 'neutral',
      multiplier: ratio,
      label: `${ratio.toFixed(1)}x vs`,
    };
  }

  const direction: TrendDirection = ratio > 1 ? 'up' : 'down';
  const sentiment: TrendSentiment = higherIsBad
    ? (direction === 'up' ? 'bad' : 'good')
    : (direction === 'up' ? 'good' : 'bad');

  return {
    direction,
    sentiment,
    multiplier: ratio,
    label: `${ratio.toFixed(1)}x vs`,
  };
}
