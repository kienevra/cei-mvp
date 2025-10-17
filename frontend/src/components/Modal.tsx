import React, { useEffect, useRef } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      ref.current?.focus();
    }
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30"
      aria-modal="true"
      role="dialog"
      tabIndex={-1}
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow p-6 min-w-[300px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
        ref={ref}
        tabIndex={0}
        aria-label={title}
      >
        {title && <div className="font-bold mb-2">{title}</div>}
        {children}
      </div>
    </div>
  );
};

export default Modal;