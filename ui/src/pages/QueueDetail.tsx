import { useState } from 'react';
import { useQueue, usePauseQueue, useResumeQueue } from '../hooks/useQueues';
import { useMetrics } from '../hooks/useMetrics';
import { useRetryAll } from '../hooks/useJobs';
import { useToast } from '../components/Toast';
import { StatCard } from '../components/StatCard';
import { Chart } from '../components/Chart';

interface QueueDetailProps {
  queue: string;
  onSelectQueue: (name: string) => void;
}

type Range = '1h' | '6h' | '24h' | '7d';

function formatTime(timestamp: number, range: Range): string {
  const d = new Date(timestamp);
  if (range === '7d') {
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${date} ${time}`;
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function QueueDetail({ queue }: QueueDetailProps) {
  const { data: queueData } = useQueue(queue);
  const [range, setRange] = useState<Range>('1h');
  const { data: metricsData } = useMetrics(queue, range);
  const { showToast } = useToast();

  const pauseMutation = usePauseQueue(queue);
  const resumeMutation = useResumeQueue(queue);
  const retryAllMutation = useRetryAll(queue);

  if (!queueData) {
    return <div style={{ color: '#666', padding: 40 }}>Loading queue...</div>;
  }

  const q = queueData;
  const metrics = metricsData?.metrics || [];
  const snapshots = metricsData?.snapshots || [];

  const chartData = metrics.map((m) => ({
    time: formatTime(m.timestamp, range),
    throughput: m.throughput,
    failures: m.failureRate,
    processingTime: m.avgProcessingMs,
  }));

  const waitingData = snapshots.map((s) => ({
    time: formatTime(s.timestamp, range),
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
      </div>

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
        <Chart data={chartData} dataKey="throughput" title="Throughput (jobs/min)" color="#22c55e" />
        <Chart data={chartData} dataKey="failures" title="Failures (failures/min)" color="#ff3333" />
        <Chart data={waitingData} dataKey="waiting" title="Waiting Jobs" color="#f59e0b" />
        <Chart data={waitingData} dataKey="active" title="Active Jobs" color="#3b82f6" />
      </div>
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
