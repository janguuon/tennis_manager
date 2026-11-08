import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { CalendarSync, ChevronRight } from "lucide-react";

import { AvatarEditor } from "~/components/AvatarEditor";
import { CopyButton } from "~/components/CopyButton";
import { PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { publicOrigin } from "~/lib/origin.server";
import { requireToken } from "~/lib/session.server";
import { MEMBER_TYPE_LABEL } from "~/lib/status";
import type { Me, User } from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "마이페이지 · 오테식 매니저" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const [user, feed] = await Promise.all([
    api<Me>("/users/me", { token }),
    api<{ token: string | null }>("/users/me/calendar-feed", { token }),
  ]);
  // 참석 일정 구독 주소 (폰 캘린더가 로그인 없이 받아 간다)
  const feedUrl = feed.token
    ? `${publicOrigin(request)}/calendar-feed/${feed.token}/otesik.ics`
    : null;
  return json({ user, feedUrl });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const get = (k: string) => {
    const v = formData.get(k);
    return v != null ? String(v) : undefined;
  };
  const ok = (message: string) =>
    json({ intent, ok: true, message, error: null as string | null });
  const fail = (error: string) =>
    json({ intent, ok: false, message: null as string | null, error });

  if (intent === "profile") {
    const body = {
      name: get("name"),
      nickname: get("nickname") || null,
      // 성별은 비울 수 없다: 고르지 않았으면 보내지 않아 그대로 둔다
      gender: get("gender") || undefined,
      ntrp: get("ntrp") ? Number(get("ntrp")) : null,
      // 연락처는 관리자만 고친다: 칸이 있을 때(관리자)만 보낸다
      ...(formData.has("phone") ? { phone: get("phone") || null } : {}),
      bio: get("bio") || null,
    };
    try {
      await api<User>("/users/me", { method: "PATCH", token, body });
      return ok("내 정보를 저장했습니다.");
    } catch (err) {
      return fail(
        err instanceof ApiError ? err.message : "저장에 실패했습니다."
      );
    }
  }

  if (intent === "account") {
    const body = {
      bank: get("bank")?.trim() || null,
      account_number: get("account_number")?.trim() || null,
      account_holder: get("account_holder")?.trim() || null,
    };
    try {
      await api<User>("/users/me", { method: "PATCH", token, body });
      return ok("환급 계좌를 저장했습니다.");
    } catch (err) {
      return fail(
        err instanceof ApiError ? err.message : "저장에 실패했습니다."
      );
    }
  }

  if (intent === "password") {
    const newPassword = get("new_password") ?? "";
    const confirm = get("confirm_password") ?? "";
    if (newPassword.length < 4) {
      return fail("비밀번호는 4자 이상이어야 합니다.");
    }
    if (newPassword !== confirm) {
      return fail("새 비밀번호가 서로 일치하지 않습니다.");
    }
    try {
      await api("/users/me/password", {
        method: "PUT",
        token,
        body: { new_password: newPassword },
      });
      return ok("비밀번호를 변경했습니다.");
    } catch (err) {
      return fail(
        err instanceof ApiError ? err.message : "비밀번호 변경에 실패했습니다."
      );
    }
  }

  if (intent === "calendar_feed_create" || intent === "calendar_feed_delete") {
    const create = intent === "calendar_feed_create";
    try {
      await api("/users/me/calendar-feed", { method: create ? "POST" : "DELETE", token });
      return ok(
        create
          ? "구독 주소를 만들었어요. 아래 버튼으로 폰 캘린더에 구독해 주세요."
          : "구독을 끊었어요. 폰 캘린더에서 '오테식 참석 일정'을 지워 주세요."
      );
    } catch (err) {
      return fail(err instanceof ApiError ? err.message : "처리하지 못했어요.");
    }
  }

  return fail("알 수 없는 요청입니다.");
}

