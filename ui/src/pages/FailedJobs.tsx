import { useState } from 'react';
import { useQueues } from '../hooks/useQueues';
import { useErrorGroups, useRetryJob, useRemoveJob } from '../hooks/useJobs';
import { ErrorGroup } from '../components/ErrorGroup';
import { colors, filterBtn, filterBtnActive } from '../theme';

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

  const activeQueue = selectedQueue || queues[0]?.name || '';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {queues.map((q) => (
          <button
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

      {activeQueue && <ErrorGroupList queue={activeQueue} />}
    </div>
  );
}

function ErrorGroupList({ queue }: { queue: string }) {
  const { data } = useErrorGroups(queue);
  const retryJob = useRetryJob(queue);
  const removeJob = useRemoveJob(queue);

  const groups = data?.groups || [];

  if (groups.length === 0) {
    return (
      <div style={{ color: colors.textMuted, padding: 40, textAlign: 'center' }}>
        No recent failures for this queue.
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
        {groups.length} error group{groups.length !== 1 ? 's' : ''} in the last 5 minutes
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
