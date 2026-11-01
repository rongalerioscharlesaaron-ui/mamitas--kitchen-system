import Modal from './Modal';

export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onCancel,
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className={`btn btn-${tone}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}