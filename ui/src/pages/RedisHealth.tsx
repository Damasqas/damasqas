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
import {
  glassCard,
  glassCardInner,
  sectionLabel,
  chartTooltip,
  filterBtn,
  filterBtnActive,
  colors,
  rowHoverBg,
  rowHoverShadow,
  thStyle as baseThStyle,
  tdStyle as baseTdStyle,
} from '../theme';

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
    return <div style={{ color: colors.textMuted, padding: 40 }}>Loading Redis health...</div>;
  }

  const snapshot = health?.snapshot;

  if (!snapshot) {
    return (
      <div style={{ color: colors.textMuted, padding: 40, textAlign: 'center' }}>
        <div style={{ marginBottom: 8, color: colors.textSecondary }}>Collecting Redis health data...</div>
        <div style={{ fontSize: 12 }}>
          Health snapshots begin after the first collector analysis cycle (~10s).
        </div>
      </div>
    );
  }
  const oom = health?.oomProjection;
  const warning = health?.maxmemoryPolicyWarning;
  const growth = health?.topGrowthContributors || [];

  const memPercent = snapshot && snapshot.maxmemory > 0
    ? Math.round((snapshot.usedMemory / snapshot.maxmemory) * 100)
    : null;

  const memColor = memPercent === null
    ? colors.textSecondary
    : memPercent >= 90
      ? colors.red
      : memPercent >= 75
        ? colors.amber
        : colors.green;

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
          background: 'linear-gradient(135deg, rgba(217,119,6,0.1), rgba(217,119,6,0.04))',
          border: `1px solid ${colors.amberBorder}`,
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 24,
          fontSize: 13,
          color: colors.amberText,
          lineHeight: 1.5,
          boxShadow: `0 2px 12px ${colors.amberGlow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
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
            ? snapshot.memFragmentationRatio < 1.0
              ? 'using swap'
              : snapshot.usedMemory < 10 * 1024 * 1024
                ? 'normal at low memory'
                : snapshot.memFragmentationRatio > 1.5
                  ? 'high fragmentation'
                  : 'healthy'
            : undefined}
          critical={snapshot?.memFragmentationRatio != null &&
            snapshot.usedMemory >= 10 * 1024 * 1024 && (
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
        ...glassCard,
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
            ...sectionLabel,
            fontSize: 9,
          }}>
            Memory Usage Over Time
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1h', '6h', '24h', '7d'] as Range[]).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setRange(r)}
                style={{
                  ...(range === r ? filterBtnActive : filterBtn),
                  padding: '4px 10px',
                  fontSize: 11,
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
                tickFormatter={(v: number) => formatBytesShort(v)}
              />
              <Tooltip
                contentStyle={chartTooltip}
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
                  stroke="rgba(255,255,255,0.15)"
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
          <div style={{ color: colors.textMuted, fontSize: 13, padding: 20 }}>
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
      ...glassCard,
      padding: 20,
    }}>
      <div style={{
        ...sectionLabel,
        fontSize: 9,
        marginBottom: 16,
      }}>
        Top Growth Contributors
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={baseThStyle}>Queue</th>
            <th style={baseThStyle}>Key</th>
            <th style={{ ...baseThStyle, textAlign: 'right' }}>Entries</th>
            <th style={{ ...baseThStyle, textAlign: 'right' }}>Growth</th>
            <th style={{ ...baseThStyle, textAlign: 'right' }}>Memory</th>
          </tr>
          <tr>
            <td colSpan={5} style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              padding: 0,
            }} />
          </tr>
        </thead>
        <tbody>
          {growth.slice(0, 10).map((g) => (
            <Fragment key={`${g.queue}:${g.keyType}`}>
            <tr
              onMouseEnter={(e) => { e.currentTarget.style.background = rowHoverBg; e.currentTarget.style.boxShadow = rowHoverShadow; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <td style={baseTdStyle}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{g.queue}</span>
              </td>
              <td style={baseTdStyle}>
                <span style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
                  padding: '2px 6px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                  border: '1px solid rgba(255,255,255,0.06)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                }}>
                  {g.keyType}
                </span>
              </td>
              <td style={{ ...baseTdStyle, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                {g.entries.toLocaleString()}
              </td>
              <td style={{
                ...baseTdStyle,
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                color: g.entryDelta > 0 ? colors.redText : colors.textSecondary,
              }}>
                {g.entryDelta > 0 ? `+${g.entryDelta.toLocaleString()}` : g.entryDelta.toLocaleString()}
              </td>
              <td style={{
                ...baseTdStyle,
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                {g.memoryBytes != null ? formatBytesShort(g.memoryBytes) : '--'}
                {g.memoryDelta != null && g.memoryDelta > 0 && (
                  <span style={{ color: colors.redText, fontSize: 10, marginLeft: 4 }}>
                    +{formatBytesShort(g.memoryDelta)}
                  </span>
                )}
              </td>
            </tr>
            {g.recommendation && (
              <tr>
                <td colSpan={5} style={{
                  padding: '4px 12px 10px',
                  fontSize: 11,
                  color: colors.amberText,
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
      ...glassCard,
      padding: 20,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{
          ...sectionLabel,
          fontSize: 9,
        }}>
          Key Sizes by Queue
        </div>
        {collectedAt && (
          <div style={{ fontSize: 10, color: colors.textMuted }}>
            {new Date(collectedAt).toLocaleTimeString()}
          </div>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={baseThStyle}>Queue</th>
            <th style={{ ...baseThStyle, textAlign: 'right' }}>Total Entries</th>
            <th style={{ ...baseThStyle, textAlign: 'right' }}>Memory</th>
          </tr>
          <tr>
            <td colSpan={3} style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              padding: 0,
            }} />
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 15).map(([queue, data]) => (
            <tr
              key={queue}
              onMouseEnter={(e) => { e.currentTarget.style.background = rowHoverBg; e.currentTarget.style.boxShadow = rowHoverShadow; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <td style={baseTdStyle}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{queue}</span>
              </td>
              <td style={{ ...baseTdStyle, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                {data.entries.toLocaleString()}
              </td>
              <td style={{ ...baseTdStyle, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
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
      ...glassCard,
      padding: 20,
    }}>
      <div style={{
        ...sectionLabel,
        fontSize: 9,
        marginBottom: 16,
      }}>
        Slow Commands
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={baseThStyle}>Time</th>
            <th style={{ ...baseThStyle, textAlign: 'right' }}>Duration</th>
            <th style={baseThStyle}>Command</th>
            <th style={baseThStyle}>BullMQ</th>
          </tr>
          <tr>
            <td colSpan={4} style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              padding: 0,
            }} />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr
              key={i}
              style={{
                background: entry.isBullMQ ? 'linear-gradient(135deg, rgba(185,28,28,0.04), rgba(185,28,28,0.01))' : 'transparent',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = rowHoverBg; e.currentTarget.style.boxShadow = rowHoverShadow; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = entry.isBullMQ ? 'linear-gradient(135deg, rgba(185,28,28,0.04), rgba(185,28,28,0.01))' : 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <td style={{ ...baseTdStyle, whiteSpace: 'nowrap' }}>
                {new Date(entry.ts).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </td>
              <td style={{
                ...baseTdStyle,
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                color: entry.durationUs > 100000 ? colors.redText : entry.durationUs > 10000 ? colors.amberText : colors.textSecondary,
              }}>
                {entry.durationUs >= 1000
                  ? `${(entry.durationUs / 1000).toFixed(1)}ms`
                  : `${entry.durationUs}us`}
              </td>
              <td style={{
                ...baseTdStyle,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                maxWidth: 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {entry.command}
              </td>
              <td style={baseTdStyle}>
                {entry.isBullMQ && (
                  <span style={{
                    background: 'linear-gradient(135deg, rgba(185,28,28,0.18), rgba(185,28,28,0.06))',
                    color: colors.redText,
                    padding: '2px 6px',
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    border: `1px solid ${colors.redBorder}`,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
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
