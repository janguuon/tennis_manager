import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Megaphone, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { NOTICE_ICON, NoticeCard } from "~/components/NoticePopup";
import { PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { isStaff } from "~/lib/club";
import { requireToken } from "~/lib/session.server";
import type { Me, Notice } from "~/lib/types";

/**
 * 클럽 소식 (/app/notices).
 * 회원은 게시 중인 소식을 보고, 운영진(관리자·임원진·총무)은 축하·소식을 올리고 지운다.
 * 올린 소식은 회원이 들어올 때 팝업으로 한 번 뜬다(NoticePopup).
 */
export const meta: MetaFunction = () => [{ title: "클럽 소식 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const me = await api<Me>("/users/me", { token });
  const staff = isStaff(me);
  const notices = await api<Notice[]>(`/notices${staff ? "?all=true" : ""}`, {
    token,
  });
  // 게시 종료일 기본값: 2주 뒤 (KST 기준 오늘)
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const today = kst.toISOString().slice(0, 10);
  kst.setUTCDate(kst.getUTCDate() + 14);
  return json({ staff, notices, today, defaultUntil: kst.toISOString().slice(0, 10) });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  try {
    if (intent === "seen") {
      await api("/notices/seen", { method: "POST", token });
    } else if (intent === "create") {
      await api("/notices", {
        method: "POST",
        token,
        body: {
          kind: formData.get("kind") === "celebrate" ? "celebrate" : "news",
          title: String(formData.get("title") ?? ""),
          body: String(formData.get("body") ?? ""),
          show_until: String(formData.get("show_until") ?? "") || null,
        },
      });
      return json({ ok: true, error: null as string | null, created: true });
    } else if (intent === "delete") {
      await api(`/notices/${formData.get("id")}`, { method: "DELETE", token });
    }
    return json({ ok: true, error: null as string | null, created: false });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "처리에 실패했어요.";
    return json({ ok: false, error: message, created: false }, { status: 400 });
  }
}

export default function NoticesPage() {
  const { staff, notices, today, defaultUntil } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = navigation.state !== "idle";

  // 올리고 나면 입력 칸을 비운다
  useEffect(() => {
    if (actionData?.created) formRef.current?.reset();
  }, [actionData]);

  const live = notices.filter((n) => !n.show_until || n.show_until >= today);
  const ended = notices.filter((n) => n.show_until && n.show_until < today);

  return (
    <PageBody narrow>
      <PageHeader
        eyebrow="CLUB NEWS"
        title="클럽 소식"
        sub="대회 입상 축하, 클럽의 새 소식을 모아 봐요. 새 소식은 들어올 때 한 번 알려 드려요."
      />

      {staff ? (
        <section className="card">
          <h2 className="tile-title flex items-center gap-2">
            <Megaphone size={18} /> 소식 올리기
          </h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500">
            올리면 회원이 다음에 들어올 때 팝업으로 떠요. 운영진(관리자·임원진·총무)만 올릴 수 있어요.
          </p>
          <Form ref={formRef} method="post" className="mt-4 space-y-3">
            <input type="hidden" name="intent" value="create" />
            <fieldset className="flex gap-2">
              <legend className="label">종류</legend>
              {(["celebrate", "news"] as const).map((k) => (
                <label key={k} className="flex-1">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    defaultChecked={k === "celebrate"}
                    className="peer sr-only"
                  />
                  <span className="btn-ghost h-11 w-full cursor-pointer peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2 dark:peer-checked:bg-white dark:peer-checked:text-ink">
                    {NOTICE_ICON[k]} {k === "celebrate" ? "축하" : "소식"}
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <label className="label" htmlFor="n_title">
                제목
              </label>
              <input
                id="n_title"
                name="title"
                required
                maxLength={100}
                className="input"
                placeholder="예: 김오테 님, OO오픈 개나리부 우승!"
              />
            </div>
            <div>
              <label className="label" htmlFor="n_body">
                내용 (선택)
              </label>
              <textarea
                id="n_body"
                name="body"
                rows={4}
                maxLength={1000}
                className="input h-auto py-3"
                placeholder="축하 메시지나 자세한 소식을 적어 주세요."
              />
            </div>
            <div>
              <label className="label" htmlFor="n_until">
                이 날까지 보이기 (비우면 지울 때까지)
              </label>
              <input
                id="n_until"
                name="show_until"
                type="date"
                min={today}
                defaultValue={defaultUntil}
                className="input"
              />
            </div>
            <button type="submit" disabled={busy} className="btn-primary h-11 w-full sm:w-auto sm:px-6">
              소식 올리기
            </button>
            {actionData?.error ? (
              <p role="alert" className="alert-error">
                {actionData.error}
              </p>
            ) : actionData?.created ? (
              <p className="alert-success">소식을 올렸어요. 회원이 들어오면 팝업으로 떠요.</p>
            ) : null}
          </Form>
        </section>
      ) : null}

      <section className="space-y-3">
        {live.length === 0 ? (
          <p className="card text-sm font-medium text-slate-500">아직 올라온 소식이 없어요.</p>
        ) : (
          live.map((n) => <NoticeItem key={n.id} notice={n} staff={staff} busy={busy} />)
        )}
      </section>

      {staff && ended.length ? (
        <section className="space-y-3">
          <h2 className="section-title">게시가 끝난 소식 (운영진만 보여요)</h2>
          {ended.map((n) => (
            <div key={n.id} className="opacity-60">
              <NoticeItem notice={n} staff={staff} busy={busy} />
            </div>
          ))}
        </section>
      ) : null}
    </PageBody>
  );
}

function NoticeItem({
  notice,
  staff,
  busy,
}: {
  notice: Notice;
  staff: boolean;
  busy: boolean;
}) {
  return (
    <div>
      <NoticeCard notice={notice} />
      {staff ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-xs font-medium text-slate-500">
          <span>
            {notice.author_name ? `${notice.author_name} · ` : ""}
            {notice.show_until ? `${notice.show_until}까지` : "지울 때까지"}
          </span>
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm("이 소식을 지울까요?")) e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={notice.id} />
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1 font-bold hover:text-red-600">
              <Trash2 size={13} /> 지우기
            </button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}
