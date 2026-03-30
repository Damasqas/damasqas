import { useQueues } from '../hooks/useQueues';
import { useAnomalies } from '../hooks/useAnomalies';
import { StatCard } from '../components/StatCard';
import { AlertBanner } from '../components/AlertBanner';
import { QueueTable } from '../components/QueueTable';

interface OverviewProps {
  onSelectQueue: (name: string) => void;
}

export function Overview({ onSelectQueue }: OverviewProps) {
  const { data, isLoading } = useQueues();
  const { data: anomalyData } = useAnomalies();

  if (isLoading) {
    return <div style={{ color: '#666', padding: 40 }}>Loading queues...</div>;
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

  return (
    <div>
      <AlertBanner anomalies={activeAnomalies} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <StatCard label="Throughput" value={`${totalThroughput.toFixed(1)}/m`} />
        <StatCard
          label="Failures"
          value={`${totalFailures.toFixed(1)}/m`}
          critical={totalFailures > 0}
        />
        <StatCard label="Waiting" value={totalWaiting.toLocaleString()} />
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
