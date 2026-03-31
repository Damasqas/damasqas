import type { AnomalyRecord } from '../hooks/useAnomalies';
import { colors, shadows } from '../theme';

interface AlertBannerProps {
  anomalies: AnomalyRecord[];
  onClick?: () => void;
}

export function AlertBanner({ anomalies, onClick }: AlertBannerProps) {
  const critical = anomalies.filter((a) => a.severity === 'critical');
  if (critical.length === 0) return null;

  return (
    <div
      onClick={onClick}
      style={{
        background: 'linear-gradient(135deg, rgba(185,28,28,0.08), rgba(185,28,28,0.03))',
        border: `1px solid ${colors.redBorder}`,
        borderRadius: 12,
        padding: '10px 14px',
        marginBottom: 20,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.alertCritical,
      }}
    >
      <span style={{ fontSize: 20 }}>⚠</span>
      <div>
        <div style={{ color: colors.redText, fontWeight: 600, fontSize: 14 }}>
          {critical.length} critical anomal{critical.length === 1 ? 'y' : 'ies'} detected
        </div>
        <div style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
          {critical.map((a) => `${a.queue}: ${a.type}`).join(' · ')}
        </div>
      </div>
    </div>
  );
}
