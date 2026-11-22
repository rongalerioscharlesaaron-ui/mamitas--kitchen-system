export default function StockHealthChart({ health, categories }) {
  const rows = [
    { key: 'overall', label: 'All Inventory', data: health.overall },
    { key: 'ingredients', label: 'Ingredients', data: health.ingredients },
    { key: 'menu', label: 'Menu Items', data: health.menu },
  ];

  const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

  return (
    <div className="card panel">
      <div className="chart-head">
        <div>
          <h2>Stock Health Breakdown</h2>
          <p className="chart-sub">Availability across ingredients and daily menu items</p>
        </div>
        <div className="chart-legend">
          <span><i className="dot dot-ok" /> In stock</span>
          <span><i className="dot dot-warn" /> Low</span>
          <span><i className="dot dot-danger" /> Out</span>
        </div>
      </div>

      <div className="health-bars">
        {rows.map(({ key, label, data }) => {
          const okPct = pct(data.inStock, data.total);
          const lowPct = pct(data.low, data.total);
          const outPct = Math.max(0, 100 - okPct - lowPct);
          return (
            <div className="health-row" key={key}>
              <div className="health-meta">
                <strong>{label}</strong>
                <span>
                  {data.inStock} ok · {data.low} low · {data.out} out ({data.total})
                </span>
              </div>
              <div
                className="stacked-track"
                role="img"
                aria-label={`${label}: ${data.inStock} in stock, ${data.low} low, ${data.out} out`}
              >
                {data.inStock > 0 && (
                  <div className="seg seg-ok" style={{ width: `${okPct}%` }} title={`In stock: ${data.inStock}`} />
                )}
                {data.low > 0 && (
                  <div className="seg seg-warn" style={{ width: `${lowPct}%` }} title={`Low stock: ${data.low}`} />
                )}
                {data.out > 0 && (
                  <div className="seg seg-danger" style={{ width: `${outPct}%` }} title={`Out of stock: ${data.out}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {categories?.length > 0 && (
        <div className="cat-breakdown">
          <div className="cat-title">By Category (Attention Needed)</div>
          <div className="cat-grid">
            {categories.map((c) => {
              const alerts = c.low + c.out;
              return (
                <div className="cat-chip" key={c.category}>
                  <span className="cat-name">{c.category}</span>
                  <span className={`cat-stat ${alerts > 0 ? 'is-alert' : 'is-ok'}`}>
                    {alerts > 0 ? `${alerts} of ${c.total} low/out` : `${c.total}/${c.total} stocked`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}