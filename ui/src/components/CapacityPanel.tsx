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
import { glassCard, glassCardInner, sectionLabel, chartTooltip, colors } from '../theme';

interface CapacityPanelProps {
  queue: QueueState;
  metrics: Metric[];
  range?: '1h' | '6h' | '24h' | '7d';
  domain?: [number, number];
}

const trendArrows: Record<string, { symbol: string; color: string; label: string }> = {
  draining: { symbol: '\u2193', color: colors.greenText, label: 'Draining' },
  growing: { symbol: '\u2191', color: colors.redText, label: 'Growing' },
  stable: { symbol: '\u2014', color: colors.textSecondary, label: 'Stable' },
  stalled: { symbol: '\u23F8', color: colors.redText, label: 'Stalled' },
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
        ...glassCard,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{
          ...sectionLabel,
          fontSize: 9,
          marginBottom: 16,
        }}>
          Capacity Planning
        </div>
        <div style={{ color: colors.textMuted, fontSize: 13 }}>
          Collecting data... (requires at least 2 snapshots)
        </div>
      </div>
    );
  }

  const trend = trendArrows[drain.trend] || trendArrows.stable!;

  const chartData = metrics.map((m) => ({
    time: m.timestamp,
    drainRate: m.throughput + m.failureRate,
    inflowRate: Math.max(0, m.throughput + m.failureRate + m.backlogGrowthRate),
  }));

  return (
    <div style={{
      ...glassCard,
      padding: 20,
      marginBottom: 24,
    }}>
      <div style={{
        ...sectionLabel,
        fontSize: 9,
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
          ...glassCardInner,
          padding: 16,
        }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>
            Queue Depth
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>
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
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
              {drain.depthDelta > 0 ? '+' : ''}{drain.depthDelta} since last window
            </div>
          )}
        </div>

        {/* Inflow vs Drain Rate */}
        <div style={{
          ...glassCardInner,
          padding: 16,
        }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>
            Rates (jobs/min)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: colors.amberText }}>Inflow</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: colors.amberText, fontFamily: "'IBM Plex Mono', monospace" }}>
                {drain.inflowRate.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: colors.greenText }}>Drain</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: colors.greenText, fontFamily: "'IBM Plex Mono', monospace" }}>
                {drain.drainRate.toFixed(1)}
              </span>
            </div>
            <div style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              margin: '2px 0',
            }} />
            <div style={{
              paddingTop: 2,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: colors.textSecondary }}>Net</span>
              <span style={{
                fontSize: 16,
                fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace",
                color: drain.netRate > 0 ? colors.greenText : drain.netRate < 0 ? colors.redText : colors.textSecondary,
              }}>
                {drain.netRate > 0 ? '+' : ''}{drain.netRate.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Projected Drain Time */}
        <div style={{
          ...glassCardInner,
          padding: 16,
        }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>
            Time to Drain
          </div>
          {drain.projectedDrainMinutes !== null ? (
            <div>
              <span style={{
                fontSize: 24,
                fontWeight: 600,
                color: colors.greenText,
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                {formatDuration(drain.projectedDrainMinutes)}
              </span>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                at current net drain rate
              </div>
            </div>
          ) : drain.currentDepth === 0 ? (
            <div>
              <span style={{ fontSize: 18, fontWeight: 600, color: colors.greenText }}>
                Empty
              </span>
            </div>
          ) : (
            <div>
              <span style={{ fontSize: 18, fontWeight: 600, color: colors.redText }}>
                NEVER
              </span>
              {drain.capacityDeficit > 0 && (
                <div style={{ fontSize: 12, color: colors.redText, marginTop: 4 }}>
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
          ...glassCardInner,
          padding: 16,
        }}>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>
            Inflow vs Drain Rate
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={domain ?? ['dataMin', 'dataMax']}
                tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickFormatter={(ts: number) => formatTick(ts, range)}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              />
              <Tooltip
                contentStyle={chartTooltip}
                labelFormatter={formatTooltipLabel}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: colors.textSecondary }}
              />
              <Line
                type="monotone"
                dataKey="inflowRate"
                name="Inflow"
                stroke={colors.amber}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="drainRate"
                name="Drain"
                stroke={colors.green}
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
