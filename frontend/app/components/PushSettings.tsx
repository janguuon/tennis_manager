import { Bell, BellOff, BellRing, Check, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  currentSubscription,
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  pushSupport,
  saveSubscription,
  savePushKinds,
  testPush,
  type PushSupport,
} from "~/lib/push";
import type { PushKind, PushSettings as Settings } from "~/lib/types";

const KIND_ROWS: { kind: PushKind; label: string; sub: string; memberOnly?: boolean }[] = [
  { kind: "match", label: "내 경기", sub: "경기 시작(코트 번호)과 다음 차례" },
  { kind: "reminder", label: "참석 일정 1시간 전", sub: "참석으로 투표한 모임이 곧 시작할 때" },
  { kind: "waitlist", label: "대기 → 참석", sub: "대기하던 모임에 자리가 났을 때" },
  { kind: "schedule", label: "일정 공개", sub: "다음 주 일정이 열릴 때 (금요일 오전 10시)", memberOnly: true },
  { kind: "news", label: "클럽 소식", sub: "운영진 소식, 교류전·대회 결과" },
];

type DeviceState = "loading" | PushSupport | "denied" | "off" | "on";

/**
 * 마이페이지 '폰 알림': 이 폰에서 알림 받기·끄기·시험, 종류별 켜기/끄기.
 * 종류 설정은 회원 것이라 알림을 켠 모든 기기에 같이 적용된다.
 */
