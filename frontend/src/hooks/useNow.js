import { useEffect, useState } from 'react';

// The current time, refreshed every minute so "open for 2 h 15 min" stays up to date
export function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}