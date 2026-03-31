import { useAnomalies, type AnomalyRecord } from '../hooks/useAnomalies';
import { glassCard, sectionLabel, colors } from '../theme';

const typeLabels: Record<string, string> = {
  failure_spike: 'Failure Spike',
  backlog_growth: 'Backlog Growth',
  processing_slow: 'Slow Processing',
  stalled_job: 'Stalled Jobs',
  queue_idle: 'Queue Idle',
  oldest_waiting: 'Old Waiting Job',
};

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: colors.red, text: colors.redText, border: colors.redBorder },
  warning: { bg: colors.amber, text: colors.amberText, border: colors.amberBorder },
  info: { bg: colors.blue, text: colors.blueText, border: colors.blueBorder },
};

export function Alerts() {
  const { data, isLoading } = useAnomalies();

  if (isLoading) {
    return <div style={{ color: colors.textMuted, padding: 40 }}>Loading anomalies...</div>;
  }

  const active = data?.active || [];
  const history = data?.history || [];

  return (
    <div>
      <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 16, letterSpacing: -0.3 }}>
        Active Anomalies
      </h2>
      {active.length === 0 ? (
        <div style={{ color: colors.textMuted, padding: 20, textAlign: 'center' }}>
          No active anomalies. All systems normal.
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          {active.map((a) => (
            <AnomalyRow key={a.id} anomaly={a} />
          ))}
        </div>
      )}

      <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 16, marginTop: 32, letterSpacing: -0.3 }}>
        History
      </h2>
      {history.length === 0 ? (
        <div style={{ color: colors.textMuted, padding: 20, textAlign: 'center' }}>
          No anomaly history yet.
        </div>
      ) : (
        <div>
          {history.map((a) => (
            <AnomalyRow key={a.id} anomaly={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AnomalyRecord }) {
  const sev = severityColors[anomaly.severity] || { bg: colors.textMuted, text: colors.textSecondary, border: 'rgba(255,255,255,0.08)' };
  const resolved = anomaly.resolvedAt !== null;

  return (
    <div style={{
      ...glassCard,
      padding: '12px 16px',
      marginBottom: 8,
      display: 'grid',
      gridTemplateColumns: '120px 1fr 100px 100px 100px',
      alignItems: 'center',
      gap: 16,
      opacity: resolved ? 0.5 : 1,
      borderColor: resolved ? 'rgba(255,255,255,0.08)' : sev.border,
      boxShadow: resolved
        ? 'inset 0 1px 0 rgba(255,255,255,0.06)'
        : `0 2px 12px ${sev.bg}15, inset 0 1px 0 rgba(255,255,255,0.06)`,
    }}>
      <div>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: sev.text,
          textTransform: 'uppercase',
          background: `linear-gradient(135deg, ${sev.bg}22, ${sev.bg}0D)`,
          padding: '2px 8px',
          borderRadius: 6,
          border: `1px solid ${sev.border}`,
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: 0.5,
          boxShadow: `0 0 8px ${sev.bg}30, inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}>
          {anomaly.severity}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>
          {typeLabels[anomaly.type] || anomaly.type}
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted }}>
          {anomaly.queue} · {new Date(anomaly.timestamp).toLocaleString()}
        </div>
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: colors.textSecondary }}>
        {anomaly.currentValue.toFixed(1)}
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: colors.textMuted }}>
        baseline: {anomaly.baselineValue.toFixed(1)}
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: sev.text }}>
        {anomaly.multiplier.toFixed(1)}×
      </div>
    </div>
  );
}
