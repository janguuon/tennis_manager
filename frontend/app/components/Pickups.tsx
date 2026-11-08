import { useFetcher } from "@remix-run/react";
import { Car, Clock, MapPin, Pencil, Share2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { Modal } from "~/components/Modal";
import { formatDate } from "~/lib/format";
import { linkSuffix, shareTextToKakao, withLink } from "~/lib/kakao";
import type { GatheringDetail, Me, Pickup } from "~/lib/types";

type Result = { ok: boolean; error: string | null };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

function ways(p: Pick<Pickup, "going" | "coming_back">): string {
  return [p.going ? "갈 때" : "", p.coming_back ? "올 때" : ""]
    .filter(Boolean)
    .join("·");
}

/** 단톡방 문구: 아직 태워 갈 사람을 찾는 요청들 + 모임 주소 (카톡은 200자 안, 복사는 전체) */
function pickupNotice(g: GatheringDetail, list: Pickup[], url: string) {
  const when = `${formatDate(g.event_date)}${
    g.start_time ? ` ${hhmm(g.start_time)}` : ""
  }`;
  const lines = [
    `🚗 픽업 요청 · ${when} ${g.title}`,
    g.location ? `📍 ${g.location}` : "",
    ...list.map((p) => {
      const where = [p.meet_place, hhmm(p.meet_time)].filter(Boolean).join(" ");
      return `🙋 ${p.requester.name}${where ? ` · ${where}` : ""} (${ways(p)})`;
    }),
    "태워 줄 수 있는 분은 모임 화면에서 ‘제가 태워 갈게요’를 눌러 주세요!",
  ].filter(Boolean);
  const body = lines.join("\n");
  return {
    short: withLink(body, "모임 보기", url),
    full: body + linkSuffix("모임 보기", url),
  };
}

/** 원하면 단톡방에 따로 알리기 (요청자가 꼭 하지 않아도 모임 카톡 공유 글에 'N명'이 실린다) */
function PickupShare({
  gathering,
  list,
}: {
  gathering: GatheringDetail;
  list: Pickup[];
}) {
  const path = `/app/gatherings/${gathering.id}`;
  // 링크는 지금 접속한 주소 기준 (브라우저에서만 알 수 있다)
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const text = pickupNotice(gathering, list, `${origin}${path}`);
  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        모임 카톡 공유 글에 ‘같이 타고 갈 식구 {list.length}명’이 함께 실려요.
        원하면 따로 알릴 수도 있어요.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() =>
            shareTextToKakao({
              text: text.short,
              path,
              buttonTitle: "모임 보기",
            })
          }
        >
          <Share2 size={14} />
          단톡방에 알리기
        </button>
        <CopyButton text={text.full} label="문구 복사" />
      </div>
    </div>
  );
}

/**
 * 픽업 요청 쓰기·고치기 창. 갈 때·올 때만 고르면 되고 나머지는 선택이다.
 * 요청하면 창만 닫는다 (단톡방에 직접 알리지 않아도 모임 화면·모임 카톡 공유 글에 보인다).
 */
