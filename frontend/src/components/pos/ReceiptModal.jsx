import { Printer } from 'lucide-react';
import Modal from '../Modal';
import Receipt from './Receipt';

export default function ReceiptModal({ order, closeLabel = 'Close', onClose }) {
  return (
    <Modal title={`Receipt #${order.number}`} onClose={onClose}>
      <Receipt order={order} />
      <div className="form-actions no-print">
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print receipt
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>{closeLabel}</button>
      </div>
    </Modal>
  );
}