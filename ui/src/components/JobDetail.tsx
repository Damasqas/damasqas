import type { JobDetail as JobDetailType } from '../hooks/useJobs';
import { glassCard, sectionLabel, codeBlock, colors } from '../theme';

interface JobDetailProps {
  job: JobDetailType;
  onClose: () => void;
}

export function JobDetail({ job, onClose }: JobDetailProps) {
  const formatDate = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString() : '—';

  return (
    <div style={{
      ...glassCard,
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
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            fontSize: 16,
            color: '#fff',
          }}>
            Job #{job.id}
          </span>
          <span style={{ color: colors.textMuted, marginLeft: 12, fontSize: 13 }}>
            {job.name}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            color: colors.textMuted,
            cursor: 'pointer',
            fontSize: 16,
            padding: '2px 8px',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
            transition: 'all 0.2s',
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
      <div style={{ ...sectionLabel }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function CodeBlock({ label, content }: { label: string; content: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ ...sectionLabel, marginBottom: 6 }}>
        {label}
      </div>
      <pre style={codeBlock}>
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
