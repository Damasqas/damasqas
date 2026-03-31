import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { glassCard, sectionLabel, chartTooltip } from '../theme';

type Range = '1h' | '6h' | '24h' | '7d';

interface ChartProps {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  title: string;
  color?: string;
  baselineKey?: string;
  domain?: [number, number];
  range?: Range;
}

function formatTick(ts: number, range?: Range): string {
  const d = new Date(ts);
  switch (range) {
    case '7d':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case '24h':
      return d.toLocaleTimeString('en-US', { hour: 'numeric' });
    case '6h':
    case '1h':
    default:
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}

function formatTooltipLabel(ts: number, range?: Range): string {
  const d = new Date(ts);
  if (range === '7d') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function getTickCount(range?: Range): number {
  switch (range) {
    case '7d': return 7;
    case '24h': return 8;
    case '6h': return 6;
    case '1h': return 6;
    default: return 6;
  }
}

export function Chart({ data, dataKey, title, color = '#dc2626', baselineKey, domain, range }: ChartProps) {
  return (
    <div style={{
      ...glassCard,
      padding: 20,
    }}>
      <div style={{
        ...sectionLabel,
        fontSize: 9,
        marginBottom: 16,
      }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={domain ?? ['dataMin', 'dataMax']}
            tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickFormatter={(ts: number) => formatTick(ts, range)}
            tickCount={getTickCount(range)}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
          />
          <Tooltip
            contentStyle={chartTooltip}
            labelFormatter={(ts: number) => formatTooltipLabel(ts, range)}
          />
          {baselineKey && (
            <Area
              type="monotone"
              dataKey={baselineKey}
              stroke="rgba(255,255,255,0.15)"
              fill="none"
              strokeDasharray="4 4"
            />
          )}
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={`url(#grad-${dataKey})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
