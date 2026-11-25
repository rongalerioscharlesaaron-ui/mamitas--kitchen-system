import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const SessionContext = createContext(null);

const SALES_ROLES = ['cashier',]; // who can sell, so who has a cash drawer

export function SessionProvider({ children }) {
  const { user } = useAuth();
  const active = Boolean(user && SALES_ROLES.includes(user.role));
  const isOwner = user?.role === 'owner';
  const userId = user?.id ?? null;

  const [session, setSession] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [curr, all] = await Promise.all([
      api.get('/sessions/current'),
      isOwner ? api.get('/sessions?date=today').catch(() => ({ sessions: [] })) : Promise.resolve({ sessions: [] }),
    ]);
    setSession(curr.session);
    setActiveSessions((all.sessions || []).filter((s) => s.isOpen));
  }, [isOwner]);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setActiveSessions([]);
    setError('');
    if (!active) {
      setReady(true);
      return undefined;
    }
    setReady(false);
    load()
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, userId, load]);

  // Sales are recorded on other screens, so refresh every 30 seconds and when the tab is focused
  useEffect(() => {
    if (!active) return undefined;
    const quiet = () => {
      if (document.visibilityState === 'visible') {
        load().then(() => setError('')).catch(() => {});
      }
    };
    const timer = setInterval(quiet, 30000);
    window.addEventListener('focus', quiet);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', quiet);
    };
  }, [active, load]);

  const refresh = useCallback(
    () => load().then(() => setError('')).catch((err) => setError(err.message)),
    [load]
  );

  const openSession = async (openingCash) => {
    try {
      const data = await api.post('/sessions/open', { openingCash });
      setSession(data.session);
      if (isOwner) await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  // Returns the closed session so the shift summary can be shown
  const closeSession = async ({ countedCash, note }) => {
    try {
      const data = await api.post('/sessions/close', { countedCash, note });
      setSession(null);
      if (isOwner) await refresh();
      return { ok: true, session: data.session };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  return (
    <SessionContext.Provider value={{ session, activeSessions, ready, error, refresh, openSession, closeSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}