export function PushSettings({ initial }: { initial: Settings | null }) {
  const [settings, setSettings] = useState<Settings | null>(initial);
  const [device, setDevice] = useState<DeviceState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 이 폰의 상태. 브라우저에 구독이 있으면 서버에도 다시 알려 둔다 (지워졌거나 다른 아이디였을 때 맞춘다)
  useEffect(() => {
    const support = pushSupport();
    if (support !== "ok") return setDevice(support);
    if (Notification.permission === "denied") return setDevice("denied");
    currentSubscription()
      .then(async (sub) => {
        if (!sub) return setDevice("off");
        setDevice("on");
        const r = await saveSubscription(sub);
        if (r.ok) setSettings(r.data);
      })
      .catch(() => setDevice("off"));
  }, []);

  const run = async (job: () => Promise<{ ok: boolean; text: string } | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await job());
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      // 허용 창은 누른 순간에 바로 (enablePush 가 맨 먼저 부른다)
      const r = await enablePush(settings?.public_key);
      if (!r.ok) {
        if (Notification.permission === "denied") setDevice("denied");
        return { ok: false, text: r.error };
      }
      setSettings(r.data);
      setDevice("on");
      return { ok: true, text: "이 폰에서 알림을 받아요. ‘시험 알림’으로 확인해 보세요." };
    });

  const turnOff = () =>
    run(async () => {
      const r = await disablePush();
      setDevice("off");
      if (r.ok) setSettings(r.data);
      return { ok: true, text: "이 폰 알림을 껐어요." };
    });

  const sendTest = () =>
    run(async () => {
      const r = await testPush();
      if (!r.ok) return { ok: false, text: r.error };
      return r.data.sent
        ? { ok: true, text: "시험 알림을 보냈어요. 몇 초 안에 와요." }
        : { ok: false, text: "알림을 보내지 못했어요. 이 폰 알림을 껐다가 다시 켜 주세요." };
    });

  const toggle = async (kind: PushKind, on: boolean) => {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, kinds: { ...settings.kinds, [kind]: on } });
    const r = await savePushKinds({ [kind]: on });
    if (r.ok) setSettings(r.data);
    else {
      setSettings(before);
      setMessage({ ok: false, text: r.error });
    }
  };

  const rows = KIND_ROWS.filter((r) => !(r.memberOnly && settings?.guest));
  return (
    <section className="card scroll-mt-4" id="push">
      <h2 className="section-title flex items-center gap-2">
        <Bell size={18} />
        폰 알림
      </h2>
      <p className="mt-1 text-[13px] font-medium text-slate-500">
        내 경기 코트 번호, 참석 일정 1시간 전, 새 일정과 소식을 폰으로 알려 드려요.
      </p>

      <div className="push-device mt-5">
        {device === "loading" ? (
          <p className="text-[13px] font-medium text-slate-500">이 폰의 알림 상태를 확인하고 있어요…</p>
        ) : device === "ios-browser" ? (
          <div className="space-y-3">
            <p className="text-[14px] font-bold">아이폰은 홈 화면에 추가한 앱에서 알림을 받을 수 있어요.</p>
            <ol className="space-y-2 text-[13px] font-medium">
              <li className="flex items-center gap-2">
                <span className="push-step">1</span>사파리 아래쪽 <Share size={15} aria-label="공유" /> 공유 버튼
              </li>
              <li className="flex items-center gap-2">
                <span className="push-step">2</span>
                <SquarePlus size={15} aria-hidden="true" /> ‘홈 화면에 추가’
              </li>
              <li className="flex items-center gap-2">
                <span className="push-step">3</span>홈 화면의 ‘오테식’ 앱을 열고 여기서 ‘알림 받기’
              </li>
            </ol>
            <p className="text-xs font-medium text-slate-500">iOS 16.4 이상에서 돼요. 앱에서는 한 번 더 로그인해 주세요.</p>
          </div>
        ) : device === "unsupported" ? (
          <p className="text-[13px] font-medium">
            이 브라우저는 알림을 받을 수 없어요. 안드로이드는 크롬에서,{" "}
            {isIos() ? "아이폰은 iOS 16.4 이상으로 업데이트한 뒤 홈 화면 앱에서" : "아이폰은 홈 화면에 추가한 앱에서"} 켜 주세요.
          </p>
        ) : device === "denied" ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-[14px] font-bold">
              <BellOff size={16} /> 이 폰에서 알림이 막혀 있어요
            </p>
            <p className="text-[13px] font-medium text-slate-500">
              {isIos()
                ? "아이폰 설정 → 알림 → 오테식에서 알림 허용을 켠 뒤 이 화면을 다시 열어 주세요."
                : isStandalone()
                  ? "폰 설정 → 애플리케이션 → 오테식 → 알림을 켠 뒤 이 화면을 다시 열어 주세요."
                  : "주소창 왼쪽 자물쇠(사이트 설정) → 알림 → 허용으로 바꾼 뒤 새로고침해 주세요."}
            </p>
          </div>
        ) : device === "on" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-2 text-[14px] font-bold">
              <BellRing size={16} /> 이 폰으로 알림을 받고 있어요
            </p>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className="btn-ghost btn-sm" onClick={sendTest} disabled={busy}>
                시험 알림
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={turnOff} disabled={busy}>
                이 폰 알림 끄기
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[14px] font-bold">이 폰은 아직 알림을 받지 않아요</p>
            <button type="button" className="btn-primary ml-auto" onClick={turnOn} disabled={busy}>
              <Bell size={16} />
              {busy ? "켜는 중…" : "이 폰에서 알림 받기"}
            </button>
          </div>
        )}
        {message ? <p className={`mt-3 ${message.ok ? "alert-success" : "alert-error"}`}>{message.text}</p> : null}
      </div>

      {settings ? (
        <div className="mt-5">
          <p className="label">받을 알림</p>
          <ul className="push-kinds">
            {rows.map((r) => (
              <li key={r.kind}>
                <label className="push-kind">
                  <span className="min-w-0">
                    <strong>{r.label}</strong>
                    <small>{r.sub}</small>
                  </span>
                  <input
                    type="checkbox"
                    className="push-switch"
                    checked={settings.kinds[r.kind]}
                    onChange={(e) => toggle(r.kind, e.currentTarget.checked)}
                  />
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {settings.devices
              ? `알림을 켠 기기 ${settings.devices}대에 같이 적용돼요.`
              : "알림을 켠 기기가 아직 없어요."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

const PROMPT_KEY = "otesik.push-prompt";

/**
 * 홈의 '알림 켜기' 안내: 휴대폰에서 알림을 아직 정하지 않았을 때 한 번. 닫으면 다시 안 뜬다 (마이페이지에서 켤 수 있다).
 * 아이폰 사파리 탭에서는 홈 화면에 추가하라고 안내만 한다.
 */
export function PushPrompt() {
  const [show, setShow] = useState<"ask" | "ios" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(PROMPT_KEY)) return;
    } catch {
      return;
    }
    if (!window.matchMedia("(pointer: coarse)").matches) return; // 휴대폰에서만
    const support = pushSupport();
    if (support === "ios-browser") return setShow("ios");
    if (support !== "ok" || Notification.permission !== "default") return;
    currentSubscription()
      .then((sub) => setShow(sub ? null : "ask"))
      .catch(() => undefined);
  }, []);

  const close = () => {
    try {
      localStorage.setItem(PROMPT_KEY, "1");
    } catch {
      /* 저장 못 해도 이번엔 닫는다 */
    }
    setShow(null);
  };

  if (!show) return null;
  return (
    <section className="push-prompt" aria-label="폰 알림 켜기">
      <BellRing size={22} className="shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {done ? (
          <p className="flex items-center gap-1.5 text-[14px] font-bold">
            <Check size={16} /> 알림을 켰어요. 종류는 마이페이지에서 고를 수 있어요.
          </p>
        ) : show === "ios" ? (
          <>
            <p className="text-[14px] font-extrabold">경기 코트 번호를 폰 알림으로 받아 보세요</p>
            <p className="mt-0.5 text-[12px] font-semibold opacity-80">
              사파리 공유 버튼 → ‘홈 화면에 추가’ → 그 앱의 마이페이지에서 알림을 켜요.
            </p>
          </>
        ) : (
          <>
            <p className="text-[14px] font-extrabold">경기 코트 번호를 폰 알림으로 받아 보세요</p>
            <p className="mt-0.5 text-[12px] font-semibold opacity-80">내 경기 시작, 참석 일정 1시간 전, 새 일정을 알려 드려요.</p>
            {error ? <p className="mt-1 text-[12px] font-bold text-[#B42318]">{error}</p> : null}
          </>
        )}
      </div>
      {show === "ask" && !done ? (
        <button
          type="button"
          className="btn-primary btn-sm shrink-0"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await enablePush();
            setBusy(false);
            if (r.ok) {
              setDone(true);
              try {
                localStorage.setItem(PROMPT_KEY, "1");
              } catch {
                /* 무시 */
              }
            } else setError(r.error);
          }}
        >
          {busy ? "켜는 중…" : "알림 켜기"}
        </button>
      ) : null}
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-ink/10"
        aria-label="닫기"
        onClick={close}
      >
        <X size={16} />
      </button>
    </section>
  );
}
