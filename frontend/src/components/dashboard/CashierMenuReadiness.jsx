export default function CashierMenuReadiness({ menuItems }) {
  const total = menuItems.length;
  const available = menuItems.filter((i) => i.status === 'in').length;
  const low = menuItems.filter((i) => i.status === 'low').length;
  const out = menuItems.filter((i) => i.status === 'out').length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const catMap = new Map();
  for (const item of menuItems) {
    const key = item.category || 'Uncategorized';
    if (!catMap.has(key)) catMap.set(key, { name: key, total: 0, ready: 0 });
    const entry = catMap.get(key);
    entry.total += 1;
    if (item.status !== 'out') entry.ready += 1;
  }
  const cats = [...catMap.values()];

  return (
    <div className="card panel">
      <div className="chart-head">
        <div>
          <h2>Menu Availability</h2>
          <p className="chart-sub">Live dish &amp; tray readiness for counter orders</p>
        </div>
        <div className="chart-legend">
          <span><i className="dot dot-ok" /> Ready ({available})</span>
          <span><i className="dot dot-warn" /> Low ({low})</span>
          <span><i className="dot dot-danger" /> Sold out ({out})</span>
        </div>
      </div>

      <div
        className="stacked-track"
        role="img"
        aria-label={`Menu availability: ${available} ready, ${low} low, ${out} out`}
      >
        {available > 0 && <div className="seg seg-ok" style={{ width: `${pct(available)}%` }} />}
        {low > 0 && <div className="seg seg-warn" style={{ width: `${pct(low)}%` }} />}
        {out > 0 && (
          <div className="seg seg-danger" style={{ width: `${Math.max(0, 100 - pct(available) - pct(low))}%` }} />
        )}
      </div>

      {cats.length > 0 && (
        <div className="cat-grid" style={{ marginTop: 14 }}>
          {cats.map((c) => {
            const allOut = c.ready === 0;
            return (
              <div className="cat-chip" key={c.name}>
                <span className="cat-name">{c.name}</span>
                <span className={`cat-stat ${allOut ? 'is-alert' : 'is-ok'}`}>
                  {c.ready} of {c.total} orderable
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}