import React from "react";

interface ModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function Modal({ open, title, children, onConfirm, onCancel, loading }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{title}</h2>
        <div>{children}</div>
        <div className="modal-actions">
          <button onClick={onCancel} disabled={loading}>Cancel</button>
          <button onClick={onConfirm} disabled={loading}>Confirm</button>
        </div>
      </div>
    </div>
  );
}