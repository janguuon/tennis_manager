import type { PushSettings } from "~/lib/types";

/**
 * 폰 알림(웹 푸시) — 브라우저 쪽. 화면(버튼 누름)에서만 부른다.
 *
 * - 안드로이드: 크롬 브라우저·설치한 앱 모두 된다.
 * - 아이폰: iOS 16.4+ 에서 **홈 화면에 추가한 앱 안에서만** 된다 (사파리 탭에서는 안 됨).
 * - 허용 창(Notification.requestPermission)은 버튼을 누른 그 순간에 바로 불러야 아이폰에서 뜬다.
 *
 * 서버 단계는 /resources/push (Remix) → 백엔드 /push/*.
 */
export type PushSupport =
  | "ok"
  | "ios-browser" // 아이폰 사파리 탭: 홈 화면에 추가해야 한다
  | "unsupported"; // 알림을 못 받는 브라우저 (아이폰 16.4 전 등)

const SW_URL = "/sw.js";

export function isIos(): boolean {
  if (/Android/i.test(navigator.userAgent)) return false;
  // 아이패드는 맥처럼 보이므로 터치로 가린다
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return "ios-browser";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return "ok";
}

/** 서비스 워커 등록 (앱을 열 때마다 불러도 된다: 이미 있으면 그대로) */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register(SW_URL).catch(() => null);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

type PushResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(body: Record<string, unknown>): Promise<PushResult<T>> {
  try {
    const res = await fetch("/resources/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { result?: T; error?: string };
    return res.ok && data.result !== undefined
      ? { ok: true, data: data.result }
      : { ok: false, error: data.error ?? "잠시 뒤 다시 해 주세요." };
  } catch {
    return { ok: false, error: "인터넷 연결을 확인해 주세요." };
  }
}

export async function fetchPushSettings(): Promise<PushSettings | null> {
  try {
    const res = await fetch("/resources/push");
    return res.ok ? ((await res.json()) as PushSettings) : null;
  } catch {
    return null;
  }
}

/**
 * 이 폰에서 알림 받기: 허용 창 → 서비스 워커 → 구독 → 서버에 등록.
 * 버튼 onClick 안에서 다른 await 보다 먼저 부른다 (아이폰은 누른 순간에만 허용 창이 뜬다).
 */
export async function enablePush(publicKey?: string): Promise<PushResult<PushSettings>> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      error:
        permission === "denied"
          ? "알림이 막혀 있어요. 폰 설정 → 알림에서 이 앱(또는 크롬)을 허용해 주세요."
          : "알림을 허용해야 받을 수 있어요.",
    };
  }
  const key = publicKey ?? (await fetchPushSettings())?.public_key;
  if (!key) return { ok: false, error: "잠시 뒤 다시 해 주세요." };
  try {
    const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
    await navigator.serviceWorker.ready;
    const appKey = keyBytes(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, appKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    return saveSubscription(sub);
  } catch {
    return { ok: false, error: "이 브라우저에서 알림을 켜지 못했어요. 크롬(안드로이드)이나 홈 화면 앱(아이폰)에서 해 주세요." };
  }
}

/** 브라우저가 가진 구독을 서버에 (다시) 등록한다. 같은 기기면 덮어쓴다 */
export function saveSubscription(sub: PushSubscription): Promise<PushResult<PushSettings>> {
  return call<PushSettings>({ intent: "subscribe", subscription: sub.toJSON(), user_agent: navigator.userAgent });
}

/** 이 폰 알림 끄기: 서버에서 지우고 브라우저 구독도 푼다 */
export async function disablePush(): Promise<PushResult<PushSettings>> {
  const sub = await currentSubscription();
  if (!sub) return { ok: false, error: "이 폰은 알림이 꺼져 있어요." };
  const result = await call<PushSettings>({ intent: "unsubscribe", endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => undefined);
  return result;
}

export async function testPush(): Promise<PushResult<{ sent: number; failed: number }>> {
  const sub = await currentSubscription();
  return call({ intent: "test", endpoint: sub?.endpoint ?? null });
}

export function savePushKinds(kinds: Partial<PushSettings["kinds"]>): Promise<PushResult<PushSettings>> {
  return call<PushSettings>({ intent: "kinds", kinds });
}
