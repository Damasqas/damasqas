import { useState, useMemo, useEffect, useRef } from 'react';
import { useEvents, useEventSearch, type EventRecord } from '../hooks/useEvents';
import { useQueues } from '../hooks/useQueues';
import {
  glassCard,
  glassBtn,
  glassInput,
  glassSelect,
  codeBlock,
  filterBtn,
  filterBtnActive,
  glassBtnRed,
  colors,
  rowHoverBg,
  sectionLabel,
} from '../theme';

type Range = '1h' | '6h' | '24h' | '7d';

const RANGE_MS: Record<Range, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const EVENT_TYPES = [
  'completed', 'failed', 'added', 'waiting', 'active',
  'delayed', 'stalled', 'progress', 'removed', 'drained',
  'error', 'duplicated', 'cleaned', 'paused', 'resumed',
];

const eventTypeColors: Record<string, { bg: string; text: string }> = {
  completed: { bg: colors.green, text: colors.greenText },
  failed: { bg: colors.red, text: colors.redText },
  stalled: { bg: colors.amber, text: colors.amberText },
  active: { bg: colors.blue, text: colors.blueText },
  added: { bg: colors.purple, text: colors.purpleText },
  waiting: { bg: 'rgba(255,255,255,0.15)', text: colors.textSecondary },
  delayed: { bg: colors.amber, text: colors.amberText },
  progress: { bg: colors.blue, text: colors.blueText },
  removed: { bg: colors.red, text: colors.redText },
  drained: { bg: 'rgba(255,255,255,0.1)', text: colors.textMuted },
  error: { bg: colors.red, text: colors.redText },
  duplicated: { bg: colors.purple, text: colors.purpleText },
  cleaned: { bg: 'rgba(255,255,255,0.1)', text: colors.textMuted },
  paused: { bg: colors.amber, text: colors.amberText },
  resumed: { bg: colors.green, text: colors.greenText },
};

const PAGE_SIZE = 50;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function EventTimeline() {
  const [range, setRange] = useState<Range>('1h');
  const [queueFilter, setQueueFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [jobNameInput, setJobNameInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const debouncedJobName = useDebouncedValue(jobNameInput, 400);

  const prevJobName = useRef(debouncedJobName);
  useEffect(() => {
    if (prevJobName.current !== debouncedJobName) {
      prevJobName.current = debouncedJobName;
      setOffset(0);
    }
  }, [debouncedJobName]);

  const { data: queuesData } = useQueues();
  const queueNames = useMemo(
    () => (queuesData?.queues || []).map((q) => q.name).sort(),
    [queuesData],
  );

  const { data: eventsData, isLoading } = useEvents({
    rangeMs: RANGE_MS[range],
    limit: PAGE_SIZE,
    offset,
    queue: queueFilter || undefined,
    type: typeFilter || undefined,
    jobName: debouncedJobName || undefined,
  });

  const { data: searchData } = useEventSearch({
    query: searchQuery,
    limit: PAGE_SIZE,
    offset,
    queue: queueFilter || undefined,
    type: typeFilter || undefined,
    rangeMs: RANGE_MS[range],
  });

  const events = searchQuery ? (searchData?.events || []) : (eventsData?.events || []);
  const total = searchQuery ? (searchData?.total || 0) : (eventsData?.total || 0);
  const isSearchMode = searchQuery.length > 0;

  const resetPagination = () => setOffset(0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>
          Event Timeline
        </h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {(Object.keys(RANGE_MS) as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => { setRange(r); resetPagination(); }}
              style={{
                ...(range === r ? filterBtnActive : filterBtn),
                padding: '4px 12px',
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }}>
          {total.toLocaleString()} events
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <select
          value={queueFilter}
          onChange={(e) => { setQueueFilter(e.target.value); resetPagination(); }}
          style={glassSelect}
        >
          <option value="">All queues</option>
          {queueNames.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); resetPagination(); }}
          style={glassSelect}
        >
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by job name..."
          value={jobNameInput}
          onChange={(e) => setJobNameInput(e.target.value)}
          style={{ ...glassInput, minWidth: 150 }}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearchQuery(searchInput);
            resetPagination();
          }}
          style={{ display: 'flex', gap: 4 }}
        >
          <input
            type="text"
            placeholder="Full-text search..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ ...glassInput, minWidth: 150 }}
          />
          <button type="submit" style={{
            ...glassBtnRed,
            padding: '6px 12px',
            fontSize: 12,
            fontFamily: 'inherit',
          }}>
            Search
          </button>
          {isSearchMode && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearchQuery(''); }}
              style={{
                ...glassBtn,
                padding: '6px 12px',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Event list */}
      {isLoading ? (
        <div style={{ color: colors.textMuted, padding: 40, textAlign: 'center' }}>
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <div style={{ color: colors.textMuted, padding: 40, textAlign: 'center' }}>
          No events found for the selected filters.
        </div>
      ) : (
        <div>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '160px 100px 140px 100px 1fr',
            gap: 12,
            padding: '8px 16px',
            ...sectionLabel,
            fontSize: 9,
          }}>
            <div>Time</div>
            <div>Type</div>
            <div>Queue</div>
            <div>Job ID</div>
            <div>Job Name</div>
          </div>
          <div style={{
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
            marginBottom: 2,
          }} />

          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              expanded={expandedId === event.id}
              onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 16,
          marginTop: 20,
          padding: '12px 0',
        }}>
          <PaginationButton
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            label="Previous"
          />
          <span style={{ fontSize: 12, color: colors.textSecondary, fontFamily: "'IBM Plex Mono', monospace" }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <PaginationButton
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            label="Next"
          />
        </div>
      )}
    </div>
  );
}

const cellOverflow: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function EventRow({ event, expanded, onToggle }: {
  event: EventRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const etc = eventTypeColors[event.eventType] || { bg: colors.textMuted, text: colors.textSecondary };
  const ts = new Date(event.ts);

  let parsedData: Record<string, unknown> | null = null;
  if (expanded && event.data) {
    try {
      parsedData = JSON.parse(event.data);
    } catch {
      parsedData = null;
    }
  }

  return (
    <div
      onClick={onToggle}
      style={{
        background: expanded ? rowHoverBg : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: '160px 100px 140px 100px 1fr',
        gap: 12,
        padding: '10px 16px',
        alignItems: 'center',
        minWidth: 0,
      }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: colors.textSecondary, ...cellOverflow }}>
          {ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          <span style={{ color: colors.textMuted, marginLeft: 4, fontSize: 10 }}>
            {ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: etc.text,
            background: `linear-gradient(135deg, ${etc.bg}22, ${etc.bg}0D)`,
            padding: '2px 8px',
            borderRadius: 6,
            display: 'inline-block',
            border: `1px solid ${etc.bg}20`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            {event.eventType}
          </span>
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary, ...cellOverflow }}>
          {event.queue}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: colors.textMuted, ...cellOverflow }}>
          {event.jobId || '—'}
        </div>
        <div style={{
          fontSize: 12,
          color: event.jobName === '[deleted]' ? colors.textMuted : colors.textSecondary,
          fontStyle: event.jobName === '[deleted]' ? 'italic' : 'normal',
          ...cellOverflow,
        }}>
          {event.jobName || '—'}
        </div>
      </div>

      {expanded && parsedData && (
        <div style={{
          padding: '0 16px 12px 16px',
        }}>
          <pre style={{ ...codeBlock, margin: 0 }}>
            {JSON.stringify(parsedData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function PaginationButton({ disabled, onClick, label }: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...glassBtn,
        padding: '6px 16px',
        fontSize: 12,
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
