import { Link } from 'react-router-dom';

export default function StatCard({ label, value, hint, tone = 'info', to }) {
  return (
    <Link to={to} className={`stat stat-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </Link>
  );
}