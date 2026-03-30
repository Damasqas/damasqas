import type { QueueState } from '../hooks/useQueues';

interface CapacityPanelProps {
  queue: QueueState;
  snapshots: Array<{ timestamp: number; waiting: number }>;
}

const trendArrows: Record<string, { symbol: string; color: string; label: string }> = {
  draining: { symbol: '\u2193', color: '#22c55e', label: 'Draining' },
  growing: { symbol: '\u2191', color: '#ff3333', label: 'Growing' },
  stable: { symbol: '\u2014', color: '#888', label: 'Stable' },
  stalled: { symbol: '\u23F8', color: '#ff3333', label: 'Stalled' },
};

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function CapacityPanel({ queue }: CapacityPanelProps) {
  const drain = queue.drain;

  if (!drain) {
    return (
      <div style={{
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{
          fontSize: 12,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 16,
        }}>
          Capacity Planning
        </div>
        <div style={{ color: '#555', fontSize: 13 }}>
          Collecting data... (requires at least 2 snapshots)
        </div>
      </div>
    );
  }

  const trend = trendArrows[drain.trend] || trendArrows.stable!;

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
    }}>
      <div style={{
        fontSize: 12,
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 16,
      }}>
        Capacity Planning
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16,
      }}>
        {/* Current Depth + Trend */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Queue Depth
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, color: '#fff', fontFamily: 'IBM Plex Mono, monospace' }}>
              {drain.currentDepth.toLocaleString()}
            </span>
            <span style={{ fontSize: 18, color: trend.color, fontWeight: 600 }} title={trend.label}>
              {trend.symbol}
            </span>
            <span style={{ fontSize: 12, color: trend.color }}>
              {trend.label}
            </span>
          </div>
          {drain.depthDelta !== 0 && (
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
              {drain.depthDelta > 0 ? '+' : ''}{drain.depthDelta} since last window
            </div>
          )}
        </div>

        {/* Inflow vs Drain Rate */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Rates (jobs/min)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#f59e0b' }}>Inflow</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#f59e0b', fontFamily: 'IBM Plex Mono, monospace' }}>
                {drain.inflowRate.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#22c55e' }}>Drain</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#22c55e', fontFamily: 'IBM Plex Mono, monospace' }}>
                {drain.drainRate.toFixed(1)}
              </span>
            </div>
            <div style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              paddingTop: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: '#888' }}>Net</span>
              <span style={{
                fontSize: 16,
                fontWeight: 600,
                fontFamily: 'IBM Plex Mono, monospace',
                color: drain.netRate > 0 ? '#22c55e' : drain.netRate < 0 ? '#ff3333' : '#888',
              }}>
                {drain.netRate > 0 ? '+' : ''}{drain.netRate.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Projected Drain Time */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Time to Drain
          </div>
          {drain.projectedDrainMinutes !== null ? (
            <div>
              <span style={{
                fontSize: 24,
                fontWeight: 600,
                color: '#22c55e',
                fontFamily: 'IBM Plex Mono, monospace',
              }}>
                {formatDuration(drain.projectedDrainMinutes)}
              </span>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                at current net drain rate
              </div>
            </div>
          ) : drain.currentDepth === 0 ? (
            <div>
              <span style={{ fontSize: 18, fontWeight: 600, color: '#22c55e' }}>
                Empty
              </span>
            </div>
          ) : (
            <div>
              <span style={{ fontSize: 18, fontWeight: 600, color: '#ff3333' }}>
                NEVER
              </span>
              {drain.capacityDeficit > 0 && (
                <div style={{ fontSize: 12, color: '#ff3333', marginTop: 4 }}>
                  Need {drain.capacityDeficit}% more capacity
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
