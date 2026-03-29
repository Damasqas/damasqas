import { useState } from 'react';
import type { ErrorGroup as ErrorGroupType } from '../hooks/useJobs';

interface ErrorGroupProps {
  group: ErrorGroupType;
  queue: string;
  onRetry: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}

export function ErrorGroup({ group, queue, onRetry, onRemove }: ErrorGroupProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      marginBottom: 8,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{
          color: '#666',
          fontSize: 12,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          ▶
        </span>
        <span style={{
          background: 'rgba(255, 51, 51, 0.15)',
          color: '#ff3333',
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 10,
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {group.count}
        </span>
        <span style={{
          color: '#ccc',
          fontSize: 13,
          fontFamily: 'IBM Plex Mono, monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {group.reason}
        </span>
      </div>

      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          padding: '8px 16px',
        }}>
          {group.jobIds.slice(0, 20).map((id) => (
            <div
              key={id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
              }}
            >
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 12,
                color: '#999',
              }}>
                Job #{id}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton label="Retry" onClick={() => onRetry(id)} />
                <ActionButton label="Remove" onClick={() => onRemove(id)} danger />
              </div>
            </div>
          ))}
          {group.jobIds.length > 20 && (
            <div style={{ padding: '8px 0', color: '#666', fontSize: 12 }}>
              ... and {group.jobIds.length - 20} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, onClick, danger }: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        border: `1px solid ${danger ? 'rgba(255, 51, 51, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
        borderRadius: 6,
        color: danger ? '#ff3333' : '#ccc',
        fontSize: 11,
        padding: '3px 10px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
