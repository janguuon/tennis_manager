import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 모달: 데스크톱은 가운데 창, 모바일은 아래에서 올라오는 시트. 바깥을 누르거나 Esc로 닫힌다.
 * body에 포털로 그려서 부모의 transform/overflow와 상관없이 화면 전체를 덮는다.
 * (열릴 때만 렌더되므로 서버 렌더링에서는 호출되지 않는다)
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // onClose는 부모가 렌더할 때마다 새 함수라, 최신 값을 ref로 들고 효과는 한 번만 건다
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 열려 있는 동안 뒤 페이지 스크롤 잠금 + Esc로 닫기
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full animate-fade-in overflow-y-auto rounded-t-2xl bg-white p-5 shadow-pop motion-reduce:animate-none dark:bg-slate-900 sm:max-w-md sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
          <button type="button" className="icon-btn -mr-2" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 모달 폼 안의 소제목 (필드 묶음 구분) */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-xs font-semibold text-slate-400">{title}</legend>
      {children}
    </fieldset>
  );
}
