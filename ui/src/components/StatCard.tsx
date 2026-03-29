interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  critical?: boolean;
}

export function StatCard({ label, value, sub, critical }: StatCardProps) {
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
    </div>
  );
}
