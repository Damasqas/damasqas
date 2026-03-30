import type { TrendInfo } from '../hooks/useComparison';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  critical?: boolean;
  trends?: { period: string; trend: TrendInfo | null }[];
}

const TREND_COLORS: Record<string, string> = {
  good: '#22c55e',
  bad: '#ff3333',
  neutral: '#666',
};

const TREND_ARROWS: Record<string, string> = {
  up: '\u2191',
  down: '\u2193',
  stable: '\u2192',
};

export function StatCard({ label, value, sub, critical, trends }: StatCardProps) {
  const activeTrends = trends?.filter((t) => t.trend != null) ?? [];

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.03)',
      border: `1px solid ${critical ? 'rgba(255, 51, 51, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
      borderRadius: 12,
      padding: '16px 20px',
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{
        fontSize: 12,
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: critical ? '#ff3333' : '#fff',
        fontFamily: 'IBM Plex Mono, monospace',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
          {sub}
        </div>
      )}
      {activeTrends.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {activeTrends.map(({ period, trend }) => (
            <div
              key={period}
              style={{
                fontSize: 11,
                color: TREND_COLORS[trend!.sentiment],
                fontFamily: 'IBM Plex Mono, monospace',
                lineHeight: 1.6,
              }}
            >
              {TREND_ARROWS[trend!.direction]} {trend!.label} {period}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
