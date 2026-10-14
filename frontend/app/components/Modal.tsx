import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native dialog provides focus trapping, Escape, and focus restoration. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.body.style.overflow;
    const trigger = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      trigger?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      className="club-modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            closeRef.current();
        }
      }}
    >
      {/* 머리(제목·닫기)는 스크롤해도 위에 붙어 있다 */}
      <div className="club-modal-head">
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          className="icon-btn -mr-2"
          onClick={onClose}
          aria-label="닫기"
        >
          <X size={20} />
        </button>
      </div>
      <div className="club-modal-body">{children}</div>
    </dialog>,
    document.body
  );
}
export function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-[13px] font-bold text-ink dark:text-white">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
