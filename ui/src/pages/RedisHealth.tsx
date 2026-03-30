import { Fragment, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { StatCard } from '../components/StatCard';
import {
  useRedisHealth,
  useRedisHistory,
  useRedisKeySizes,
  useRedisSlowlog,
} from '../hooks/useRedisHealth';
import type { KeyGrowth, SlowlogEntry } from '../hooks/useRedisHealth';

type Range = '1h' | '6h' | '24h' | '7d';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function formatBytesShort(bytes: number): string {
  if (bytes === 0) return '0';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return val >= 100 ? `${Math.round(val)}${units[i]}` : `${val.toFixed(1)}${units[i]}`;
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const remaining = Math.round(hours % 24);
  return remaining > 0 ? `${days}d ${remaining}h` : `${days}d`;
}

function formatTick(ts: number, range?: Range): string {
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

function getTickCount(range?: Range): number {
  switch (range) {
    case '7d': return 7;
    case '24h': return 8;
    case '6h': return 6;
    default: return 6;
  }
}

export function RedisHealth() {
  const [range, setRange] = useState<Range>('1h');
  const { data: health, isLoading } = useRedisHealth();
  const { data: history } = useRedisHistory(range);
  const { data: keySizeData } = useRedisKeySizes();
  const { data: slowlogData } = useRedisSlowlog();

  if (isLoading) {
    return <div style={{ color: '#666', padding: 40 }}>Loading Redis health...</div>;
  }

  const snapshot = health?.snapshot;
  const oom = health?.oomProjection;
  const warning = health?.maxmemoryPolicyWarning;
  const growth = health?.topGrowthContributors || [];

  const memPercent = snapshot && snapshot.maxmemory > 0
    ? Math.round((snapshot.usedMemory / snapshot.maxmemory) * 100)
    : null;

  const memColor = memPercent === null
    ? '#888'
    : memPercent >= 90
      ? '#ff3333'
      : memPercent >= 75
        ? '#f59e0b'
        : '#22c55e';

  // Chart data
  const chartData = (history?.snapshots || []).map((s) => ({
    time: s.ts,
    usedMemory: s.usedMemory,
    maxmemory: s.maxmemory > 0 ? s.maxmemory : undefined,
  }));

  const domain: [number, number] | undefined = history
    ? [history.since, history.until]
    : undefined;

  return (
    <div>
      {/* Maxmemory Policy Warning Banner */}
      {warning && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 24,
          fontSize: 13,
          color: '#f59e0b',
          lineHeight: 1.5,
        }}>
          <strong>WARNING:</strong> {warning}
        </div>
      )}

      {/* Stat Cards Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <StatCard
          label="Memory Usage"
          value={snapshot ? formatBytesShort(snapshot.usedMemory) : '--'}
          sub={memPercent !== null
            ? `${memPercent}% of ${formatBytesShort(snapshot!.maxmemory)}`
            : snapshot ? 'no maxmemory limit' : undefined}
          critical={memPercent !== null && memPercent >= 80}
        />
        <StatCard
          label="Memory Peak"
          value={snapshot ? formatBytesShort(snapshot.usedMemoryPeak) : '--'}
        />
        <StatCard
          label="Fragmentation"
          value={snapshot?.memFragmentationRatio?.toFixed(2) ?? '--'}
          sub={snapshot?.memFragmentationRatio
            ? snapshot.memFragmentationRatio > 1.5
              ? 'high fragmentation'
              : snapshot.memFragmentationRatio < 1.0
                ? 'using swap'
                : 'healthy'
            : undefined}
          critical={snapshot?.memFragmentationRatio != null && (
            snapshot.memFragmentationRatio > 1.5 || snapshot.memFragmentationRatio < 1.0
          )}
        />
        <StatCard
          label="Clients"
          value={snapshot?.connectedClients ?? '--'}
        />
        <StatCard
          label="Ops/sec"
          value={snapshot?.opsPerSec?.toLocaleString() ?? '--'}
        />
        <StatCard
          label="Total Keys"
          value={snapshot?.totalKeys?.toLocaleString() ?? '--'}
        />
        {oom && (
          <StatCard
            label="OOM Projection"
            value={oom.hoursUntilOOM !== null
              ? formatDuration(oom.hoursUntilOOM)
              : 'N/A'}
            sub={oom.growthRateMBPerHour !== 0
              ? `${oom.growthRateMBPerHour > 0 ? '+' : ''}${oom.growthRateMBPerHour} MB/hr`
              : memPercent === null ? 'no maxmemory set' : 'memory stable'}
            critical={oom.hoursUntilOOM !== null && oom.hoursUntilOOM < 12}
          />
        )}
      </div>

      {/* Memory Timeline Chart */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 12,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}>
            Memory Usage Over Time
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1h', '6h', '24h', '7d'] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  background: range === r ? 'rgba(255, 51, 51, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: `1px solid ${range === r ? 'rgba(255, 51, 51, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: range === r ? '#ff3333' : '#888',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="grad-memory" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={memColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={memColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={domain ?? ['dataMin', 'dataMax']}
                tick={{ fill: '#555', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickFormatter={(ts: number) => formatTick(ts, range)}
                tickCount={getTickCount(range)}
              />
              <YAxis
                tick={{ fill: '#555', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickFormatter={(v: number) => formatBytesShort(v)}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a1a1a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={formatTooltipLabel}
                formatter={(value: number, name: string) => [
                  formatBytes(value),
                  name === 'usedMemory' ? 'Used Memory' : 'Max Memory',
                ]}
              />
              {chartData.some((d) => d.maxmemory) && (
                <Area
                  type="monotone"
                  dataKey="maxmemory"
                  stroke="#444"
                  fill="none"
                  strokeDasharray="4 4"
                  name="maxmemory"
                />
              )}
              <Area
                type="monotone"
                dataKey="usedMemory"
                stroke={memColor}
                fill="url(#grad-memory)"
                strokeWidth={2}
                name="usedMemory"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ color: '#555', fontSize: 13, padding: 20 }}>
            Collecting data...
          </div>
        )}
      </div>

      {/* Key Growth Contributors & Key Sizes */}
      {(growth.length > 0 || (keySizeData && keySizeData.keySizes.length > 0)) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: growth.length > 0 && keySizeData && keySizeData.keySizes.length > 0
            ? '1fr 1fr'
            : '1fr',
          gap: 24,
          marginBottom: 24,
        }}>
          {growth.length > 0 && (
            <GrowthTable growth={growth} />
          )}
          {keySizeData && keySizeData.keySizes.length > 0 && (
            <KeySizeTable
              keySizes={keySizeData.keySizes}
              collectedAt={keySizeData.collectedAt}
            />
          )}
        </div>
      )}

      {/* Slowlog Table */}
      {slowlogData && slowlogData.entries.length > 0 && (
        <SlowlogTable entries={slowlogData.entries} />
      )}
    </div>
  );
}

function GrowthTable({ growth }: { growth: KeyGrowth[] }) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{
        fontSize: 12,
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 16,
      }}>
        Top Growth Contributors
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th style={thStyle}>Queue</th>
            <th style={thStyle}>Key</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Entries</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Growth</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Memory</th>
          </tr>
        </thead>
        <tbody>
          {growth.slice(0, 10).map((g) => (
            <Fragment key={`${g.queue}:${g.keyType}`}>
            <tr style={{ borderBottom: g.recommendation ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
              <td style={tdStyle}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{g.queue}</span>
              </td>
              <td style={tdStyle}>
                <span style={{
                  background: 'rgba(255,255,255,0.06)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'IBM Plex Mono, monospace',
                }}>
                  {g.keyType}
                </span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace' }}>
                {g.entries.toLocaleString()}
              </td>
              <td style={{
                ...tdStyle,
                textAlign: 'right',
                fontFamily: 'IBM Plex Mono, monospace',
                color: g.entryDelta > 0 ? '#ff3333' : '#888',
              }}>
                {g.entryDelta > 0 ? `+${g.entryDelta.toLocaleString()}` : g.entryDelta.toLocaleString()}
              </td>
              <td style={{
                ...tdStyle,
                textAlign: 'right',
                fontFamily: 'IBM Plex Mono, monospace',
              }}>
                {g.memoryBytes != null ? formatBytesShort(g.memoryBytes) : '--'}
                {g.memoryDelta != null && g.memoryDelta > 0 && (
                  <span style={{ color: '#ff3333', fontSize: 10, marginLeft: 4 }}>
                    +{formatBytesShort(g.memoryDelta)}
                  </span>
                )}
              </td>
            </tr>
            {g.recommendation && (
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td colSpan={5} style={{
                  padding: '4px 12px 10px',
                  fontSize: 11,
                  color: '#f59e0b',
                  fontStyle: 'italic',
                }}>
                  {g.recommendation}
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeySizeTable({ keySizes, collectedAt }: {
  keySizes: Array<{ queue: string; keyType: string; entryCount: number; memoryBytes: number | null }>;
  collectedAt: number | null;
}) {
  // Aggregate by queue
  const queueMap = new Map<string, { entries: number; memory: number }>();
  for (const ks of keySizes) {
    const existing = queueMap.get(ks.queue) || { entries: 0, memory: 0 };
    existing.entries += ks.entryCount;
    if (ks.memoryBytes != null) existing.memory += ks.memoryBytes;
    queueMap.set(ks.queue, existing);
  }

  const sorted = [...queueMap.entries()].sort((a, b) => b[1].entries - a[1].entries);

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{
          fontSize: 12,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          Key Sizes by Queue
        </div>
        {collectedAt && (
          <div style={{ fontSize: 10, color: '#555' }}>
            {new Date(collectedAt).toLocaleTimeString()}
          </div>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th style={thStyle}>Queue</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Entries</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Memory</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 15).map(([queue, data]) => (
            <tr key={queue} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={tdStyle}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{queue}</span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace' }}>
                {data.entries.toLocaleString()}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace' }}>
                {data.memory > 0 ? formatBytesShort(data.memory) : '--'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlowlogTable({ entries }: { entries: SlowlogEntry[] }) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{
        fontSize: 12,
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 16,
      }}>
        Slow Commands
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th style={thStyle}>Time</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Duration</th>
            <th style={thStyle}>Command</th>
            <th style={thStyle}>BullMQ</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr
              key={i}
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: entry.isBullMQ ? 'rgba(255, 51, 51, 0.04)' : 'transparent',
              }}
            >
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {new Date(entry.ts).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </td>
              <td style={{
                ...tdStyle,
                textAlign: 'right',
                fontFamily: 'IBM Plex Mono, monospace',
                color: entry.durationUs > 100000 ? '#ff3333' : entry.durationUs > 10000 ? '#f59e0b' : '#e0e0e0',
              }}>
                {entry.durationUs >= 1000
                  ? `${(entry.durationUs / 1000).toFixed(1)}ms`
                  : `${entry.durationUs}us`}
              </td>
              <td style={{
                ...tdStyle,
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 11,
                maxWidth: 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {entry.command}
              </td>
              <td style={tdStyle}>
                {entry.isBullMQ && (
                  <span style={{
                    background: 'rgba(255, 51, 51, 0.15)',
                    color: '#ff3333',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                  }}>
                    BullMQ
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 11,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  color: '#e0e0e0',
};
