const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildTimeBuckets(range, records, getDate, getValue) {
  const now = new Date();
  const buckets = [];

  if (range === 'today') {
    // 3-hour blocks across today (00:00 - 23:59)
    for (let h = 0; h < 24; h += 3) {
      const label = `${String(h).padStart(2, '0')}:00`;
      buckets.push({ key: `h-${h}`, label, value: 0, count: 0 });
    }
    records.forEach((r) => {
      const d = new Date(getDate(r));
      if (Number.isNaN(d.getTime())) return;
      const idx = Math.min(7, Math.floor(d.getHours() / 3));
      buckets[idx].value += Number(getValue(r) || 0);
      buckets[idx].count += 1;
    });
    return buckets;
  }

  if (range === '7d') {
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      buckets.push({ key, label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, value: 0, count: 0 });
    }
    const map = new Map(buckets.map((b) => [b.key, b]));
    records.forEach((r) => {
      const d = new Date(getDate(r));
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const b = map.get(key);
      if (b) {
        b.value += Number(getValue(r) || 0);
        b.count += 1;
      }
    });
    return buckets;
  }

  if (range === '30d') {
    // Group 30 days into 6 five-day intervals so bars stay readable
    for (let i = 5; i >= 0; i -= 1) {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() - i * 5);
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 4);
      buckets.push({
        key: `w-${i}`,
        label: `${MONTHS[start.getMonth()]} ${start.getDate()}–${end.getDate()}`,
        start: start.getTime(),
        end: end.getTime(),
        value: 0,
        count: 0,
      });
    }
    records.forEach((r) => {
      const t = new Date(getDate(r)).getTime();
      if (Number.isNaN(t)) return;
      const b = buckets.find((x) => t >= x.start && t <= x.end);
      if (b) {
        b.value += Number(getValue(r) || 0);
        b.count += 1;
      }
    });
    return buckets;
  }

  // 'all': group by Month-Year (up to last 8 active months)
  const map = new Map();
  [...records]
    .sort((a, b) => new Date(getDate(a)) - new Date(getDate(b)))
    .forEach((r) => {
      const d = new Date(getDate(r));
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
          value: 0,
          count: 0,
        });
      }
      const entry = map.get(key);
      entry.value += Number(getValue(r) || 0);
      entry.count += 1;
    });
  return Array.from(map.values()).slice(-8);
}