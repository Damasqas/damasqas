import { useState } from 'react';
import type { FlowNode, FlowJobState } from '../hooks/useFlows';
import { colors, glassBtn } from '../theme';

const STATE_COLORS: Record<FlowJobState, { bg: string; text: string }> = {
  completed: { bg: colors.green, text: colors.greenText },
  failed: { bg: colors.red, text: colors.redText },
  active: { bg: colors.blue, text: colors.blueText },
  waiting: { bg: 'rgba(255,255,255,0.15)', text: colors.textSecondary },
  delayed: { bg: colors.amber, text: colors.amberText },
  'waiting-children': { bg: colors.purple, text: colors.purpleText },
  unknown: { bg: 'rgba(255,255,255,0.1)', text: colors.textMuted },
};

function hasProblematicDescendant(node: FlowNode): boolean {
  if (node.isDeadlocked || node.isBlocker) return true;
  return node.children.some(hasProblematicDescendant);
}

interface FlowTreeProps {
  tree: FlowNode;
  onJobClick?: (queue: string, jobId: string) => void;
}

export function FlowTree({ tree, onJobClick }: FlowTreeProps) {
  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
      <FlowTreeNode node={tree} depth={0} onJobClick={onJobClick} />
    </div>
  );
}

function FlowTreeNode({
  node,
  depth,
  onJobClick,
}: {
  node: FlowNode;
  depth: number;
  onJobClick?: (queue: string, jobId: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const hasProblems = hasProblematicDescendant(node);
  const [expanded, setExpanded] = useState(
    node.isDeadlocked || node.isBlocker || hasProblems || node.state !== 'completed',
  );

  const borderColor = node.isDeadlocked
    ? colors.red
    : node.isBlocker
      ? colors.amber
      : 'rgba(255,255,255,0.08)';

  return (
    <div style={{ marginLeft: depth > 0 ? 24 : 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          marginBottom: 2,
          background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
          border: `1px solid ${depth === 0 ? 'rgba(255,255,255,0.08)' : 'transparent'}`,
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 6,
          cursor: hasChildren || onJobClick ? 'pointer' : 'default',
          backdropFilter: depth === 0 ? 'blur(8px)' : undefined,
          WebkitBackdropFilter: depth === 0 ? 'blur(8px)' : undefined,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          transition: 'all 0.15s',
        }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
        }}
      >
        {hasChildren && (
          <span style={{ color: colors.textMuted, fontSize: 10, width: 12, flexShrink: 0 }}>
            {expanded ? '\u25BC' : '\u25B6'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 12, flexShrink: 0 }} />}

        <span style={{ color: '#fff', fontWeight: 500 }}>{node.name}</span>

        <span style={{ color: colors.textMuted, fontSize: 11 }}>
          {node.queue}:{node.jobId}
        </span>

        <StateBadge state={node.state} />

        {node.isDeadlocked && (
          <span
            style={{
              background: `linear-gradient(135deg, ${colors.red}, #b91c1c)`,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 6,
              letterSpacing: 0.5,
              boxShadow: `0 2px 8px rgba(220,38,38,0.3)`,
            }}
          >
            DEADLOCK
          </span>
        )}
        {node.isBlocker && !node.isDeadlocked && (
          <span
            style={{
              background: `linear-gradient(135deg, ${colors.amber}, #b45309)`,
              color: '#000',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 6,
              letterSpacing: 0.5,
              boxShadow: `0 2px 8px rgba(217,119,6,0.3)`,
            }}
          >
            BLOCKING
          </span>
        )}
        {node.truncated && (
          <span style={{ color: colors.textSecondary, fontSize: 11, fontStyle: 'italic' }}>
            (truncated)
          </span>
        )}

        {node.state === 'failed' && node.attemptsMade > 0 && (
          <span style={{ color: colors.textSecondary, fontSize: 11 }}>
            {node.attemptsMade}/{node.maxAttempts} attempts
          </span>
        )}

        {onJobClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onJobClick(node.queue, node.jobId);
            }}
            style={{
              ...glassBtn,
              marginLeft: 'auto',
              fontSize: 11,
              padding: '2px 8px',
              flexShrink: 0,
            }}
          >
            View
          </button>
        )}
      </div>

      {node.failedReason && expanded && (
        <div
          style={{
            marginLeft: 36,
            marginBottom: 4,
            padding: '4px 8px',
            background: 'linear-gradient(135deg, rgba(185,28,28,0.1), rgba(185,28,28,0.04))',
            border: `1px solid ${colors.redBorder}`,
            borderRadius: 6,
            color: colors.redText,
            fontSize: 11,
            maxHeight: 60,
            overflow: 'hidden',
            wordBreak: 'break-all',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {node.failedReason}
        </div>
      )}

      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <FlowTreeNode
            key={`${child.queue}:${child.jobId}`}
            node={child}
            depth={depth + 1}
            onJobClick={onJobClick}
          />
        ))}
    </div>
  );
}

function StateBadge({ state }: { state: FlowJobState }) {
  const c = STATE_COLORS[state];
  return (
    <span
      style={{
        background: `linear-gradient(135deg, ${c.bg}22, ${c.bg}0E)`,
        color: c.text,
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 6,
        border: `1px solid ${c.bg}25`,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        flexShrink: 0,
        boxShadow: `0 0 6px ${c.bg}30, inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}
    >
      {state}
    </span>
  );
}
