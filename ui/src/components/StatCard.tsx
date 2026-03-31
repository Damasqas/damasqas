import type { TrendInfo } from '../hooks/useComparison';
import { glassCard, sectionLabel, colors, shadows } from '../theme';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  critical?: boolean;
  trends?: { period: string; trend: TrendInfo | null }[];
}

const TREND_COLORS: Record<string, string> = {
  good: colors.greenText,
  bad: colors.redText,
  neutral: colors.textMuted,
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
      ...glassCard,
      padding: '14px 18px',
      borderColor: critical ? colors.redBorder : 'rgba(255,255,255,0.08)',
      boxShadow: critical
        ? `0 4px 24px rgba(0,0,0,0.3), 0 2px 12px ${colors.redGlow}, inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -0.5px 0 rgba(255,255,255,0.03)`
        : shadows.card,
    }}>
      <div style={{
        ...sectionLabel,
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 18,
        fontWeight: 700,
        color: critical ? colors.redText : '#fff',
        fontFamily: "'IBM Plex Mono', monospace",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
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
                fontFamily: "'IBM Plex Mono', monospace",
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
