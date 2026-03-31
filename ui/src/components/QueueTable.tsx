import type { QueueState } from '../hooks/useQueues';
import { glassCard, thStyle as baseThStyle, colors, shadows, rowHoverBg, rowHoverShadow } from '../theme';

interface QueueTableProps {
  queues: QueueState[];
  onSelect: (name: string) => void;
}

const statusColors: Record<string, string> = {
  ok: colors.green,
  warning: colors.amber,
  critical: colors.red,
};

const statusGlows: Record<string, string> = {
  ok: shadows.dotHealthy,
  warning: shadows.dotWarning,
  critical: shadows.dotCritical,
};

const trendConfig: Record<string, { symbol: string; color: string; label: string }> = {
  draining: { symbol: '\u2193', color: colors.greenText, label: 'Draining' },
  growing: { symbol: '\u2191', color: colors.redText, label: 'Growing' },
  stable: { symbol: '\u2014', color: colors.textMuted, label: 'Stable' },
  stalled: { symbol: '\u23F8', color: colors.redText, label: 'Stalled' },
};

export function QueueTable({ queues, onSelect }: QueueTableProps) {
  return (
    <div style={{
      ...glassCard,
      overflow: 'hidden',
      padding: 0,
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Queue', 'Status', 'Throughput', 'Failures', 'Waiting', 'Trend', 'Active', 'Locks', 'Stalled', 'Overdue'].map((h) => (
              <th key={h} style={baseThStyle}>
                {h}
              </th>
            ))}
          </tr>
          <tr>
            <td colSpan={10} style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              padding: 0,
            }} />
          </tr>
        </thead>
        <tbody>
          {queues.map((q) => (
            <tr
              key={q.name}
              onClick={() => onSelect(q.name)}
              style={{
                cursor: 'pointer',
                transition: 'all 0.15s',
                borderRadius: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = rowHoverBg;
                e.currentTarget.style.boxShadow = rowHoverShadow;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <td style={{ padding: '9px 16px', fontWeight: 500, color: '#fff' }}>
                {q.name}
                {q.paused && (
                  <span style={{ fontSize: 10, color: colors.textMuted, marginLeft: 8 }}>PAUSED</span>
                )}
              </td>
              <td style={{ padding: '9px 16px' }}>
                <span style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: statusColors[q.status] || colors.textMuted,
                  boxShadow: statusGlows[q.status] || 'none',
                }} />
              </td>
              <td style={{ padding: '9px 16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
                {q.metrics ? `${q.metrics.throughput.toFixed(1)}/m` : '—'}
              </td>
              <td style={{
                padding: '9px 16px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: q.metrics && q.metrics.failureRate > 0 ? colors.redText : 'inherit',
              }}>
                {q.metrics ? `${q.metrics.failureRate.toFixed(1)}/m` : '—'}
              </td>
              <td style={{ padding: '9px 16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
                {q.counts.waiting.toLocaleString()}
              </td>
              <td style={{ padding: '9px 16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
                <TrendCell drain={q.drain} />
              </td>
              <td style={{ padding: '9px 16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
                {q.counts.active}
              </td>
              <td style={{ padding: '9px 16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
                {q.processors.locks}
              </td>
              <td style={{
                padding: '9px 16px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: q.processors.stalled > 0 ? colors.redText : 'inherit',
              }}>
                {q.processors.stalled}
              </td>
              <td style={{
                padding: '9px 16px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: (q.overdueDelayed || 0) > 0 ? colors.redText : 'inherit',
              }}>
                {q.overdueDelayed || 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {queues.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
          No queues discovered yet. Waiting for Redis scan...
        </div>
      )}
    </div>
  );
}

function TrendCell({ drain }: { drain: QueueState['drain'] }) {
  if (!drain) {
    return <span style={{ color: colors.textMuted }}>{'\u2014'}</span>;
  }

  const t = trendConfig[drain.trend] || trendConfig.stable!;
  const tooltip = drain.projectedDrainMinutes !== null
    ? `Clears in ~${Math.round(drain.projectedDrainMinutes)}m`
    : drain.capacityDeficit > 0
      ? `Need ${drain.capacityDeficit}% more capacity`
      : t.label;

  return (
    <span title={tooltip} style={{ color: t.color, fontWeight: 600 }}>
      {t.symbol}
    </span>
  );
}
