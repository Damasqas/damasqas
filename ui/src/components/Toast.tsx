import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { colors } from '../theme';

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error';
}

interface ToastContextValue {
  showToast: (text: string, type?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, text, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
      }}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: () => void }) {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    requestAnimationFrame(() => setOpacity(1));
    const fadeTimer = setTimeout(() => setOpacity(0), 2500);
    const removeTimer = setTimeout(onDone, 3000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [onDone]);

  const isError = toast.type === 'error';

  return (
    <div style={{
      background: isError
        ? 'linear-gradient(135deg, rgba(185,28,28,0.9), rgba(153,27,27,0.85))'
        : 'linear-gradient(135deg, rgba(22,163,106,0.9), rgba(21,128,61,0.85))',
      color: '#fff',
      padding: '10px 16px',
      borderRadius: 10,
      fontSize: 13,
      fontFamily: "'IBM Plex Mono', monospace",
      opacity,
      transition: 'opacity 0.3s ease',
      maxWidth: 300,
      border: `1px solid ${isError ? colors.redBorder : colors.greenBorder}`,
      boxShadow: isError
        ? '0 4px 20px rgba(185,28,28,0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
        : '0 4px 20px rgba(22,163,106,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
    }}>
      {toast.text}
    </div>
  );
}
