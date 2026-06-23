import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "관리자 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  try {
    const pending = await api<User[]>("/admin/signups/pending", { token });
    return json({ pending });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw redirect("/app");
    throw err;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const userId = formData.get("user_id");

  try {
    await api(`/admin/signups/${userId}/${intent}`, { method: "POST", token });
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export default function AdminPage() {
  const { pending } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">🛠️ 가입 신청 관리</h1>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
      ) : null}

      {pending.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          대기 중인 가입 신청이 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((u) => (
            <div key={u.id} className="card flex items-center justify-between">
              <div>
                <div className="font-medium">
                  {u.name}
                  <span className="ml-2 text-xs text-slate-400">@{u.username}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {u.gender === "male" ? "남" : u.gender === "female" ? "여" : "-"}
                  {u.ntrp ? ` · NTRP ${u.ntrp}` : ""}
                  {u.email ? ` · ${u.email}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Form method="post">
                  <input type="hidden" name="user_id" value={u.id} />
                  <button name="intent" value="approve" className="btn-primary px-3 py-1.5 text-sm">
                    승인
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="user_id" value={u.id} />
                  <button name="intent" value="reject" className="btn-ghost px-3 py-1.5 text-sm text-red-500">
                    거절
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
