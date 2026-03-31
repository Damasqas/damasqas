import { useQueues } from '../hooks/useQueues';
import { useAnomalies } from '../hooks/useAnomalies';
import { StatCard } from '../components/StatCard';
import { AlertBanner } from '../components/AlertBanner';
import { QueueTable } from '../components/QueueTable';
import { useOverviewComparison, computeTrend } from '../hooks/useComparison';
import { colors } from '../theme';

interface OverviewProps {
  onSelectQueue: (name: string) => void;
}

export function Overview({ onSelectQueue }: OverviewProps) {
  const { data, isLoading } = useQueues();
  const { data: anomalyData } = useAnomalies();
  const { data: comparisonData } = useOverviewComparison();

  if (isLoading) {
    return <div style={{ color: colors.textMuted, padding: 40 }}>Loading queues...</div>;
  }

  const queues = data?.queues || [];
  const activeAnomalies = anomalyData?.active || [];

  const totalThroughput = queues.reduce(
    (sum, q) => sum + (q.metrics?.throughput || 0),
    0,
  );
  const totalFailures = queues.reduce(
    (sum, q) => sum + (q.metrics?.failureRate || 0),
    0,
  );
  const totalWaiting = queues.reduce((sum, q) => sum + q.counts.waiting, 0);
  const totalLocks = queues.reduce((sum, q) => sum + q.processors.locks, 0);
  const totalStalled = queues.reduce((sum, q) => sum + q.processors.stalled, 0);
  const totalOverdue = queues.reduce((sum, q) => sum + (q.overdueDelayed || 0), 0);

  const comparisons = comparisonData?.comparisons;
  let matchedCurrentThroughput = 0;
  let matchedCurrentFailRate = 0;
  let matchedCurrentWaiting = 0;
  let yesterdayTotalThroughput = 0;
  let yesterdayTotalFailRate = 0;
  let yesterdayTotalWaiting = 0;
  let hasYesterdayData = false;
  if (comparisons) {
    for (const queue of queues) {
      const comp = comparisons[queue.name];
      if (comp?.yesterday) {
        hasYesterdayData = true;
        matchedCurrentThroughput += comp.current.throughput ?? 0;
        matchedCurrentFailRate += comp.current.failRate ?? 0;
        matchedCurrentWaiting += comp.current.waiting;
        yesterdayTotalThroughput += comp.yesterday.throughput ?? 0;
        yesterdayTotalFailRate += comp.yesterday.failRate ?? 0;
        yesterdayTotalWaiting += comp.yesterday.waiting;
      }
    }
  }

  const throughputTrend = hasYesterdayData
    ? [{ period: 'yesterday', trend: computeTrend(matchedCurrentThroughput, yesterdayTotalThroughput, false) }]
    : [];
  const failureTrend = hasYesterdayData
    ? [{ period: 'yesterday', trend: computeTrend(matchedCurrentFailRate, yesterdayTotalFailRate, true) }]
    : [];
  const waitingTrend = hasYesterdayData
    ? [{ period: 'yesterday', trend: computeTrend(matchedCurrentWaiting, yesterdayTotalWaiting, true) }]
    : [];

  return (
    <div>
      <AlertBanner anomalies={activeAnomalies} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <StatCard label="Throughput" value={`${totalThroughput.toFixed(1)}/m`} trends={throughputTrend} />
        <StatCard
          label="Failures"
          value={`${totalFailures.toFixed(1)}/m`}
          critical={totalFailures > 0}
          trends={failureTrend}
        />
        <StatCard label="Waiting" value={totalWaiting.toLocaleString()} trends={waitingTrend} />
        <StatCard label="Processors" value={totalLocks} />
        <StatCard
          label="Stalled"
          value={totalStalled}
          critical={totalStalled > 0}
        />
        <StatCard
          label="Overdue"
          value={totalOverdue}
          critical={totalOverdue > 0}
        />
        <StatCard label="Queues" value={queues.length} />
      </div>

      <QueueTable queues={queues} onSelect={onSelectQueue} />
    </div>
  );
}
