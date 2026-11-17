const TZ = 'Asia/Singapore';
const clock = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dayTime = new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ,
});

export const fmtClock = (iso) => (iso ? clock.format(new Date(iso)) : 'Not yet');
export const fmtDayTime = (iso) => (iso ? dayTime.format(new Date(iso)) : 'Not yet');

export function durationText(fromIso, to = Date.now()) {
  const minutes = Math.max(0, Math.floor((new Date(to).getTime() - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}