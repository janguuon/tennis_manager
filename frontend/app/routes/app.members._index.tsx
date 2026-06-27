import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "회원 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const members = await api<User[]>("/users", { token });
  return json({ members });
}

export default function MembersPage() {
  const { members } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold sm:text-xl">👥 회원 ({members.length}명)</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        {members.map((m) => (
          <Link
            key={m.id}
            to={`/app/members/${m.id}`}
            className="card flex items-center gap-3 transition hover:border-court-300 hover:shadow"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-court-400 to-emerald-600 text-lg font-bold text-white shadow-sm shadow-court-500/30">
              {m.name.charAt(0)}
            </div>
            <div>
              <div className="font-medium">
                {m.name}
                {m.nickname ? <span className="ml-1 text-xs text-slate-400">@{m.nickname}</span> : null}
              </div>
              <div className="text-xs text-slate-500">
                {m.gender === "male" ? "남" : m.gender === "female" ? "여" : "-"}
                {m.ntrp ? ` · NTRP ${m.ntrp}` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
