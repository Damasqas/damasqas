import { useState } from 'react';
import { Overview } from './pages/Overview';
import { QueueDetail } from './pages/QueueDetail';
import { FailedJobs } from './pages/FailedJobs';
import { Alerts } from './pages/Alerts';
import { RedisHealth } from './pages/RedisHealth';
import { EventTimeline } from './pages/EventTimeline';
import { Flows } from './pages/Flows';
import { shadows } from './theme';

type View = 'overview' | 'queue' | 'failed' | 'alerts' | 'redis' | 'events' | 'flows';

const globalStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #000000;
    color: rgba(255,255,255,0.55);
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
    font-size: 14px;
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
          padding: '14px 24px',
          borderBottom: 'none',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.7), rgba(0,0,0,0.5))',
          backdropFilter: 'blur(20px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: shadows.nav,
        }}>
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
          }} />
          <span style={{
            fontWeight: 700,
            fontSize: 18,
            color: '#fff',
            cursor: 'pointer',
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: -0.5,
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
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active
          ? 'linear-gradient(135deg, rgba(220,38,38,0.15), rgba(185,28,28,0.08))'
          : hovered
            ? 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
            : 'none',
        border: active
          ? '1px solid rgba(185,28,28,0.2)'
          : '1px solid transparent',
        borderRadius: 10,
        color: active ? '#fca5a5' : hovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        padding: '6px 12px',
        fontFamily: 'inherit',
        boxShadow: active
          ? '0 2px 8px rgba(185,28,28,0.1), inset 0 1px 0 rgba(255,255,255,0.06)'
          : 'none',
        transition: 'all 0.2s',
      }}
    >
      {children}
    </button>
  );
}
