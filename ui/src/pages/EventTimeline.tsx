import { useState, useMemo, useEffect, useRef } from 'react';
import { useEvents, useEventSearch, type EventRecord } from '../hooks/useEvents';
import { useQueues } from '../hooks/useQueues';

type Range = '1h' | '6h' | '24h' | '7d';

const RANGE_MS: Record<Range, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// All BullMQ v5 event types
const EVENT_TYPES = [
  'completed', 'failed', 'added', 'waiting', 'active',
  'delayed', 'stalled', 'progress', 'removed', 'drained',
  'error', 'duplicated', 'cleaned', 'paused', 'resumed',
];

const eventTypeColors: Record<string, string> = {
  completed: '#22c55e',
  failed: '#ff3333',
  stalled: '#f59e0b',
  active: '#3b82f6',
  added: '#8b5cf6',
  waiting: '#6b7280',
  delayed: '#f97316',
  progress: '#06b6d4',
  removed: '#ec4899',
  drained: '#64748b',
  error: '#dc2626',
  duplicated: '#a855f7',
  cleaned: '#78716c',
  paused: '#eab308',
  resumed: '#84cc16',
};

const PAGE_SIZE = 50;

/** Debounce a value — returns the latest value after `delay` ms of inactivity. */
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

  // Debounce job name input to avoid firing on every keystroke.
  // The API does exact match, so partial strings return nothing anyway —
  // debouncing prevents wasted requests during typing.
  const debouncedJobName = useDebouncedValue(jobNameInput, 400);

  // Reset offset when the debounced job name changes
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

  // `since` is computed fresh inside the queryFn on every fetch (including
  // refetchInterval ticks) so the sliding window stays accurate. We pass
  // rangeMs instead of a frozen timestamp. See useEvents for details.
  const { data: eventsData, isLoading } = useEvents({
    rangeMs: RANGE_MS[range],
    limit: PAGE_SIZE,
    offset,
    queue: queueFilter || undefined,
    type: typeFilter || undefined,
    jobName: debouncedJobName || undefined,
  });

  const { data: searchData } = useEventSearch(searchQuery);

  const events = searchQuery ? (searchData?.events || []) : (eventsData?.events || []);
  const total = searchQuery ? (searchData?.events?.length || 0) : (eventsData?.total || 0);
  const isSearchMode = searchQuery.length > 0;

  const resetPagination = () => setOffset(0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, margin: 0 }}>
          Event Timeline
        </h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {(Object.keys(RANGE_MS) as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => { setRange(r); resetPagination(); }}
              style={{
                background: range === r ? 'rgba(255, 51, 51, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${range === r ? 'rgba(255, 51, 51, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: 6,
                color: range === r ? '#ff3333' : '#888',
                fontSize: 12,
                padding: '4px 12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#666', fontFamily: 'IBM Plex Mono, monospace' }}>
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
          style={selectStyle}
        >
          <option value="">All queues</option>
          {queueNames.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); resetPagination(); }}
          style={selectStyle}
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
          style={inputStyle}
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
            style={inputStyle}
          />
          <button type="submit" style={{
            background: 'rgba(255, 51, 51, 0.15)',
            border: '1px solid rgba(255, 51, 51, 0.3)',
            borderRadius: 6,
            color: '#ff3333',
            fontSize: 12,
            padding: '6px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            Search
          </button>
          {isSearchMode && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearchQuery(''); }}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 6,
                color: '#888',
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
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
        <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>
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
            fontSize: 11,
            fontWeight: 600,
            color: '#666',
            textTransform: 'uppercase' as const,
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}>
            <div>Time</div>
            <div>Type</div>
            <div>Queue</div>
            <div>Job ID</div>
            <div>Job Name</div>
          </div>

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
      {!isSearchMode && total > PAGE_SIZE && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 16,
          marginTop: 20,
          padding: '12px 0',
        }}>
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            style={paginationBtnStyle(offset === 0)}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            style={paginationBtnStyle(offset + PAGE_SIZE >= total)}
          >
            Next
          </button>
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
  const color = eventTypeColors[event.eventType] || '#666';
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
        background: expanded ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        cursor: 'pointer',
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
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#999', ...cellOverflow }}>
          {ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          <span style={{ color: '#555', marginLeft: 4, fontSize: 10 }}>
            {ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            background: `${color}15`,
            padding: '2px 8px',
            borderRadius: 6,
            display: 'inline-block',
          }}>
            {event.eventType}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#ccc', ...cellOverflow }}>
          {event.queue}
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#888', ...cellOverflow }}>
          {event.jobId || '—'}
        </div>
        <div style={{
          fontSize: 12,
          color: event.jobName === '[deleted]' ? '#555' : '#aaa',
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
          <pre style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 8,
            padding: 12,
            fontSize: 11,
            fontFamily: 'IBM Plex Mono, monospace',
            color: '#aaa',
            overflow: 'auto',
            maxHeight: 300,
            margin: 0,
          }}>
            {JSON.stringify(parsedData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 6,
  color: '#ccc',
  fontSize: 12,
  padding: '6px 10px',
  fontFamily: 'inherit',
  minWidth: 120,
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 6,
  color: '#ccc',
  fontSize: 12,
  padding: '6px 10px',
  fontFamily: 'inherit',
  minWidth: 150,
  outline: 'none',
};

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    color: disabled ? '#444' : '#ccc',
    fontSize: 12,
    padding: '6px 16px',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
  };
}
