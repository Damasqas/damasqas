import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { QueueState } from '../hooks/useQueues';
import type { Metric } from '../hooks/useMetrics';

interface CapacityPanelProps {
  queue: QueueState;
  metrics: Metric[];
  range?: '1h' | '6h' | '24h' | '7d';
  domain?: [number, number];
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

function formatTick(ts: number, range?: string): string {
  const d = new Date(ts);
  switch (range) {
    case '7d':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case '24h':
      return d.toLocaleTimeString('en-US', { hour: 'numeric' });
    default:
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}

function formatTooltipLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function CapacityPanel({ queue, metrics, range, domain }: CapacityPanelProps) {
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

  // Derive inflow/drain time-series from existing metrics:
  // drainRate = throughput + failureRate (both completed and failed drain the wait queue)
  // inflowRate = drainRate + backlogGrowthRate (backlog change = inflow - drain)
  const chartData = metrics.map((m) => ({
    time: m.timestamp,
    drainRate: m.throughput + m.failureRate,
    inflowRate: Math.max(0, m.throughput + m.failureRate + m.backlogGrowthRate),
  }));

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
        marginBottom: chartData.length > 1 ? 20 : 0,
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

      {/* Inflow vs Drain Rate Chart */}
      {chartData.length > 1 && (
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Inflow vs Drain Rate
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={domain ?? ['dataMin', 'dataMax']}
                tick={{ fill: '#555', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickFormatter={(ts: number) => formatTick(ts, range)}
              />
              <YAxis
                tick={{ fill: '#555', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a1a1a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={formatTooltipLabel}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#888' }}
              />
              <Line
                type="monotone"
                dataKey="inflowRate"
                name="Inflow"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="drainRate"
                name="Drain"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