export default function MyPage() {
  const { user, feedUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("intent") ?? "")
      : "";

  const profileMsg = actionData?.intent === "profile" ? actionData : undefined;
  const passwordMsg =
    actionData?.intent === "password" ? actionData : undefined;
  const accountMsg = actionData?.intent === "account" ? actionData : undefined;
  const feedMsg = actionData?.intent?.startsWith("calendar_feed") ? actionData : undefined;
  const feedBusy = submittingIntent.startsWith("calendar_feed");
  // 아이폰은 webcal:// 을 누르면 '구독' 창이 뜬다. 구글은 cid 로 '캘린더 추가' 화면을 연다(컴퓨터 권장)
  const webcalUrl = feedUrl?.replace(/^https?:/, "webcal:") ?? "";
  const googleUrl = webcalUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : "";

  const msg = (m: typeof profileMsg) =>
    m?.ok ? (
      <p className="alert-success">{m.message}</p>
    ) : m?.error ? (
      <p className="alert-error">{m.error}</p>
    ) : null;

  return (
    <PageBody narrow>
      <PageHeader
        eyebrow="MAKE YOURSELF AT HOME."
        title="나의 클럽 프로필"
        sub="함께하는 식구들에게 나를 소개해 주세요."
      />
      {/* 프로필 머리 */}
      <section className="tile-lav flex items-center gap-4 sm:gap-5">
        <AvatarEditor user={user} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-[30px] font-extrabold leading-tight tracking-[-0.05em] sm:text-[40px]">
              {user.name}
            </h2>
            <span className="chip-ink">
              {user.is_admin ? "관리자" : MEMBER_TYPE_LABEL[user.member_type]}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[14px] font-bold">
            @{user.username}
            {user.email ? ` · ${user.email}` : ""} ·{" "}
            {user.created_at.slice(0, 10)} 가입
          </p>
        </div>
      </section>

      {/* 내 정보 수정 */}
      <section className="card">
        <h2 className="section-title">프로필</h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          대진 편성에 쓰이는 정보예요 (성별 · NTRP).
        </p>
        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="intent" value="profile" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="name">
                이름
              </label>
              <input
                id="name"
                name="name"
                className="input"
                required
                defaultValue={user.name}
              />
            </div>
            <div>
              <label className="label" htmlFor="nickname">
                닉네임
              </label>
              <input
                id="nickname"
                name="nickname"
                className="input"
                defaultValue={user.nickname ?? ""}
              />
            </div>
            <div>
              <label className="label" htmlFor="gender">
                성별
              </label>
              <select
                id="gender"
                name="gender"
                className="input"
                defaultValue={user.gender ?? ""}
                required
                onChange={(e) => e.target.setCustomValidity("")}
                onInvalid={(e) =>
                  e.currentTarget.setCustomValidity("성별을 골라 주세요.")
                }
              >
                {user.gender ? null : (
                  <option value="" disabled>
                    골라 주세요
                  </option>
                )}
                <option value="male">남성</option>
                <option value="female">여성</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ntrp">
                NTRP
              </label>
              <input
                id="ntrp"
                name="ntrp"
                type="number"
                step="0.5"
                min="1"
                max="7"
                className="input"
                placeholder="1.0 ~ 7.0"
                defaultValue={user.ntrp ?? ""}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="phone">
              연락처
            </label>
            {user.is_admin ? (
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                className="input"
                placeholder="010-1234-5678"
                defaultValue={user.phone ?? ""}
              />
            ) : (
              <>
                <input
                  id="phone"
                  className="input"
                  value={user.phone ?? ""}
                  placeholder="아직 등록되지 않았어요"
                  readOnly
                  disabled
                />
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  연락처는 관리자가 등록해요. 바꾸려면 관리자에게 말해 주세요.
                </p>
              </>
            )}
          </div>
          <div>
            <label className="label" htmlFor="bio">
              소개
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={2}
              className="input"
              defaultValue={user.bio ?? ""}
            />
          </div>

          {msg(profileMsg)}

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary"
              disabled={submittingIntent === "profile"}
            >
              {submittingIntent === "profile" ? "저장 중…" : "저장"}
            </button>
          </div>
        </Form>
      </section>

      {/* 참석 일정 구독: 참석·대기 모임이 폰 캘린더에 알아서 들어오고 바뀐다 */}
      <section className="card scroll-mt-4" id="calendar-feed">
        <h2 className="section-title flex items-center gap-2">
          <CalendarSync size={18} />
          참석 일정 구독
        </h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          참석(대기 포함)으로 투표한 모임이 폰 캘린더에 알아서 들어와요. 시간이
          바뀌거나 모임이 취소되거나 불참으로 바꾸면 캘린더도 따라 바뀌어요.
        </p>
        {feedUrl ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <a href={webcalUrl} className="add-calendar-option">
                <span>
                  <strong>아이폰 · 맥 캘린더에 구독</strong>
                  <small>누르고 ‘구독’ → ‘추가’</small>
                </span>
                <ChevronRight size={16} className="shrink-0 opacity-50" />
              </a>
              <a
                href={googleUrl}
                target="_blank"
                rel="noreferrer"
                className="add-calendar-option"
              >
                <span>
                  <strong>구글 캘린더에 추가</strong>
                  <small>컴퓨터에서 열면 바로 추가돼요</small>
                </span>
                <ChevronRight size={16} className="shrink-0 opacity-50" />
              </a>
            </div>
            <div>
              <label className="label" htmlFor="feed_url">
                구독 주소 (다른 캘린더 앱에 붙여 넣기)
              </label>
              <div className="flex gap-2">
                <input
                  id="feed_url"
                  className="input min-w-0 flex-1 text-xs"
                  readOnly
                  value={feedUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton text={feedUrl} className="shrink-0" />
              </div>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              <li>나만 쓰는 비밀 주소예요. 다른 사람에게 보내지 마세요.</li>
              <li>
                캘린더가 주기적으로 다시 받아 와요. 아이폰은 보통 몇십 분~몇 시간,
                구글은 반나절~하루쯤 걸려요.
              </li>
              <li>
                안드로이드 구글 캘린더 앱에서는 구독을 바로 추가할 수 없어요.
                컴퓨터에서 구글 캘린더에 추가하면 폰에도 보여요(앱 설정에서
                ‘오테식 참석 일정’ 동기화를 켜 주세요).
              </li>
            </ul>
            {msg(feedMsg)}
            <div className="flex flex-wrap justify-end gap-2">
              <Form
                method="post"
                onSubmit={(e) => {
                  if (
                    !confirm(
                      "구독 주소를 새로 만들까요? 예전 주소로 구독한 캘린더는 더 이상 바뀌지 않아요(지우고 새로 구독해 주세요)."
                    )
                  )
                    e.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="calendar_feed_create" />
                <button className="btn-ghost btn-sm" disabled={feedBusy}>
                  주소 다시 만들기
                </button>
              </Form>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("구독을 끊을까요? 폰 캘린더의 ‘오테식 참석 일정’이 더 이상 바뀌지 않아요."))
                    e.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="calendar_feed_delete" />
                <button className="btn-ghost btn-sm" disabled={feedBusy}>
                  구독 끊기
                </button>
              </Form>
            </div>
          </div>
        ) : (
          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="calendar_feed_create" />
            {msg(feedMsg)}
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={feedBusy}>
                <CalendarSync size={16} />
                {feedBusy ? "만드는 중…" : "구독 주소 만들기"}
              </button>
            </div>
          </Form>
        )}
      </section>

      {/* 환급 계좌: 오테식 모임 코트비를 돌려받을 때 */}
      <section className="card">
        <h2 className="section-title">환급 계좌</h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          오테식 모임 코트를 잡으면 총무가 이 계좌로 코트비를 보내요. 관리자와
          총무에게만 보여요.
        </p>
        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="intent" value="account" />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="bank">
                은행
              </label>
              <input
                id="bank"
                name="bank"
                className="input"
                placeholder="국민"
                defaultValue={user.bank ?? ""}
              />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="account_number">
                계좌번호
              </label>
              <input
                id="account_number"
                name="account_number"
                className="input"
                placeholder="123-456-7890"
                defaultValue={user.account_number ?? ""}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="account_holder">
              예금주
            </label>
            <input
              id="account_holder"
              name="account_holder"
              className="input"
              placeholder={user.name}
              defaultValue={user.account_holder ?? ""}
            />
          </div>

          {msg(accountMsg)}

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary"
              disabled={submittingIntent === "account"}
            >
              {submittingIntent === "account" ? "저장 중…" : "저장"}
            </button>
          </div>
        </Form>
      </section>

      {/* 비밀번호 변경 */}
      <section className="card">
        <h2 className="section-title">비밀번호</h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          4자 이상으로 바꿀 수 있어요.
        </p>
        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="intent" value="password" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="new_password">
                새 비밀번호
              </label>
              <input
                id="new_password"
                name="new_password"
                type="password"
                className="input"
                required
                minLength={4}
              />
            </div>
            <div>
              <label className="label" htmlFor="confirm_password">
                새 비밀번호 확인
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                className="input"
                required
                minLength={4}
              />
            </div>
          </div>

          {msg(passwordMsg)}

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary"
              disabled={submittingIntent === "password"}
            >
              {submittingIntent === "password" ? "변경 중…" : "비밀번호 변경"}
            </button>
          </div>
        </Form>
      </section>
    </PageBody>
  );
}
