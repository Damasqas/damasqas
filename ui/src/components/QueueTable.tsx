import type { QueueState } from '../hooks/useQueues';

interface QueueTableProps {
  queues: QueueState[];
  onSelect: (name: string) => void;
}

const statusColors: Record<string, string> = {
  ok: '#22c55e',
  warning: '#f59e0b',
  critical: '#ff3333',
};

export function QueueTable({ queues, onSelect }: QueueTableProps) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            {['Queue', 'Status', 'Throughput', 'Failures', 'Waiting', 'Active', 'Locks', 'Stalled', 'Overdue'].map((h) => (
              <th key={h} style={{
                padding: '12px 16px',
                textAlign: 'left',
                fontSize: 11,
                color: '#666',
                textTransform: 'uppercase',
                letterSpacing: 1,
                fontWeight: 500,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {queues.map((q) => (
            <tr
              key={q.name}
              onClick={() => onSelect(q.name)}
              style={{
                borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <td style={{ padding: '12px 16px', fontWeight: 500, color: '#fff' }}>
                {q.name}
                {q.paused && (
                  <span style={{ fontSize: 10, color: '#666', marginLeft: 8 }}>PAUSED</span>
                )}
              </td>
              <td style={{ padding: '12px 16px' }}>
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: statusColors[q.status] || '#666',
                  boxShadow: q.status === 'critical' ? '0 0 8px rgba(255, 51, 51, 0.5)' : 'none',
                }} />
              </td>
              <td style={{ padding: '12px 16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                {q.metrics ? `${q.metrics.throughput.toFixed(1)}/m` : '—'}
              </td>
              <td style={{
                padding: '12px 16px',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 13,
                color: q.metrics && q.metrics.failureRate > 0 ? '#ff3333' : 'inherit',
              }}>
                {q.metrics ? `${q.metrics.failureRate.toFixed(1)}/m` : '—'}
              </td>
              <td style={{ padding: '12px 16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                {q.counts.waiting.toLocaleString()}
              </td>
              <td style={{ padding: '12px 16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                {q.counts.active}
              </td>
              <td style={{ padding: '12px 16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                {q.processors.locks}
              </td>
              <td style={{
                padding: '12px 16px',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 13,
                color: q.processors.stalled > 0 ? '#ff3333' : 'inherit',
              }}>
                {q.processors.stalled}
              </td>
              <td style={{
                padding: '12px 16px',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 13,
                color: (q.overdueDelayed || 0) > 0 ? '#ff3333' : 'inherit',
              }}>
                {q.overdueDelayed || 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {queues.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
          No queues discovered yet. Waiting for Redis scan...
        </div>
      )}
    </div>
  );
}
