import { useState } from 'react';
import type { ErrorGroup as ErrorGroupType } from '../hooks/useJobs';
import { glassCard, glassBtn, glassBtnRed, colors, rowHoverBg } from '../theme';

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
      ...glassCard,
      marginBottom: 8,
      overflow: 'hidden',
      padding: 0,
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          transition: 'all 0.15s',
          background: expanded ? rowHoverBg : 'transparent',
        }}
      >
        <span style={{
          color: colors.textMuted,
          fontSize: 12,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          ▶
        </span>
        <span style={{
          background: 'linear-gradient(135deg, rgba(185,28,28,0.18), rgba(185,28,28,0.06))',
          color: colors.redText,
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 6,
          border: `1px solid ${colors.redBorder}`,
          fontFamily: "'IBM Plex Mono', monospace",
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
        }}>
          {group.count}
        </span>
        <span style={{
          color: colors.textSecondary,
          fontSize: 13,
          fontFamily: "'IBM Plex Mono', monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {group.reason}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '8px 16px' }}>
          <div style={{
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
            marginBottom: 8,
          }} />
          {group.jobIds.slice(0, 20).map((id) => (
            <div
              key={id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
              }}
            >
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                color: colors.textSecondary,
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
            <div style={{ padding: '8px 0', color: colors.textMuted, fontSize: 12 }}>
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
        ...(danger ? glassBtnRed : glassBtn),
        fontSize: 11,
        padding: '3px 10px',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
