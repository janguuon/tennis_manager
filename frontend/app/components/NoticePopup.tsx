import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";

import { Celebration } from "~/components/Celebration";
import { Modal } from "~/components/Modal";
import type { Notice } from "~/lib/types";

export const NOTICE_ICON = { celebrate: "🎉", news: "📢" } as const;
export const NOTICE_LABEL = { celebrate: "축하해요", news: "클럽 소식" } as const;

/** "2026-10-16T09:00:00" → "10월 16일" */
export function noticeDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}월 ${d}일`;
}

/** 소식 한 건 (팝업과 소식 화면이 같이 쓴다) */
export function NoticeCard({ notice }: { notice: Notice }) {
  return (
    <article
      className={`${
        notice.kind === "celebrate" ? "tile-yellow" : "tile-blue"
      } rounded-2xl p-4`}
    >
      <p className="text-xs font-bold">
        {NOTICE_ICON[notice.kind]} {NOTICE_LABEL[notice.kind]} ·{" "}
        {noticeDate(notice.created_at)}
      </p>
      <h3 className="mt-1 text-lg font-extrabold leading-snug">
        {notice.title}
      </h3>
      {notice.body ? (
        <p className="mt-2 whitespace-pre-line text-sm font-medium leading-relaxed">
          {notice.body}
        </p>
      ) : null}
    </article>
  );
}

/**
 * 들어왔을 때 '다시 보지 않기'를 누르지 않은 클럽 소식을 띄운다 (게시 기간 동안).
 * - [확인]·✕·바깥 누르기: 이번에만 닫는다. 다음에 앱에 들어오면 다시 뜬다.
 * - [다시 보지 않기]: 서버에 적어 두어 그 소식은 다른 기기에서도 다시 뜨지 않는다 (그 뒤에 올라온 소식은 뜬다).
 * 뜰 때 꽃가루가 떨어지고 축하 소식이면 폭죽도 터진다 (같은 소식은 이 기기에서 한 번).
 */
export function NoticePopup({ notices }: { notices: Notice[] }) {
  const fetcher = useFetcher();
  const fresh = notices.filter((n) => n.is_new);
  const [open, setOpen] = useState(false);

  // 서버 렌더와 어긋나지 않게 화면이 뜬 뒤에 연다. 앱 안에서 화면을 옮겨 다닐 때는 다시 열지 않는다
  useEffect(() => {
    setOpen(fresh.length > 0);
  }, [fresh.length]);

  if (!open) return null;
  const close = () => setOpen(false);
  const neverAgain = () => {
    setOpen(false);
    fetcher.submit({ intent: "seen" }, { method: "post", action: "/app/notices" });
  };
  return (
    <Modal title="클럽 소식" onClose={close}>
      {/* 소식이 뜨면 꽃가루, 축하 소식이 있으면 폭죽까지 (같은 소식은 이 기기에서 한 번) */}
      <Celebration
        inDialog
        fireworks={fresh.some((n) => n.kind === "celebrate")}
        storageKey={`notice-celebration-${fresh.map((n) => n.id).join("-")}`}
      />
      <div className="space-y-3">
        {fresh.map((n) => (
          <NoticeCard key={n.id} notice={n} />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Link to="/app/notices" className="text-link text-sm" onClick={close}>
          지난 소식 보기
        </Link>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="btn-ghost h-11 px-4" onClick={neverAgain}>
            다시 보지 않기
          </button>
          <button type="button" className="btn-primary h-11 px-6" onClick={close}>
            확인
          </button>
        </span>
      </div>
    </Modal>
  );
}
