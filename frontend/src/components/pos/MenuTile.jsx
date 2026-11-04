import { useOrders } from '../../context/OrderContext';
import StatusBadge from '../StatusBadge';
import { stockStatus } from '../../utils/inventory';
import { formatMoney } from '../../utils/money';

const noun = (n, unit) => (n === 1 ? unit.replace(/s$/, '') : unit);

export default function MenuTile({ item }) {
  const { stockOf, addable, inCart, addToCart } = useOrders();
  const stock = stockOf(item.id);
  const left = addable(item.id);
  const qty = inCart(item.id);
  const st = stockStatus(stock, item.minLevel);

  const label =
    stock <= 0
      ? 'Out of stock'
      : left <= 0
        ? 'All added to order'
        : `${left} ${noun(left, item.unit)} left`;

  return (
    <button
      type="button"
      className={`tile${qty > 0 ? ' in-order' : ''}`}
      disabled={left <= 0}
      onClick={() => addToCart(item.id)}
      aria-label={`${item.name}, ${formatMoney(item.price)}, ${label}`}
    >
      {qty > 0 && <span className="tile-qty" aria-hidden="true">{qty}</span>}
      <span className="tile-name">{item.name}</span>
      <span className="tile-price">{formatMoney(item.price)}</span>
      <span className="tile-foot">
        <span>{label}</span>
        {st.key !== 'in' && stock > 0 && <StatusBadge tone={st.tone}>{st.label}</StatusBadge>}
        {stock <= 0 && <StatusBadge tone="danger">Out of stock</StatusBadge>}
      </span>
    </button>
  );
}