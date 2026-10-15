import { Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CopyButton } from "~/components/CopyButton";
import { KAKAO_TEXT_LIMIT, shareTextToKakao } from "~/lib/kakao";
import {
  scheduleNoticePath,
  scheduleNoticeShort,
  scheduleNoticeText,
  type NewSchedule,
} from "~/lib/schedule-notice";

/**
 * 새로 올린 일정을 단톡방에 알리기: 카톡 공유(200자 안으로 줄임) · 전체 문구 복사.
 * preview 면 카톡으로 보낼 문구를 말풍선으로 먼저 보여 준다(한 건 등록 뒤 창).
 */
export function ScheduleShare({
  items,
  preview = false,
}: {
  items: NewSchedule[];
  preview?: boolean;
}) {
  const path = scheduleNoticePath(items);
  const shortText = scheduleNoticeShort(items, KAKAO_TEXT_LIMIT);
  // 복사 문구의 링크는 지금 접속한 주소 기준 (브라우저에서만 알 수 있다)
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const fullText = scheduleNoticeText(items, `${origin}${path}`);
  const big = preview ? "h-12 flex-1 !text-sm" : "";

  return (
    <div className="space-y-3">
      {preview ? (
        <p className="whitespace-pre-line break-keep rounded-2xl rounded-tl-md bg-[#FEE500] px-4 py-3 text-[13px] font-medium leading-relaxed text-ink">
          {shortText}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn-accent btn-sm ${big}`}
          onClick={() =>
            shareTextToKakao({ text: shortText, path, buttonTitle: "일정 보기" })
          }
        >
          <Share2 size={14} />
          카톡방에 알리기
        </button>
        <CopyButton text={fullText} label="문구 복사" className={big} />
      </div>
    </div>
  );
}
