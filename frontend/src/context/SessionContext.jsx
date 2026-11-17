import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const SessionContext = createContext(null);

const SALES_ROLES = ['cashier', 'owner']; // who can sell, so who has a cash drawer

export function SessionProvider({ children }) {
  const { user } = useAuth();
  const active = Boolean(user && SALES_ROLES.includes(user.role));
  const userId = user?.id ?? null;

  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const data = await api.get('/sessions/current');
    setSession(data.session);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
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
      return { ok: true, session: data.session };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  return (
    <SessionContext.Provider value={{ session, ready, error, refresh, openSession, closeSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}