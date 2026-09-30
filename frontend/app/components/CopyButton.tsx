import { useState } from "react";

/** 클립보드 복사 버튼. 클립보드는 HTTPS 또는 localhost에서만 동작한다. */
export function CopyButton({
  text,
  label = "복사",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 접근이 불가하면 무시
        }
      }}
      className={`shrink-0 rounded-md bg-court-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-court-700 ${className}`}
    >
      {copied ? "복사됨 ✓" : label}
    </button>
  );
}
