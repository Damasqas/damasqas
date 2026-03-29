import { useState } from 'react';
import { useQueues } from '../hooks/useQueues';
import { useErrorGroups, useRetryJob, useRemoveJob } from '../hooks/useJobs';
import { ErrorGroup } from '../components/ErrorGroup';

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
            style={{
              background: activeQueue === q.name ? 'rgba(255, 51, 51, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${activeQueue === q.name ? 'rgba(255, 51, 51, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
              borderRadius: 8,
              color: activeQueue === q.name ? '#ff3333' : '#888',
              fontSize: 12,
              padding: '6px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {q.name}
            {q.counts.failed > 0 && (
              <span style={{
                marginLeft: 6,
                background: 'rgba(255, 51, 51, 0.2)',
                padding: '1px 6px',
                borderRadius: 8,
                fontSize: 10,
                fontFamily: 'IBM Plex Mono, monospace',
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
      <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>
        No recent failures for this queue.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 12,
        color: '#666',
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
