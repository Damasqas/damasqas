import { useState } from 'react';
import { useQueues } from '../hooks/useQueues';
import { useErrorGroups, useRetryJob, useRemoveJob } from '../hooks/useJobs';
import { ErrorGroup } from '../components/ErrorGroup';
import { colors, filterBtn, filterBtnActive } from '../theme';

type Range = '5m' | '1h' | '6h' | '24h' | '7d';

const RANGE_LABELS: Record<Range, string> = {
  '5m': '5 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '7d': '7 days',
};

interface FailedJobsProps {
  queue: string | null;
  onSelectQueue: (name: string) => void;
}

export function FailedJobs({ queue, onSelectQueue }: FailedJobsProps) {
  const { data: queuesData } = useQueues();
  const queues = queuesData?.queues || [];

  const [selectedQueue, setSelectedQueue] = useState(
    queue || queues[0]?.name || '',
  );
  const [range, setRange] = useState<Range>('1h');

  const activeQueue = selectedQueue || queues[0]?.name || '';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
          {queues.map((q) => (
            <button
              type="button"
              key={q.name}
              onClick={() => setSelectedQueue(q.name)}
              style={activeQueue === q.name ? filterBtnActive : filterBtn}
            >
              {q.name}
              {q.counts.failed > 0 && (
                <span style={{
                  marginLeft: 6,
                  background: 'linear-gradient(135deg, rgba(185,28,28,0.2), rgba(185,28,28,0.08))',
                  padding: '1px 6px',
                  borderRadius: 8,
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: colors.redText,
                }}>
                  {q.counts.failed}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => setRange(r)}
              style={{
                ...(range === r ? filterBtnActive : filterBtn),
                padding: '4px 12px',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {activeQueue && <ErrorGroupList queue={activeQueue} range={range} />}
    </div>
  );
}

function ErrorGroupList({ queue, range }: { queue: string; range: Range }) {
  const { data } = useErrorGroups(queue, range);
  const retryJob = useRetryJob(queue);
  const removeJob = useRemoveJob(queue);

  const groups = data?.groups || [];

  if (groups.length === 0) {
    return (
      <div style={{ color: colors.textMuted, padding: 40, textAlign: 'center' }}>
        No failures in the last {RANGE_LABELS[range]}.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 12,
        color: colors.textMuted,
        marginBottom: 12,
      }}>
        {groups.length} error group{groups.length !== 1 ? 's' : ''} in the last {RANGE_LABELS[range]}
      </div>
      {groups.map((group) => (
        <ErrorGroup
          key={group.reason}
          group={group}
          queue={queue}
          onRetry={(id) => retryJob.mutate(id)}
          onRemove={(id) => removeJob.mutate(id)}
        />
      ))}
    </div>
  );
}
