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
import { useQueueComparison, computeTrend } from '../hooks/useComparison';
import type { TrendInfo } from '../hooks/useComparison';
import { colors, glassBtn, glassBtnHover, filterBtn, filterBtnActive } from '../theme';

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
  const { data: comparisonData } = useQueueComparison(queue);
  const { showToast } = useToast();

  const pauseMutation = usePauseQueue(queue);
  const resumeMutation = useResumeQueue(queue);
  const retryAllMutation = useRetryAll(queue);
  const promoteAllMutation = usePromoteAllOverdue(queue);

  if (!queueData) {
    return <div style={{ color: colors.textMuted, padding: 40 }}>Loading queue...</div>;
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
        <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 600, letterSpacing: -0.5 }}>
          {queue}
          {q.paused && (
            <span style={{
              fontSize: 11,
              color: colors.amberText,
              background: 'linear-gradient(135deg, rgba(217,119,6,0.15), rgba(217,119,6,0.06))',
              padding: '2px 8px',
              borderRadius: 6,
              marginLeft: 12,
              border: `1px solid ${colors.amberBorder}`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
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
        <StatCard
          label="Waiting"
          value={q.counts.waiting.toLocaleString()}
          trends={buildSnapshotTrends(comparisonData, 'waiting', true)}
        />
        <StatCard label="Active" value={q.counts.active} />
        <StatCard label="Completed" value={q.counts.completed.toLocaleString()} />
        <StatCard
          label="Failed"
          value={q.counts.failed.toLocaleString()}
          critical={q.counts.failed > 0}
          trends={buildEventTrends(comparisonData, 'failRate', true)}
        />
        <StatCard label="Delayed" value={q.counts.delayed} />
        <StatCard label="Locks" value={q.processors.locks} />
        <StatCard label="Stalled" value={q.processors.stalled} critical={q.processors.stalled > 0} />
        <StatCard label="Overdue Delayed" value={q.overdueDelayed || 0} critical={(q.overdueDelayed || 0) > 0} />
      </div>

      <CapacityPanel queue={q} metrics={metrics} range={range} domain={[since, until]} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['1h', '6h', '24h', '7d'] as const).map((r) => (
          <button
            type="button"
            key={r}
            onClick={() => setRange(r)}
            style={range === r ? filterBtnActive : filterBtn}
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
        <Chart data={chartData} dataKey="throughput" title="Throughput (jobs/min)" color={colors.green} domain={[since, until]} range={range} />
        <Chart data={chartData} dataKey="failures" title="Failures (failures/min)" color={colors.red} domain={[since, until]} range={range} />
        <Chart data={waitingData} dataKey="waiting" title="Waiting Jobs" color={colors.amber} domain={[since, until]} range={range} />
        <Chart data={waitingData} dataKey="active" title="Active Jobs" color={colors.blue} domain={[since, until]} range={range} />
      </div>

      <JobTypeTable breakdown={jobTypesData?.breakdown || []} />
    </div>
  );
}

function buildSnapshotTrends(
  data: ReturnType<typeof useQueueComparison>['data'],
  field: 'waiting' | 'throughput' | 'failRate',
  higherIsBad: boolean,
): { period: string; trend: TrendInfo | null }[] {
  if (!data?.snapshots?.current) return [];
  const current = data.snapshots.current[field];
  return [
    { period: 'yesterday', trend: computeTrend(current, data.snapshots.yesterday?.[field] ?? null, higherIsBad) },
    { period: 'last week', trend: computeTrend(current, data.snapshots.lastWeek?.[field] ?? null, higherIsBad) },
  ];
}

function buildEventTrends(
  data: ReturnType<typeof useQueueComparison>['data'],
  field: 'completed' | 'failed' | 'failRate' | 'avgProcessMs',
  higherIsBad: boolean,
): { period: string; trend: TrendInfo | null }[] {
  if (!data?.events?.current) return [];
  const current = data.events.current[field];
  return [
    { period: 'yesterday', trend: computeTrend(current, data.events.yesterday?.[field] ?? null, higherIsBad) },
    { period: 'last week', trend: computeTrend(current, data.events.lastWeek?.[field] ?? null, higherIsBad) },
  ];
}

function ControlButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...glassBtn,
        ...(hovered ? glassBtnHover : {}),
        padding: '6px 14px',
        fontSize: 12,
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
