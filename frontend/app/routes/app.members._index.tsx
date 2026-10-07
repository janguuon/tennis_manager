import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowUpRight } from "lucide-react";

import { PageBody, PageHeader } from "~/components/Page";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "회원 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const members = await api<User[]>("/users", { token });
  return json({ members });
}

/** 아바타 색: 회원마다 하우스 색을 돌려가며 */
const AVATAR = ["bg-house-blue", "bg-house-yellow", "bg-house-orange", "bg-house-green", "bg-house-lav"];

export default function MembersPage() {
  const { members } = useLoaderData<typeof loader>();

  return (
    <PageBody>
      <PageHeader title="회원" sub={`오테식 식구 ${members.length}명`} />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m, i) => (
          <Link key={m.id} to={`/app/members/${m.id}`} className="card-link group flex items-center gap-3.5 !p-4">
            <span className={`avatar h-12 w-12 text-[18px] text-ink ${AVATAR[i % AVATAR.length]}`}>{m.name.charAt(0)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[15.5px] font-extrabold text-ink dark:text-white">{m.name}</span>
                {m.nickname ? <span className="truncate text-xs font-semibold text-slate-400">{m.nickname}</span> : null}
                {m.is_admin ? <span className="badge-ink">관리자</span> : null}
              </span>
              <span className="text-[13px] font-medium text-slate-500">
                {m.gender === "male" ? "남" : m.gender === "female" ? "여" : "성별 미입력"}
                {m.ntrp ? ` · NTRP ${m.ntrp}` : ""}
              </span>
            </span>
            <ArrowUpRight size={16} className="shrink-0 text-slate-400 transition-colors group-hover:text-ink dark:group-hover:text-white" />
          </Link>
        ))}
      </div>
    </PageBody>
  );
}
