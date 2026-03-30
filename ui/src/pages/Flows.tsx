import { useState } from 'react';
import { useDeadlocks, useWaitingChildren, useFlowTree } from '../hooks/useFlows';
import { FlowTree } from '../components/FlowTree';

interface FlowsProps {
  onSelectQueue?: (queue: string) => void;
}

export function Flows({ onSelectQueue }: FlowsProps) {
  const { data: deadlockData } = useDeadlocks();
  const { data: waitingData } = useWaitingChildren();
  const [selectedJob, setSelectedJob] = useState<{
    queue: string;
    jobId: string;
  } | null>(null);
  const { data: treeData, isLoading: treeLoading } = useFlowTree(
    selectedJob?.queue ?? null,
    selectedJob?.jobId ?? null,
  );

  const deadlocks = deadlockData?.deadlocks ?? [];
  const scannedAt = deadlockData?.scannedAt ?? 0;
  const waitingJobs = waitingData?.jobs ?? [];

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: '#fff' }}>
        Flow Dependencies
      </h2>

      {/* Deadlock Alerts Panel */}
      <div
        style={{
          background: '#111',
          border: `1px solid ${deadlocks.length > 0 ? '#ff3333' : '#1a1a1a'}`,
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: deadlocks.length > 0 ? 12 : 0,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>
            Deadlock Detection
          </h3>
          {deadlocks.length > 0 ? (
            <span
              style={{
                background: '#ff3333',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {deadlocks.length}
            </span>
          ) : (
            <span style={{ color: '#22c55e', fontSize: 12 }}>No deadlocks detected</span>
          )}
          {scannedAt > 0 && (
            <span style={{ color: '#555', fontSize: 11, marginLeft: 'auto' }}>
              Last scan: {formatAge(Date.now() - scannedAt)} ago
            </span>
          )}
        </div>

        {deadlocks.map((dl) => (
          <div
            key={`${dl.parentQueue}:${dl.parentJobId}:${dl.childQueue}:${dl.childJobId}`}
            style={{
              background: '#0a0a0a',
              border: '1px solid #331111',
              borderRadius: 6,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: '#ff3333', fontWeight: 600, fontSize: 12 }}>
                DEADLOCK
              </span>
              <span style={{ color: '#888', fontSize: 11 }}>
                blocked {formatAge(Date.now() - dl.blockedSince)}
              </span>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div>
                <span style={{ color: '#888' }}>Parent: </span>
                <span className="mono" style={{ color: '#e0e0e0' }}>
                  {dl.parentName}
                </span>
                <span style={{ color: '#555' }}>
                  {' '}({dl.parentQueue}:{dl.parentJobId})
                </span>
              </div>
              <div>
                <span style={{ color: '#888' }}>Blocked by: </span>
                <span className="mono" style={{ color: '#ff6666' }}>
                  {dl.childName}
                </span>
                <span style={{ color: '#555' }}>
                  {' '}({dl.childQueue}:{dl.childJobId})
                </span>
              </div>
              <div style={{ color: '#ff6666', fontSize: 11, marginTop: 4 }}>
                {dl.childError}
              </div>
            </div>
            <button
              onClick={() =>
                setSelectedJob({ queue: dl.parentQueue, jobId: dl.parentJobId })
              }
              style={{
                marginTop: 8,
                background: 'none',
                border: '1px solid #ff3333',
                color: '#ff3333',
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              View Flow
            </button>
          </div>
        ))}
      </div>

      {/* Waiting-Children Jobs Table */}
      <div
        style={{
          background: '#111',
          border: '1px solid #1a1a1a',
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 12 }}>
          Jobs Waiting on Children
          {waitingJobs.length > 0 && (
            <span style={{ color: '#888', fontWeight: 400, marginLeft: 8 }}>
              ({waitingJobs.length})
            </span>
          )}
        </h3>

        {waitingJobs.length === 0 ? (
          <div style={{ color: '#555', fontSize: 13 }}>
            No jobs currently waiting on children.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <Th>Queue</Th>
                <Th>Job ID</Th>
                <Th>Name</Th>
                <Th>Age</Th>
                <Th>Pending</Th>
                <Th>Completed</Th>
                <Th>Failed</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {waitingJobs.map((job) => {
                const isSelected =
                  selectedJob?.queue === job.queue && selectedJob?.jobId === job.jobId;
                return (
                  <tr
                    key={`${job.queue}:${job.jobId}`}
                    style={{
                      borderBottom: '1px solid #1a1a1a',
                      background: isSelected ? '#1a1a2e' : 'transparent',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedJob({ queue: job.queue, jobId: job.jobId })}
                  >
                    <Td>
                      <span
                        style={{ color: '#3b82f6', cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectQueue?.(job.queue);
                        }}
                      >
                        {job.queue}
                      </span>
                    </Td>
                    <Td mono>{job.jobId}</Td>
                    <Td>{job.name}</Td>
                    <Td>{job.timestamp > 0 ? formatAge(Date.now() - job.timestamp) : '-'}</Td>
                    <Td>{job.pendingChildren}</Td>
                    <Td style={{ color: '#22c55e' }}>{job.completedChildren}</Td>
                    <Td style={{ color: job.failedChildren > 0 ? '#ff3333' : undefined }}>
                      {job.failedChildren}
                    </Td>
                    <Td>
                      <span style={{ color: '#555', fontSize: 11 }}>
                        {isSelected ? '\u25BC' : '\u25B6'}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Flow Tree Viewer */}
      {selectedJob && (
        <div
          style={{
            background: '#111',
            border: '1px solid #1a1a1a',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>
              Flow Tree
            </h3>
            <span className="mono" style={{ color: '#888', fontSize: 12 }}>
              {selectedJob.queue}:{selectedJob.jobId}
            </span>
            <button
              onClick={() => setSelectedJob(null)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: '1px solid #333',
                color: '#888',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Close
            </button>
          </div>

          {treeLoading ? (
            <div style={{ color: '#555', fontSize: 13 }}>Loading flow tree...</div>
          ) : treeData?.tree ? (
            <FlowTree tree={treeData.tree} />
          ) : (
            <div style={{ color: '#555', fontSize: 13 }}>
              No flow tree data available for this job.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        color: '#666',
        fontWeight: 500,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  style,
}: {
  children?: React.ReactNode;
  mono?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: '8px 10px',
        color: '#e0e0e0',
        fontFamily: mono ? 'IBM Plex Mono, monospace' : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function formatAge(ms: number): string {
  if (ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
