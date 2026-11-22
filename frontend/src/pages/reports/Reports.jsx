import { useMemo, useState } from 'react';
import { Download, RefreshCw, TrendingUp, Boxes, TriangleAlert, Award } from 'lucide-react';
import { api } from '../../api/client';
import { useAutoLoad } from '../../hooks/useAutoLoad';
import { useInventory } from '../../context/InventoryContext';
import SalesReportTab from '../../components/reports/SalesReportTab';
import InventoryUsageReportTab from '../../components/reports/InventoryUsageReportTab';
import WasteLossReportTab from '../../components/reports/WasteLossReportTab';
import PerformanceReportTab from '../../components/reports/PerformanceReportTab';
import { buildTimeBuckets } from '../../components/reports/reportCharts';
import { MOVE_LABEL, TYPE_LABEL } from '../../utils/inventory';

const TABS = [
  { id: 'sales', label: 'Sales & Financial', icon: TrendingUp },
  { id: 'inventory', label: 'Inventory & Usage', icon: Boxes },
  { id: 'waste', label: 'Waste & Loss', icon: TriangleAlert },
  { id: 'performance', label: 'Performance Analytics', icon: Award },
];

const RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: 'Last 7 Days', days: 7 },
  { id: '30d', label: 'Last 30 Days', days: 30 },
  { id: 'all', label: 'All Time', days: null },
];

