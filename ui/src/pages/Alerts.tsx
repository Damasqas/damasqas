import { useAnomalies, type AnomalyRecord } from '../hooks/useAnomalies';

const typeLabels: Record<string, string> = {
  failure_spike: 'Failure Spike',
  backlog_growth: 'Backlog Growth',
  processing_slow: 'Slow Processing',
  stalled_job: 'Stalled Jobs',
  queue_idle: 'Queue Idle',
  oldest_waiting: 'Old Waiting Job',
};

const severityColors: Record<string, string> = {
  critical: '#ff3333',
  warning: '#f59e0b',
  info: '#3b82f6',
};

export function Alerts() {
  const { data, isLoading } = useAnomalies();

  if (isLoading) {
    return <div style={{ color: '#666', padding: 40 }}>Loading anomalies...</div>;
  }

  const active = data?.active || [];
  const history = data?.history || [];

  return (
    <div>
      <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
        Active Anomalies
      </h2>
      {active.length === 0 ? (
        <div style={{ color: '#666', padding: 20, textAlign: 'center' }}>
          No active anomalies. All systems normal.
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          {active.map((a) => (
            <AnomalyRow key={a.id} anomaly={a} />
          ))}
        </div>
      )}

      <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 16, marginTop: 32 }}>
        History
      </h2>
      {history.length === 0 ? (
        <div style={{ color: '#666', padding: 20, textAlign: 'center' }}>
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
  const color = severityColors[anomaly.severity] || '#666';
  const resolved = anomaly.resolvedAt !== null;

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: `1px solid ${resolved ? 'rgba(255, 255, 255, 0.06)' : `${color}33`}`,
      borderRadius: 12,
      padding: '12px 16px',
      marginBottom: 8,
      display: 'grid',
      gridTemplateColumns: '120px 1fr 100px 100px 100px',
      alignItems: 'center',
      gap: 16,
      opacity: resolved ? 0.5 : 1,
    }}>
      <div>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color,
          textTransform: 'uppercase',
          background: `${color}15`,
          padding: '2px 8px',
          borderRadius: 6,
        }}>
          {anomaly.severity}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>
          {typeLabels[anomaly.type] || anomaly.type}
        </div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {anomaly.queue} · {new Date(anomaly.timestamp).toLocaleString()}
        </div>
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#ccc' }}>
        {anomaly.currentValue.toFixed(1)}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#666' }}>
        baseline: {anomaly.baselineValue.toFixed(1)}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color }}>
        {anomaly.multiplier.toFixed(1)}×
      </div>
    </div>
  );
}
