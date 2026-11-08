import { CalendarPlus, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "~/components/Modal";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // 아이패드는 맥처럼 보이므로 터치로 가린다
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/**
 * 모임을 폰 캘린더에 넣기 (서버 app/calendar_export.py).
 * - 아이폰·맥 캘린더, 삼성 캘린더 등: .ics 파일 → '캘린더에 추가'
 * - 구글 캘린더(안드로이드): 일정 추가 화면 (구글 캘린더 앱은 .ics 를 열지 못한다)
 * 폰에 맞는 쪽을 위에 둔다. 저장한 뒤 모임이 바뀌어도 폰 캘린더는 그대로다.
 */
export function AddToCalendar({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => setPlatform(detectPlatform()), []);

  const ics = (
    <a
      key="ics"
      href={`/resources/gatherings/${id}/calendar.ics`}
      className="add-calendar-option"
      onClick={() => setOpen(false)}
    >
      <span>
        <strong>{platform === "android" ? "삼성 캘린더 등" : "아이폰 · 맥 캘린더"}</strong>
        <small>
          {platform === "android"
            ? ".ics 파일을 여는 캘린더 앱"
            : "기본 캘린더 · 삼성 캘린더 등 .ics 파일을 여는 앱"}
        </small>
      </span>
      <ChevronRight size={16} className="shrink-0 opacity-50" />
    </a>
  );
  const google = (
    <a
      key="google"
      href={`/resources/gatherings/${id}/google-calendar`}
      target="_blank"
      rel="noreferrer"
      className="add-calendar-option"
      onClick={() => setOpen(false)}
    >
      <span>
        <strong>구글 캘린더</strong>
        <small>{platform === "android" ? "안드로이드 폰 기본 캘린더" : "구글 계정 캘린더"}</small>
      </span>
      <ChevronRight size={16} className="shrink-0 opacity-50" />
    </a>
  );

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full border border-ink/30 px-2 py-0.5 text-[11px] font-bold hover:bg-ink/10"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus size={12} />
        내 캘린더에 추가
      </button>
      {open ? (
        <Modal title="내 캘린더에 추가" onClose={() => setOpen(false)}>
          <div className="space-y-2">{platform === "android" ? [google, ics] : [ics, google]}</div>
          <p className="mt-4 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            날짜·시간·장소와 모임 화면 링크가 들어가고, 1시간 전 알림이 함께 들어가요(시간 미정이면
            전날 오전 9시, 구글은 내 기본 알림). 저장한 뒤 시간이 바뀌거나 모임이 취소되면 폰 캘린더는
            그대로라 다시 추가하거나 지워 주세요.
          </p>
        </Modal>
      ) : null}
    </>
  );
}
