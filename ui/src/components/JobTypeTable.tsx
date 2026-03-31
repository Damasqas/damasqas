import { useState } from 'react';
import type { JobTypeBreakdown } from '../hooks/useJobTypes';
import { glassCard, thStyle as baseThStyle, colors, rowHoverBg, rowHoverShadow } from '../theme';

interface JobTypeTableProps {
  breakdown: JobTypeBreakdown[];
}

type SortKey = 'jobName' | 'completed' | 'failed' | 'failRatePct' | 'avgWaitMs' | 'avgProcessMs' | 'p95ProcessMs';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'jobName', label: 'Job Type' },
  { key: 'completed', label: 'Completed', align: 'right' },
  { key: 'failed', label: 'Failed', align: 'right' },
  { key: 'failRatePct', label: 'Fail Rate', align: 'right' },
  { key: 'avgWaitMs', label: 'Avg Wait', align: 'right' },
  { key: 'avgProcessMs', label: 'Avg Process', align: 'right' },
  { key: 'p95ProcessMs', label: 'P95 Process', align: 'right' },
];

function formatMs(ms: number | null): string {
  if (ms === null) return '\u2014';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function JobTypeTable({ breakdown }: JobTypeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('failed');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'jobName');
    }
  };

  const sorted = [...breakdown].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div style={{
      ...glassCard,
      overflow: 'hidden',
      marginTop: 24,
      padding: 0,
    }}>
      <div style={{
        padding: '14px 16px',
        fontSize: 14,
        fontWeight: 600,
        color: '#fff',
        letterSpacing: -0.3,
      }}>
        Job Type Breakdown
      </div>
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
      }} />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  ...baseThStyle,
                  textAlign: col.align || 'left',
                  color: sortKey === col.key ? colors.redText : 'rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {col.label}
                {sortKey === col.key && (
                  <span style={{ marginLeft: 4 }}>{sortAsc ? '\u2191' : '\u2193'}</span>
                )}
              </th>
            ))}
          </tr>
          <tr>
            <td colSpan={7} style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              padding: 0,
            }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.jobName}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = rowHoverBg;
                e.currentTarget.style.boxShadow = rowHoverShadow;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <td style={{
                padding: '9px 16px',
                fontWeight: 500,
                color: '#fff',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
              }}>
                {row.jobName}
              </td>
              <td style={{
                padding: '9px 16px',
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: colors.greenText,
              }}>
                {row.completed.toLocaleString()}
              </td>
              <td style={{
                padding: '9px 16px',
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: row.failed > 0 ? colors.redText : 'inherit',
              }}>
                {row.failed.toLocaleString()}
              </td>
              <td style={{
                padding: '9px 16px',
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: row.failRatePct > 10 ? colors.redText : row.failRatePct > 5 ? colors.amberText : 'inherit',
              }}>
                {row.failRatePct.toFixed(1)}%
              </td>
              <td style={{
                padding: '9px 16px',
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
              }}>
                {formatMs(row.avgWaitMs)}
              </td>
              <td style={{
                padding: '9px 16px',
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
              }}>
                {formatMs(row.avgProcessMs)}
              </td>
              <td style={{
                padding: '9px 16px',
                textAlign: 'right',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
              }}>
                {formatMs(row.p95ProcessMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {breakdown.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          No job type data available yet. Waiting for completed events...
        </div>
      )}
    </div>
  );
}
