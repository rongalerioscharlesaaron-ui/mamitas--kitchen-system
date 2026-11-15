import { useCallback, useEffect, useRef, useState } from 'react';

// Loads data, then reloads it every 30 seconds and when the browser tab is focused again.
// Answers that arrive late (after a newer request) are ignored.
export function useAutoLoad(load, deps = [], interval = 30000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  const latest = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback(async (quiet = false) => {
    latest.current += 1;
    const id = latest.current;
    if (!quiet) setLoading(true);
    try {
      const result = await loadRef.current();
      if (id !== latest.current) return;
      setData(result);
      setError('');
    } catch (err) {
      if (id !== latest.current) return;
      setError(err.message);
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
    const quiet = () => {
      if (document.visibilityState === 'visible') run(true);
    };
    const timer = setInterval(quiet, interval);
    window.addEventListener('focus', quiet);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', quiet);
    };
  }, [...deps, interval, run]);

  return { data, error, loading, reload: () => run(true) };
}