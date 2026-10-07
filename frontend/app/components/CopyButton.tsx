import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * 클립보드 복사 버튼. 클립보드는 HTTPS 또는 localhost에서만 동작한다.
 * tone="ink"는 원색 타일 안에서 쓰는 검정 알약.
 */
export function CopyButton({
  text,
  label = "복사",
  tone = "ghost",
  className = "",
}: {
  text: string;
  label?: string;
  tone?: "ghost" | "ink";
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
      className={`${tone === "ink" ? "btn-ink" : "btn-ghost"} btn-sm shrink-0 ${className}`}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "복사됨" : label}
    </button>
  );
}
