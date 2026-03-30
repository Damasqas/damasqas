import { useState } from 'react';
import type { FlowNode, FlowJobState } from '../hooks/useFlows';

const STATE_COLORS: Record<FlowJobState, string> = {
  completed: '#22c55e',
  failed: '#ff3333',
  active: '#3b82f6',
  waiting: '#888',
  delayed: '#f59e0b',
  'waiting-children': '#a855f7',
  unknown: '#555',
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
    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
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
    ? '#ff3333'
    : node.isBlocker
      ? '#f59e0b'
      : '#333';

  return (
    <div style={{ marginLeft: depth > 0 ? 24 : 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          marginBottom: 2,
          background: '#111',
          border: `1px solid ${depth === 0 ? '#333' : 'transparent'}`,
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 4,
          cursor: hasChildren || onJobClick ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
        }}
      >
        {hasChildren && (
          <span style={{ color: '#666', fontSize: 10, width: 12, flexShrink: 0 }}>
            {expanded ? '\u25BC' : '\u25B6'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 12, flexShrink: 0 }} />}

        <span style={{ color: '#e0e0e0', fontWeight: 500 }}>{node.name}</span>

        <span style={{ color: '#666', fontSize: 11 }}>
          {node.queue}:{node.jobId}
        </span>

        <StateBadge state={node.state} />

        {node.isDeadlocked && (
          <span
            style={{
              background: '#ff3333',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 3,
              letterSpacing: 0.5,
            }}
          >
            DEADLOCK
          </span>
        )}
        {node.isBlocker && !node.isDeadlocked && (
          <span
            style={{
              background: '#f59e0b',
              color: '#000',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 3,
              letterSpacing: 0.5,
            }}
          >
            BLOCKING
          </span>
        )}
        {node.truncated && (
          <span style={{ color: '#888', fontSize: 11, fontStyle: 'italic' }}>
            (truncated)
          </span>
        )}

        {node.state === 'failed' && node.attemptsMade > 0 && (
          <span style={{ color: '#888', fontSize: 11 }}>
            {node.attemptsMade}/{node.maxAttempts} attempts
          </span>
        )}

        {onJobClick && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onJobClick(node.queue, node.jobId);
            }}
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
            background: 'rgba(255, 51, 51, 0.1)',
            borderRadius: 3,
            color: '#ff6666',
            fontSize: 11,
            maxHeight: 60,
            overflow: 'hidden',
            wordBreak: 'break-all',
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
  return (
    <span
      style={{
        background: STATE_COLORS[state] + '22',
        color: STATE_COLORS[state],
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 3,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        flexShrink: 0,
      }}
    >
      {state}
    </span>
  );
}
