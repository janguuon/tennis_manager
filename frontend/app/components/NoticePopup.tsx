import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";

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
 * 들어왔을 때 아직 확인하지 않은 클럽 소식을 한 번 띄운다.
 * 확인(또는 닫기)하면 서버에 적어 두어 다른 기기에서도 다시 뜨지 않는다.
 */
export function NoticePopup({ notices }: { notices: Notice[] }) {
  const fetcher = useFetcher();
  const fresh = notices.filter((n) => n.is_new);
  const [open, setOpen] = useState(false);

  // 서버 렌더와 어긋나지 않게 화면이 뜬 뒤에 연다
  useEffect(() => {
    setOpen(fresh.length > 0);
  }, [fresh.length]);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    fetcher.submit({ intent: "seen" }, { method: "post", action: "/app/notices" });
  };
  return (
    <Modal title="클럽 소식" onClose={close}>
      <div className="space-y-3">
        {fresh.map((n) => (
          <NoticeCard key={n.id} notice={n} />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/app/notices" className="text-link text-sm" onClick={close}>
          지난 소식 보기
        </Link>
        <button type="button" className="btn-primary h-11 px-6" onClick={close}>
          확인했어요
        </button>
      </div>
    </Modal>
  );
}
