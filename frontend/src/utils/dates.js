export const EXPIRING_SOON_DAYS = 3;

const pad = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toDateStr(new Date());
export const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toDateStr(d);
};
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const daysUntil = (s) =>
  Math.round((parseDate(s) - parseDate(todayStr())) / 86400000);

export const fmtDate = (s) =>
  s
    ? parseDate(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

export const expiryStatus = (s) => {
  if (!s) return 'none';
  const n = daysUntil(s);
  if (n < 0) return 'expired';
  if (n <= EXPIRING_SOON_DAYS) return 'soon';
  return 'ok';
};

export const daysText = (n) =>
  n < 0 ? `${-n} day${-n === 1 ? '' : 's'} ago` : n === 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`;