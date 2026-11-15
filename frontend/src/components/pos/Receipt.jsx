import { useOrders } from '../../context/OrderContext';
import { ORDER_TYPES, PAYMENT_METHODS } from '../../config/shop';
import { fmtDateTime } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const label = (list, id) => list.find((x) => x.id === id)?.label ?? id;

export default function Receipt({ order }) {
  const { shop } = useOrders();
  const { payment } = order;

  return (
    <div className="receipt-sheet">
      <div className="receipt-head">
        <div className="receipt-shop">{shop.name}</div>
        <div>{shop.location}</div>
        {shop.gstRegistered && shop.gstRegNo && <div>GST Reg. No. {shop.gstRegNo}</div>}
      </div>

      <div className="receipt-block">
        <div className="receipt-row"><span>Order</span><span>#{order.number}</span></div>
        <div className="receipt-row"><span>Date</span><span>{fmtDateTime(order.createdAt)}</span></div>
        <div className="receipt-row"><span>Type</span><span>{label(ORDER_TYPES, order.type)}</span></div>
        <div className="receipt-row"><span>Cashier</span><span>{order.cashier}</span></div>
      </div>

      <div className="receipt-block">
        {order.lines.map((l) => (
          <div className="receipt-row" key={l.itemId}>
            <span>{l.qty} × {l.name}</span>
            <span>{formatMoney(l.price * l.qty)}</span>
          </div>
        ))}
      </div>

      <div className="receipt-block">
        {shop.gstRegistered && order.gst > 0 && (
          <div className="receipt-row">
            <span>GST included ({Math.round(shop.gstRate * 100)}%)</span>
            <span>{formatMoney(order.gst)}</span>
          </div>
        )}
        <div className="receipt-row receipt-total">
          <span>Total</span>
          <span>{formatMoney(order.total)}</span>
        </div>
      </div>

      <div className="receipt-block">
        <div className="receipt-row">
          <span>Paid by</span>
          <span>{label(PAYMENT_METHODS, payment.method)}</span>
        </div>
        {payment.method === 'cash' && (
          <>
            <div className="receipt-row"><span>Cash received</span><span>{formatMoney(payment.tendered)}</span></div>
            <div className="receipt-row"><span>Change</span><span>{formatMoney(payment.change)}</span></div>
          </>
        )}
      </div>

      <div className="receipt-foot">Thank you for dining with us!</div>
    </div>
  );
}