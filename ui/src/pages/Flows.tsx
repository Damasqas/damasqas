import { useState } from 'react';
import { useDeadlocks, useWaitingChildren, useFlowTree } from '../hooks/useFlows';
import { FlowTree } from '../components/FlowTree';
import {
  glassCard,
  glassCardInner,
  glassBtn,
  glassBtnRed,
  sectionLabel,
  colors,
  thStyle as baseThStyle,
  tdStyle as baseTdStyle,
} from '../theme';

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
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: '#fff', letterSpacing: -0.5 }}>
        Flow Dependencies
      </h2>

      {/* Deadlock Alerts Panel */}
      <div
        style={{
          ...glassCard,
          borderColor: deadlocks.length > 0 ? colors.redBorder : 'rgba(255,255,255,0.08)',
          boxShadow: deadlocks.length > 0
            ? `0 4px 24px rgba(0,0,0,0.3), 0 2px 12px ${colors.redGlow}, inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -0.5px 0 rgba(255,255,255,0.03)`
            : undefined,
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: 0 }}>
            Deadlock Detection
          </h3>
          {deadlocks.length > 0 ? (
            <span
              style={{
                background: `linear-gradient(135deg, ${colors.red}, #b91c1c)`,
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 10,
                boxShadow: `0 2px 8px rgba(220,38,38,0.3)`,
              }}
            >
              {deadlocks.length}
            </span>
          ) : (
            <span style={{ color: colors.greenText, fontSize: 12 }}>No deadlocks detected</span>
          )}
          {scannedAt > 0 && (
            <span style={{ color: colors.textMuted, fontSize: 11, marginLeft: 'auto' }}>
              Last scan: {formatAge(Date.now() - scannedAt)} ago
            </span>
          )}
        </div>

        {deadlocks.map((dl) => (
          <div
            key={`${dl.parentQueue}:${dl.parentJobId}:${dl.childQueue}:${dl.childJobId}`}
            style={{
              ...glassCardInner,
              background: 'linear-gradient(135deg, rgba(185,28,28,0.06), rgba(185,28,28,0.02))',
              borderColor: 'rgba(185,28,28,0.12)',
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: colors.redText, fontWeight: 600, fontSize: 12 }}>
                DEADLOCK
              </span>
              <span style={{ color: colors.textSecondary, fontSize: 11 }}>
                blocked {formatAge(Date.now() - dl.blockedSince)}
              </span>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div>
                <span style={{ color: colors.textSecondary }}>Parent: </span>
                <span className="mono" style={{ color: '#fff' }}>
                  {dl.parentName}
                </span>
                <span style={{ color: colors.textMuted }}>
                  {' '}({dl.parentQueue}:{dl.parentJobId})
                </span>
              </div>
              <div>
                <span style={{ color: colors.textSecondary }}>Blocked by: </span>
                <span className="mono" style={{ color: colors.redText }}>
                  {dl.childName}
                </span>
                <span style={{ color: colors.textMuted }}>
                  {' '}({dl.childQueue}:{dl.childJobId})
                </span>
              </div>
              <div style={{ color: colors.redText, fontSize: 11, marginTop: 4 }}>
                {dl.childError}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setSelectedJob({ queue: dl.parentQueue, jobId: dl.parentJobId })
              }
              style={{
                ...glassBtnRed,
                marginTop: 8,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 600,
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
          ...glassCard,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
          Jobs Waiting on Children
          {waitingJobs.length > 0 && (
            <span style={{ color: colors.textSecondary, fontWeight: 400, marginLeft: 8 }}>
              ({waitingJobs.length})
            </span>
          )}
        </h3>

        {waitingJobs.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13 }}>
            No jobs currently waiting on children.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={baseThStyle}>Queue</th>
                <th style={baseThStyle}>Job ID</th>
                <th style={baseThStyle}>Name</th>
                <th style={baseThStyle}>Age</th>
                <th style={baseThStyle}>Pending</th>
                <th style={baseThStyle}>Completed</th>
                <th style={baseThStyle}>Failed</th>
                <th style={baseThStyle}></th>
              </tr>
              <tr>
                <td colSpan={8} style={{
                  height: 1,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
                  padding: 0,
                }} />
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
                      background: isSelected
                        ? 'linear-gradient(135deg, rgba(96,165,250,0.08), rgba(96,165,250,0.02))'
                        : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onClick={() => setSelectedJob({ queue: job.queue, jobId: job.jobId })}
                  >
                    <td style={baseTdStyle}>
                      <span
                        style={{ color: colors.blueText, cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectQueue?.(job.queue);
                        }}
                      >
                        {job.queue}
                      </span>
                    </td>
                    <td style={{ ...baseTdStyle, fontFamily: "'IBM Plex Mono', monospace" }}>{job.jobId}</td>
                    <td style={baseTdStyle}>{job.name}</td>
                    <td style={baseTdStyle}>{job.timestamp > 0 ? formatAge(Date.now() - job.timestamp) : '-'}</td>
                    <td style={baseTdStyle}>{job.pendingChildren}</td>
                    <td style={{ ...baseTdStyle, color: colors.greenText }}>{job.completedChildren}</td>
                    <td style={{ ...baseTdStyle, color: job.failedChildren > 0 ? colors.redText : undefined }}>
                      {job.failedChildren}
                    </td>
                    <td style={baseTdStyle}>
                      <span style={{ color: colors.textMuted, fontSize: 11 }}>
                        {isSelected ? '\u25BC' : '\u25B6'}
                      </span>
                    </td>
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
            ...glassCard,
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
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: 0 }}>
              Flow Tree
            </h3>
            <span className="mono" style={{ color: colors.textSecondary, fontSize: 12 }}>
              {selectedJob.queue}:{selectedJob.jobId}
            </span>
            <button
              type="button"
              onClick={() => setSelectedJob(null)}
              style={{
                ...glassBtn,
                marginLeft: 'auto',
                fontSize: 11,
                padding: '2px 8px',
                fontFamily: 'inherit',
              }}
            >
              Close
            </button>
          </div>

          {treeLoading ? (
            <div style={{ color: colors.textMuted, fontSize: 13 }}>Loading flow tree...</div>
          ) : treeData?.tree ? (
            <FlowTree tree={treeData.tree} />
          ) : (
            <div style={{ color: colors.textMuted, fontSize: 13 }}>
              No flow tree data available for this job.
            </div>
          )}
        </div>
      )}
    </div>
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
