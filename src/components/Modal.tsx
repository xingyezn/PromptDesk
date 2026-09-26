import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="modal-title" onCancel={onClose}>
      <header>
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
