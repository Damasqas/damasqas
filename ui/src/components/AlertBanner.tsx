import type { AnomalyRecord } from '../hooks/useAnomalies';

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
        background: 'rgba(255, 51, 51, 0.1)',
        border: '1px solid rgba(255, 51, 51, 0.3)',
        borderRadius: 12,
        padding: '12px 20px',
        marginBottom: 20,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 20 }}>⚠</span>
      <div>
        <div style={{ color: '#ff3333', fontWeight: 600, fontSize: 14 }}>
          {critical.length} critical anomal{critical.length === 1 ? 'y' : 'ies'} detected
        </div>
        <div style={{ color: '#999', fontSize: 12, marginTop: 2 }}>
          {critical.map((a) => `${a.queue}: ${a.type}`).join(' · ')}
        </div>
      </div>
    </div>
  );
}
