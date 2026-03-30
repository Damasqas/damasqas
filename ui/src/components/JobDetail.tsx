import type { JobDetail as JobDetailType } from '../hooks/useJobs';

interface JobDetailProps {
  job: JobDetailType;
  onClose: () => void;
}

export function JobDetail({ job, onClose }: JobDetailProps) {
  const formatDate = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString() : '—';

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: 600,
            fontSize: 16,
            color: '#fff',
          }}>
            Job #{job.id}
          </span>
          <span style={{ color: '#666', marginLeft: 12, fontSize: 13 }}>
            {job.name}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: 18,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Field label="Created" value={formatDate(job.timestamp)} />
        <Field label="Processed" value={formatDate(job.processedOn)} />
        <Field label="Finished" value={formatDate(job.finishedOn)} />
        <Field label="Attempts" value={String(job.attemptsMade)} />
        <Field label="Delay" value={`${job.delay}ms`} />
        <Field label="Priority" value={String(job.priority)} />
      </div>

      {job.failedReason && (
        <CodeBlock label="Failed Reason" content={job.failedReason} />
      )}
      {job.stacktrace && (
        <CodeBlock label="Stack Trace" content={job.stacktrace} />
      )}
      <CodeBlock label="Data" content={formatJson(job.data)} />
      {job.returnvalue && (
        <CodeBlock label="Return Value" content={formatJson(job.returnvalue)} />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#ccc', fontFamily: 'IBM Plex Mono, monospace', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function CodeBlock({ label, content }: { label: string; content: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {label}
      </div>
      <pre style={{
        background: 'rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        fontFamily: 'IBM Plex Mono, monospace',
        color: '#ccc',
        overflow: 'auto',
        maxHeight: 300,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {content}
      </pre>
    </div>
  );
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