function PickupForm({
  editing,
  onClose,
}: {
  editing: Pickup | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<Result>();
  const busy = fetcher.state !== "idle";
  const [going, setGoing] = useState(editing ? editing.going : true);
  const [back, setBack] = useState(editing ? editing.coming_back : false);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Modal title={editing ? "픽업 요청 고치기" : "픽업 요청"} onClose={onClose}>
      <fetcher.Form method="post" className="space-y-4">
        <input
          type="hidden"
          name="intent"
          value={editing ? "pickup_update" : "pickup_create"}
        />
        {editing ? (
          <input type="hidden" name="pickup_id" value={editing.id} />
        ) : null}
        <fieldset>
          <legend className="label">언제 필요해요?</legend>
          <div className="flex gap-2">
            {(
              [
                ["going", "갈 때", going, setGoing],
                ["coming_back", "올 때", back, setBack],
              ] as const
            ).map(([name, label, checked, set]) => (
              <label
                key={name}
                className={`flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border-[1.5px] text-sm font-bold transition-colors ${
                  checked
                    ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-ink"
                    : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                }`}
              >
                <input
                  type="checkbox"
                  name={name}
                  checked={checked}
                  onChange={(e) => set(e.currentTarget.checked)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            이것만 고르면 돼요. 아래는 모두 선택이라, 만날 곳·시각은 태워 갈
            식구가 정해진 뒤 단톡방에서 정해도 괜찮아요.
          </p>
        </fieldset>
        <div>
          <label className="label" htmlFor="meet_place">
            만날 곳 <span className="font-normal text-slate-400">(선택)</span>
          </label>
          <input
            id="meet_place"
            name="meet_place"
            maxLength={100}
            defaultValue={editing?.meet_place ?? ""}
            placeholder="예: 영통 근처, 수원역 4번 출구"
            className="input"
          />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            동네 정도만 적어도 돼요. 집 주소는 적지 않아도 돼요.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="meet_time">
            만날 시각 <span className="font-normal text-slate-400">(선택)</span>
          </label>
          <input
            id="meet_time"
            name="meet_time"
            type="time"
            step={300}
            defaultValue={hhmm(editing?.meet_time ?? null)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="pickup_note">
            남길 말 <span className="font-normal text-slate-400">(선택)</span>
          </label>
          <input
            id="pickup_note"
            name="note"
            maxLength={200}
            defaultValue={editing?.note ?? ""}
            placeholder="예: 라켓 가방이 커요"
            className="input"
          />
        </div>
        {!going && !back ? (
          <p role="alert" className="alert-error">
            갈 때·올 때 중 하나는 골라 주세요.
          </p>
        ) : null}
        {fetcher.state === "idle" && fetcher.data?.error ? (
          <p role="alert" className="alert-error">
            {fetcher.data.error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost h-12 flex-1"
            onClick={onClose}
          >
            닫기
          </button>
          <button
            className="btn-primary h-12 flex-[2]"
            disabled={busy || (!going && !back)}
          >
            <Car size={16} />
            {busy ? "보내는 중…" : editing ? "고치기" : "요청하기"}
          </button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

/**
 * 모임 화면의 '같이 타고 가요': 픽업 요청 목록, 요청하기, 제가 태워 갈게요.
 * 참석자만 요청·수락한다(서버와 같음). 연락처는 보여 주지 않고 단톡방에서 연락한다.
 */
export function PickupSection({
  gathering,
  user,
  attending,
  staff,
  className = "",
}: {
  gathering: GatheringDetail;
  user: Me;
  attending: boolean;
  staff: boolean;
  className?: string;
}) {
  const pickups = gathering.pickups ?? [];
  const fetcher = useFetcher<Result>();
  const busy = fetcher.state !== "idle";
  const [form, setForm] = useState<{ editing: Pickup | null } | null>(null);
  const closeForm = useCallback(() => setForm(null), []);
  const mine = pickups.find((p) => p.requester.id === user.id) ?? null;
  const open = pickups.filter((p) => !p.driver);

  const act = (intent: string, p: Pickup, ask?: string) => {
    if (ask && !confirm(ask)) return;
    fetcher.submit({ intent, pickup_id: String(p.id) }, { method: "post" });
  };

  return (
    <section id="pickups" className={`card detail-pickups ${className}`}>
      <h2 className="section-title flex items-center gap-2">
        <Car size={20} />
        같이 타고 가요
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        차가 없어 오기 어려우면 픽업을 요청해 보세요. 차 있는 식구가 태워 갈 수
        있어요.
      </p>

      {pickups.length ? (
        <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
          {pickups.map((p) => {
            const isMine = p.requester.id === user.id;
            const iDrive = p.driver?.id === user.id;
            return (
              <li key={p.id} className="flex gap-3 py-4">
                <MemberAvatar
                  user={p.requester}
                  className="!h-9 !w-9 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                    {p.requester.name}
                    {isMine ? (
                      <span className="text-xs font-semibold text-slate-400">
                        나
                      </span>
                    ) : null}
                    {p.going ? <span className="badge-line">갈 때</span> : null}
                    {p.coming_back ? (
                      <span className="badge-line">올 때</span>
                    ) : null}
                  </p>
                  {p.meet_place || p.meet_time ? (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                      {p.meet_place ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <MapPin size={13} className="shrink-0" />
                          <span className="break-keep [overflow-wrap:anywhere]">
                            {p.meet_place}
                          </span>
                        </span>
                      ) : null}
                      {p.meet_time ? (
                        <span className="flex items-center gap-1">
                          <Clock size={13} />
                          {hhmm(p.meet_time)}
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      만날 곳·시각은 단톡방에서 정해요
                    </p>
                  )}
                  {p.note ? (
                    <p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">
                      {p.note}
                    </p>
                  ) : null}

                  {p.driver ? (
                    <div className="mt-2.5">
                      <p className="inline-flex items-center gap-1.5 rounded-full bg-house-green/35 px-2.5 py-1 text-xs font-bold text-ink dark:bg-house-green/25 dark:text-white">
                        <Car size={13} />
                        {iDrive
                          ? "내가 태워 가요"
                          : `${p.driver.name}님이 태워 가요`}
                      </p>
                      {isMine || iDrive ? (
                        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          만날 곳·시각은 단톡방에서 서로 연락해 맞춰 주세요.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2.5">
                      <span className="badge-orange-soft">
                        <Car size={12} />
                        태워 갈 사람을 찾고 있어요
                      </span>
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap gap-1.5 empty:hidden">
                    {!p.driver && attending && !isMine ? (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => act("pickup_accept", p)}
                      >
                        <Car size={14} />
                        제가 태워 갈게요
                      </button>
                    ) : null}
                    {iDrive ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          act(
                            "pickup_release",
                            p,
                            `${p.requester.name}님을 태워 가지 못하게 됐나요? 다시 태워 갈 사람을 찾는 중으로 바뀌어요.`
                          )
                        }
                      >
                        못 가게 됐어요
                      </button>
                    ) : null}
                    {isMine ? (
                      <>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setForm({ editing: p })}
                        >
                          <Pencil size={13} />
                          고치기
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() =>
                            act(
                              "pickup_delete",
                              p,
                              p.driver
                                ? `${p.driver.name}님이 태워 가기로 했어요. 요청을 취소할까요? 단톡방에서도 알려 주세요.`
                                : "픽업 요청을 취소할까요?"
                            )
                          }
                        >
                          <X size={13} />
                          요청 취소
                        </button>
                      </>
                    ) : staff ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          act(
                            "pickup_delete",
                            p,
                            `${p.requester.name}님의 픽업 요청을 지울까요?`
                          )
                        }
                      >
                        <X size={13} />
                        지우기
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-sm text-slate-500 dark:text-slate-400">
          아직 픽업 요청이 없어요.
        </p>
      )}

      {fetcher.state === "idle" && fetcher.data?.error ? (
        <p role="alert" className="alert-error mt-2">
          {fetcher.data.error}
        </p>
      ) : null}

      <div className="mt-3 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
        {!mine && attending ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setForm({ editing: null })}
          >
            <Car size={14} />
            픽업 요청
          </button>
        ) : !mine ? (
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            참석으로 투표하면 픽업을 요청하거나 태워 갈 수 있어요.
          </p>
        ) : null}
        {open.length ? <PickupShare gathering={gathering} list={open} /> : null}
      </div>

      {form ? <PickupForm editing={form.editing} onClose={closeForm} /> : null}
    </section>
  );
}
