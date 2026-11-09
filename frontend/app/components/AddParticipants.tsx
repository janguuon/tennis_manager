import { useFetcher } from "@remix-run/react";
import { Search, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { Modal } from "~/components/Modal";
import { genderShort } from "~/lib/club";
import type { Participant, UserBrief } from "~/lib/types";

type Result = {
  ok: boolean;
  error: string | null;
  added?: { name: string; status: string }[];
};

const VOTE_NOTE: Partial<Record<Participant["status"], string>> = {
  absent: "불참 투표",
  maybe: "미정",
};

/**
 * 운영진(관리자·임원진·총무): 회원·가입한 게스트를 골라 모임 참석으로 넣는다
 * (단톡방으로 참석을 말한 사람 등). 고른 순서대로 넣고 정원이 차면 대기 (서버 POST /gatherings/{id}/participants).
 * 이름만 적어 초대하는 게스트는 '게스트 초대'로.
 */
export function AddParticipants({
  roster,
  participants,
  free,
}: {
  /** 회원 목록 (직함 없는 관리자 계정은 뺀 것) */
  roster: UserBrief[];
  participants: Participant[];
  /** 남은 자리 (정원이 없으면 null, 대기자가 있으면 0) */
  free: number | null;
}) {
  const fetcher = useFetcher<Result>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const added = fetcher.state === "idle" && fetcher.data?.ok ? fetcher.data.added : undefined;
    if (!added) return;
    const waiting = added.filter((a) => a.status === "waiting").map((a) => a.name);
    setNote(
      `${added.map((a) => a.name).join(", ")} ${added.length}명을 넣었어요` +
        (waiting.length ? ` (대기 ${waiting.length}명: ${waiting.join(", ")})` : "") +
        ".",
    );
    setPicked([]);
    setQuery("");
    setOpen(false);
  }, [fetcher.state, fetcher.data]);

  const vote = new Map(participants.map((p) => [p.user.id, p.status]));
  const candidates = roster
    .filter((m) => !m.invited_by_id && vote.get(m.id) !== "attending" && vote.get(m.id) !== "waiting")
    // 회원 먼저, 가입한 게스트는 뒤에 (같은 구분 안에서는 회원 목록 순서)
    .sort((a, b) => Number(a.member_type === "guest") - Number(b.member_type === "guest"));
  const q = query.trim();
  const shown = q
    ? candidates.filter((m) => m.name.includes(q) || (m.nickname ?? "").includes(q))
    : candidates;
  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const submit = () => {
    const form = new FormData();
    form.set("intent", "add_participants");
    for (const id of picked) form.append("user_id", String(id));
    fetcher.submit(form, { method: "post" });
  };
  const seatText =
    free === null
      ? "정원 제한이 없어 모두 참석으로 들어가요."
      : free > 0
      ? `남은 자리 ${free}명. 넘으면 고른 순서대로 대기로 들어가요.`
      : "자리가 없어 고른 순서대로 대기로 들어가요.";

  return (
    <>
      <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setOpen(true)}>
        <UserPlus size={14} /> 참가자 추가
      </button>
      {note ? (
        <p
          role="status"
          className="mt-3 flex w-full items-start gap-2 rounded-2xl bg-house-green/25 px-3.5 py-2.5 text-xs font-semibold leading-relaxed"
        >
          <span className="min-w-0 flex-1">{note}</span>
          <button type="button" aria-label="알림 닫기" onClick={() => setNote(null)}>
            <X size={13} />
          </button>
        </p>
      ) : null}
      {open ? (
        <Modal title="참가자 추가" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <p className="text-[13px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              참석으로 넣을 회원을 골라요. 불참으로 투표했던 사람도 참석이 돼요. {seatText}
            </p>
            <label className="relative block">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input !pl-9"
                placeholder="이름으로 찾기"
                aria-label="이름으로 찾기"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
            </label>
            {candidates.length === 0 ? (
              <p className="py-6 text-center text-sm font-medium text-slate-500">넣을 수 있는 회원이 모두 참석·대기 중이에요.</p>
            ) : shown.length === 0 ? (
              <p className="py-6 text-center text-sm font-medium text-slate-500">‘{q}’ 이름의 회원이 없어요.</p>
            ) : (
              <ul className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
                {shown.map((m) => {
                  const order = picked.indexOf(m.id) + 1;
                  const status = vote.get(m.id);
                  const voteNote = status ? VOTE_NOTE[status] : null;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        aria-pressed={order > 0}
                        onClick={() => toggle(m.id)}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] font-semibold transition-colors ${
                          order ? "bg-house-yellow/40" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        <MemberAvatar user={m} className="!h-8 !w-8 shrink-0 !text-xs" />
                        <span className="min-w-0 truncate">{m.name}</span>
                        {genderShort(m.gender) ? (
                          <span className="text-[12px] font-bold text-slate-500">{genderShort(m.gender)}</span>
                        ) : null}
                        {m.member_type === "guest" ? <span className="badge-gray shrink-0">게스트</span> : null}
                        {voteNote ? <span className="shrink-0 text-[11px] font-semibold text-slate-500">{voteNote}</span> : null}
                        <span
                          className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${
                            order ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-slate-300 dark:border-slate-600"
                          }`}
                          aria-hidden="true"
                        >
                          {order || ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {fetcher.state === "idle" && fetcher.data && !fetcher.data.ok ? (
              <p role="alert" className="alert-error">
                {fetcher.data.error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {picked.length ? (
                <button type="button" className="mr-auto text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline" onClick={() => setPicked([])}>
                  고른 것 비우기
                </button>
              ) : null}
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                닫기
              </button>
              <button type="button" className="btn-primary btn-sm" disabled={!picked.length || busy} onClick={submit}>
                <UserPlus size={14} /> {busy ? "넣는 중…" : picked.length ? `${picked.length}명 넣기` : "넣기"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
