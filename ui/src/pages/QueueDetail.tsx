import { useState } from 'react';
import { useQueue, usePauseQueue, useResumeQueue, usePromoteAllOverdue } from '../hooks/useQueues';
import { useMetrics } from '../hooks/useMetrics';
import { useJobTypes } from '../hooks/useJobTypes';
import { useRetryAll } from '../hooks/useJobs';
import { useToast } from '../components/Toast';
import { StatCard } from '../components/StatCard';
import { Chart } from '../components/Chart';
import { CapacityPanel } from '../components/CapacityPanel';
import { JobTypeTable } from '../components/JobTypeTable';

interface QueueDetailProps {
  queue: string;
  onSelectQueue: (name: string) => void;
}

type Range = '1h' | '6h' | '24h' | '7d';

const RANGE_MS: Record<Range, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function QueueDetail({ queue }: QueueDetailProps) {
  const { data: queueData } = useQueue(queue);
  const [range, setRange] = useState<Range>('1h');
  const { data: metricsData } = useMetrics(queue, range);
  const { data: jobTypesData } = useJobTypes(queue, range);
  const { showToast } = useToast();

  const pauseMutation = usePauseQueue(queue);
  const resumeMutation = useResumeQueue(queue);
  const retryAllMutation = useRetryAll(queue);
  const promoteAllMutation = usePromoteAllOverdue(queue);

  if (!queueData) {
    return <div style={{ color: '#666', padding: 40 }}>Loading queue...</div>;
  }

  const q = queueData;
  const metrics = metricsData?.metrics || [];
  const snapshots = metricsData?.snapshots || [];

  const now = Date.now();
  const since = metricsData?.since ?? (now - RANGE_MS[range]);
  const until = metricsData?.until ?? now;

  const chartData = metrics.map((m) => ({
    time: m.timestamp,
    throughput: m.throughput,
    failures: m.failureRate,
    processingTime: m.avgProcessingMs,
  }));

  const waitingData = snapshots.map((s) => ({
    time: s.timestamp,
    waiting: s.waiting,
    active: s.active,
  }));

  const handlePause = () =>
    pauseMutation.mutate(undefined, {
      onSuccess: () => showToast('Queue paused'),
      onError: () => showToast('Failed to pause queue', 'error'),
    });

  const handleResume = () =>
    resumeMutation.mutate(undefined, {
      onSuccess: () => showToast('Queue resumed'),
      onError: () => showToast('Failed to resume queue', 'error'),
    });

  const handleRetryAll = () =>
    retryAllMutation.mutate(undefined, {
      onSuccess: () => showToast('Retrying all failed jobs'),
      onError: () => showToast('Failed to retry jobs', 'error'),
    });

  const handlePromoteAll = () =>
    promoteAllMutation.mutate(undefined, {
      onSuccess: () => showToast('Promoting all overdue delayed jobs'),
      onError: () => showToast('Failed to promote overdue jobs', 'error'),
    });

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 600 }}>
          {queue}
          {q.paused && (
            <span style={{
              fontSize: 11,
              color: '#f59e0b',
              background: 'rgba(245, 158, 11, 0.1)',
              padding: '2px 8px',
              borderRadius: 6,
              marginLeft: 12,
            }}>
              PAUSED
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {q.paused ? (
            <ControlButton label="Resume" onClick={handleResume} />
          ) : (
            <ControlButton label="Pause" onClick={handlePause} />
          )}
          <ControlButton label="Retry All Failed" onClick={handleRetryAll} />
          {(q.overdueDelayed || 0) > 0 && (
            <ControlButton label="Promote All Overdue" onClick={handlePromoteAll} />
          )}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <StatCard label="Waiting" value={q.counts.waiting.toLocaleString()} />
        <StatCard label="Active" value={q.counts.active} />
        <StatCard label="Completed" value={q.counts.completed.toLocaleString()} />
        <StatCard label="Failed" value={q.counts.failed.toLocaleString()} critical={q.counts.failed > 0} />
        <StatCard label="Delayed" value={q.counts.delayed} />
        <StatCard label="Locks" value={q.processors.locks} />
        <StatCard label="Stalled" value={q.processors.stalled} critical={q.processors.stalled > 0} />
        <StatCard label="Overdue Delayed" value={q.overdueDelayed || 0} critical={(q.overdueDelayed || 0) > 0} />
      </div>

      <CapacityPanel queue={q} metrics={metrics} range={range} domain={[since, until]} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['1h', '6h', '24h', '7d'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              background: range === r ? 'rgba(255, 51, 51, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${range === r ? 'rgba(255, 51, 51, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
              borderRadius: 6,
              color: range === r ? '#ff3333' : '#888',
              fontSize: 12,
              padding: '4px 12px',
              cursor: 'pointer',
              fontFamily: 'IBM Plex Mono, monospace',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: 16,
      }}>
        <Chart data={chartData} dataKey="throughput" title="Throughput (jobs/min)" color="#22c55e" domain={[since, until]} range={range} />
        <Chart data={chartData} dataKey="failures" title="Failures (failures/min)" color="#ff3333" domain={[since, until]} range={range} />
        <Chart data={waitingData} dataKey="waiting" title="Waiting Jobs" color="#f59e0b" domain={[since, until]} range={range} />
        <Chart data={waitingData} dataKey="active" title="Active Jobs" color="#3b82f6" domain={[since, until]} range={range} />
      </div>

      <JobTypeTable breakdown={jobTypesData?.breakdown || []} />
    </div>
  );
}

function ControlButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        color: '#ccc',
        fontSize: 12,
        padding: '6px 14px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
