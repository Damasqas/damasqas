import { useState } from 'react';
import { Overview } from './pages/Overview';
import { QueueDetail } from './pages/QueueDetail';
import { FailedJobs } from './pages/FailedJobs';
import { Alerts } from './pages/Alerts';
import { RedisHealth } from './pages/RedisHealth';
import { EventTimeline } from './pages/EventTimeline';
import { Flows } from './pages/Flows';

type View = 'overview' | 'queue' | 'failed' | 'alerts' | 'redis' | 'events' | 'flows';

const globalStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a;
    color: #e0e0e0;
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  code, .mono {
    font-family: 'IBM Plex Mono', monospace;
  }
`;

export function App() {
  const [view, setView] = useState<View>('overview');
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);

  const navigate = (v: View, queue?: string) => {
    setView(v);
    if (queue !== undefined) setSelectedQueue(queue);
  };

  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ minHeight: '100vh' }}>
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '16px 24px',
          borderBottom: '1px solid #1a1a1a',
          background: 'rgba(10, 10, 10, 0.95)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <span style={{
            fontWeight: 700,
            fontSize: 18,
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'IBM Plex Mono, monospace',
          }} onClick={() => navigate('overview')}>
            damasqas
          </span>
          <NavButton active={view === 'overview'} onClick={() => navigate('overview')}>
            Overview
          </NavButton>
          {selectedQueue && (
            <NavButton active={view === 'queue'} onClick={() => navigate('queue')}>
              {selectedQueue}
            </NavButton>
          )}
          <NavButton active={view === 'failed'} onClick={() => navigate('failed')}>
            Failed Jobs
          </NavButton>
          <NavButton active={view === 'events'} onClick={() => navigate('events')}>
            Events
          </NavButton>
          <NavButton active={view === 'flows'} onClick={() => navigate('flows')}>
            Flows
          </NavButton>
          <NavButton active={view === 'redis'} onClick={() => navigate('redis')}>
            Redis
          </NavButton>
          <NavButton active={view === 'alerts'} onClick={() => navigate('alerts')}>
            Alerts
          </NavButton>
        </nav>

        <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
          {view === 'overview' && (
            <Overview onSelectQueue={(q) => navigate('queue', q)} />
          )}
          {view === 'queue' && selectedQueue && (
            <QueueDetail
              queue={selectedQueue}
              onSelectQueue={(q) => navigate('queue', q)}
            />
          )}
          {view === 'failed' && (
            <FailedJobs
              queue={selectedQueue}
              onSelectQueue={(q) => navigate('queue', q)}
            />
          )}
          {view === 'events' && <EventTimeline />}
          {view === 'flows' && <Flows onSelectQueue={(q) => navigate('queue', q)} />}
          {view === 'redis' && <RedisHealth />}
          {view === 'alerts' && <Alerts />}
        </main>
      </div>
    </>
  );
}

function NavButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: active ? '#ff3333' : '#888',
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        padding: '4px 0',
        borderBottom: active ? '2px solid #ff3333' : '2px solid transparent',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}