function downloadCsv(filename, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState('7d');

  const sales = useAutoLoad(() => api.get('/dashboard/sales'), []);
  const invDash = useAutoLoad(() => api.get('/dashboard/inventory'), []);
  const sessionsRes = useAutoLoad(() => api.get('/sessions').catch(() => ({ sessions: [] })), []);
  const ordersRes = useAutoLoad(() => api.get('/orders?limit=500').catch(() => ({ orders: [] })), []);
  const { items, batches, movements, refresh: refreshInv } = useInventory();

  const activeRange = RANGES.find((r) => r.id === range) || RANGES[1];

  const cutoff = useMemo(() => {
    if (!activeRange.days) return null;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (activeRange.days - 1));
    return d;
  }, [activeRange]);

  const filteredMovements = useMemo(() => {
    if (!cutoff) return movements;
    return movements.filter((m) => new Date(m.createdAt || m.date) >= cutoff);
  }, [movements, cutoff]);

  const filteredOrders = useMemo(() => {
    const list = ordersRes.data?.orders || [];
    if (!cutoff) return list;
    return list.filter((o) => new Date(o.createdAt || o.created_at) >= cutoff);
  }, [ordersRes.data, cutoff]);

  const filteredSessions = useMemo(() => {
    const list = sessionsRes.data?.sessions || [];
    if (!cutoff) return list;
    return list.filter((s) => new Date(s.openedAt || s.opened_at) >= cutoff);
  }, [sessionsRes.data, cutoff]);

  const handleRefresh = () => {
    sales.reload();
    invDash.reload();
    sessionsRes.reload();
    ordersRes.reload();
    refreshInv();
  };

  const handleExport = () => {
    const exportedAt = new Date().toISOString();

    if (tab === 'sales') {
      const s = sales.data || { todaySales: 0, todayOrders: 0, averageOrder: 0 };
      const completed = filteredOrders.filter((o) => o.status === 'completed');
      const grossSales =
        range === 'today' && completed.length === 0 && Number(s.todaySales) > 0
          ? Number(s.todaySales)
          : completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
      const completedCount =
        range === 'today' && completed.length === 0 && Number(s.todayOrders) > 0
          ? Number(s.todayOrders)
          : completed.length;
      const avgTicket =
        completedCount > 0 ? grossSales / completedCount : range === 'today' ? Number(s.averageOrder || 0) : 0;

      const cashTotal = filteredSessions.reduce((sum, x) => sum + Number(x.cashSales || 0), 0);
      const paynowTotal = filteredSessions.reduce((sum, x) => sum + Number(x.paynowSales || 0), 0);
      const cardTotal = filteredSessions.reduce((sum, x) => sum + Number(x.cardSales || 0), 0);
      const buckets = buildTimeBuckets(range, completed, (o) => o.createdAt || o.created_at, (o) => o.total);

      const rows = [
        ['Report Category', 'Sales & Financial', 'Timeline', activeRange.label, 'Exported At', exportedAt],
        [],
        ['SUMMARY METRICS'],
        ['Metric', 'Value'],
        ['Gross Sales', grossSales.toFixed(2)],
        ['Completed Orders', completedCount],
        ['Average Ticket', avgTicket.toFixed(2)],
        ['Sessions in Period', filteredSessions.length],
        ['Open Sessions', filteredSessions.filter((x) => x.isOpen).length],
        [],
        ['PAYMENT CHANNEL MIX'],
        ['Channel', 'Amount'],
        ['Cash', cashTotal.toFixed(2)],
        ['PayNow', paynowTotal.toFixed(2)],
        ['Card', cardTotal.toFixed(2)],
        [],
        ['SALES TREND BUCKETS'],
        ['Period Bucket', 'Revenue', 'Completed Orders'],
        ...buckets.map((b) => [b.label, b.value.toFixed(2), b.count]),
        [],
        ['ORDERS IN PERIOD'],
        ['Order #', 'Type', 'Status', 'Total', 'Created At'],
        ...filteredOrders.map((o) => [
          o.number || o.order_number,
          o.type || o.order_type || '-',
          o.status,
          Number(o.total || 0).toFixed(2),
          o.createdAt || o.created_at,
        ]),
      ];
      downloadCsv(`mamitas-sales-report-${range}.csv`, rows);
      return;
    }

    if (tab === 'inventory') {
      const inCount = filteredMovements.filter((m) => m.type === 'IN').length;
      const usedCount = filteredMovements.filter((m) => m.type === 'USED').length;
      const adjCount = filteredMovements.filter((m) => m.type === 'ADJUSTMENT').length;
      const menuValue = items
        .filter((i) => i.type !== 'ingredient')
        .reduce((sum, i) => sum + Number(i.qtyUsable || 0) * Number(i.price || 0), 0);

      const usedMap = new Map();
      filteredMovements
        .filter((m) => m.type === 'USED')
        .forEach((m) => {
          const prev = usedMap.get(m.itemName) || { name: m.itemName, unit: m.unit, qty: 0, count: 0 };
          prev.qty += Number(m.qty || 0);
          prev.count += 1;
          usedMap.set(m.itemName, prev);
        });
      const topUsed = Array.from(usedMap.values()).sort((a, b) => b.count - a.count || b.qty - a.qty);

      const rows = [
        ['Report Category', 'Inventory & Usage', 'Timeline', activeRange.label, 'Exported At', exportedAt],
        [],
        ['MOVEMENT & STOCK SUMMARY'],
        ['Metric', 'Value'],
        ['Stock-In Entries', inCount],
        ['Usage Entries', usedCount],
        ['Stock Adjustments', adjCount],
        ['Ready Menu Retail Value', menuValue.toFixed(2)],
        [],
        ['MOST CONSUMED ITEMS (PERIOD)'],
        ['Item', 'Total Used Qty', 'Unit', 'Deduction Count'],
        ...topUsed.map((u) => [u.name, u.qty, u.unit, u.count]),
        [],
        ['CURRENT INVENTORY SNAPSHOT'],
        ['Item', 'Type', 'Category', 'On Hand', 'Usable', 'Unit', 'Min Level', 'Unit Price'],
        ...items.map((i) => [
          i.name,
          TYPE_LABEL[i.type],
          i.category,
          i.qtyOnHand,
          i.qtyUsable,
          i.unit,
          i.minLevel,
          i.price ?? 0,
        ]),
        [],
        ['STOCK MOVEMENTS IN PERIOD'],
        ['Date', 'Item', 'Batch', 'Movement', 'Qty', 'Unit', 'Reason', 'Recorded By'],
        ...filteredMovements.map((m) => [
          m.createdAt || m.date,
          m.itemName,
          m.batchCode || '-',
          MOVE_LABEL[m.type] || m.type,
          m.qty,
          m.unit,
          m.reason || '',
          m.recordedBy || m.user || '',
        ]),
      ];
      downloadCsv(`mamitas-inventory-report-${range}.csv`, rows);
      return;
    }

    if (tab === 'waste') {
      const losses = filteredMovements.filter((m) => m.type === 'DAMAGED' || m.type === 'SPOILED');
      const damagedCount = losses.filter((m) => m.type === 'DAMAGED').length;
      const spoiledCount = losses.filter((m) => m.type === 'SPOILED').length;
      const expiredOnHand = batches.filter((b) => b.qty > 0 && b.expiry && new Date(b.expiry) < new Date()).length;

      const reasonMap = new Map();
      losses.forEach((m) => {
        const key = (m.reason || 'Unspecified').trim();
        reasonMap.set(key, (reasonMap.get(key) || 0) + 1);
      });
      const reasons = Array.from(reasonMap.entries()).sort((a, b) => b[1] - a[1]);

      const rows = [
        ['Report Category', 'Waste & Loss', 'Timeline', activeRange.label, 'Exported At', exportedAt],
        [],
        ['WASTE & LOSS SUMMARY'],
        ['Metric', 'Value'],
        ['Total Loss Entries', losses.length],
        ['Damaged Entries', damagedCount],
        ['Spoiled Entries', spoiledCount],
        ['Unwritten Expired Batches', invDash.data?.expiredCount ?? expiredOnHand],
        [],
        ['TOP WASTE REASONS (PERIOD)'],
        ['Reason', 'Entries'],
        ...reasons.map(([reason, count]) => [reason, count]),
        [],
        ['WASTE & LOSS LOGS IN PERIOD'],
        ['Date', 'Item', 'Batch', 'Type', 'Qty', 'Unit', 'Reason', 'Recorded By'],
        ...losses.map((m) => [
          m.createdAt || m.date,
          m.itemName,
          m.batchCode || '-',
          MOVE_LABEL[m.type] || m.type,
          m.qty,
          m.unit,
          m.reason || '',
          m.recordedBy || m.user || '',
        ]),
      ];
      downloadCsv(`mamitas-waste-report-${range}.csv`, rows);
      return;
    }

    // Performance Analytics
    const dishMap = new Map();
    filteredOrders
      .filter((o) => o.status === 'completed')
      .forEach((o) => {
        (o.items || []).forEach((line) => {
          const name = line.itemName || line.name;
          if (!name) return;
          dishMap.set(name, (dishMap.get(name) || 0) + Number(line.qty || 0));
        });
      });

    const topDishes =
      dishMap.size > 0
        ? Array.from(dishMap.entries())
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
        : range === 'today'
          ? (sales.data?.topSellers || [])
          : [];

    const readiness =
      invDash.data?.totalItems > 0
        ? Math.round(((invDash.data.totalItems - invDash.data.lowOrOutCount) / invDash.data.totalItems) * 100)
        : 100;
    const periodLosses = filteredMovements.filter((m) => m.type === 'DAMAGED' || m.type === 'SPOILED').length;

    const cashierMap = new Map();
    filteredSessions.forEach((s) => {
      const key = s.cashier || 'Unknown';
      const row = cashierMap.get(key) || { cashier: key, sales: 0, orders: 0, shifts: 0 };
      row.sales += Number(s.netSales || 0);
      row.orders += Number(s.orders || 0);
      row.shifts += 1;
      cashierMap.set(key, row);
    });
    const cashierSummary = Array.from(cashierMap.values()).sort((a, b) => b.sales - a.sales);

    const rows = [
      ['Report Category', 'Performance Analytics', 'Timeline', activeRange.label, 'Exported At', exportedAt],
      [],
      ['PERFORMANCE SUMMARY'],
      ['Metric', 'Value'],
      ['Stock Readiness (%)', `${readiness}%`],
      ['Top Dish Volume', topDishes[0] ? `${topDishes[0].name} (${topDishes[0].qty})` : 'None'],
      ['Shifts Recorded in Period', filteredSessions.length],
      ['Loss Incidents in Period', periodLosses],
      [],
      ['MENU ITEM SALES RANKING'],
      ['Rank', 'Menu Item', 'Units Sold'],
      ...topDishes.map((t, idx) => [idx + 1, t.name, t.qty]),
      [],
      ['CASHIER SALES COMPARISON'],
      ['Cashier', 'Net Sales', 'Orders', 'Shifts'],
      ...cashierSummary.map((c) => [c.cashier, Number(c.sales).toFixed(2), c.orders, c.shifts]),
      [],
      ['SHIFT RECONCILIATION LOGS IN PERIOD'],
      ['Cashier', 'Orders', 'Net Sales', 'Expected Cash', 'Counted Cash', 'Difference', 'Status'],
      ...filteredSessions.map((s) => [
        s.cashier,
        s.orders,
        Number(s.netSales || 0).toFixed(2),
        Number(s.expectedCash || 0).toFixed(2),
        s.isOpen ? 'Open' : Number(s.countedCash || 0).toFixed(2),
        s.isOpen ? '-' : Number(s.cashDifference || 0).toFixed(2),
        s.isOpen ? 'Open' : s.cashDifference === 0 ? 'Balanced' : 'Variance',
      ]),
    ];
    downloadCsv(`mamitas-performance-report-${range}.csv`, rows);
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Reports &amp; Analytics</h1>
          <p className="muted" style={{ margin: 0 }}>
            Financial summaries, stock consumption, spoilage tracking, and kitchen/counter performance.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRefresh}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleExport}>
            <Download size={15} aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      <div className="admin-bar">
        <div className="chips" role="tablist" aria-label="Report categories" style={{ marginBottom: 0 }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="chip"
                aria-selected={tab === t.id}
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                <span className="chip-inner"><Icon size={15} aria-hidden="true" /> {t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-checked={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'sales' && (
        <SalesReportTab
          range={range}
          rangeLabel={activeRange.label}
          sales={sales.data}
          sessions={filteredSessions}
          orders={filteredOrders}
        />
      )}
      {tab === 'inventory' && (
        <InventoryUsageReportTab
          rangeLabel={activeRange.label}
          items={items}
          movements={filteredMovements}
          invDash={invDash.data}
        />
      )}
      {tab === 'waste' && (
        <WasteLossReportTab
          rangeLabel={activeRange.label}
          movements={filteredMovements}
          batches={batches}
          invDash={invDash.data}
        />
      )}
      {tab === 'performance' && (
        <PerformanceReportTab
          range={range}
          rangeLabel={activeRange.label}
          sales={sales.data}
          orders={filteredOrders}
          movements={filteredMovements}
          sessions={filteredSessions}
          invDash={invDash.data}
        />
      )}
    </section>
  );
}