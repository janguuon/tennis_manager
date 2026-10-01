import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ChevronRight } from "lucide-react";

import { HeroHeader, PageBody, PageHero } from "~/components/Page";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "회원 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const members = await api<User[]>("/users", { token });
  return json({ members });
}

export default function MembersPage() {
  const { members } = useLoaderData<typeof loader>();

  return (
    <>
      <PageHero>
        <HeroHeader title="회원" sub={`${members.length}명`} />
      </PageHero>

      <PageBody>
        <div className="card overflow-hidden !p-0">
          {/* -mb-px: 마지막 줄의 아래 선을 카드 테두리 뒤로 숨김 */}
          <div className="-mb-px divide-y divide-slate-100 dark:divide-slate-800 sm:grid sm:grid-cols-2 sm:divide-y-0">
            {members.map((m) => (
              <Link
                key={m.id}
                to={`/app/members/${m.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:border-b sm:border-slate-100 sm:dark:border-slate-800 sm:[&:nth-child(odd)]:border-r"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  {m.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-slate-900 dark:text-white">{m.name}</span>
                    {m.nickname ? <span className="truncate text-xs text-slate-400">{m.nickname}</span> : null}
                    {m.is_admin ? <span className="badge-gray">관리자</span> : null}
                  </span>
                  <span className="text-[13px] text-slate-500">
                    {m.gender === "male" ? "남" : m.gender === "female" ? "여" : "성별 미입력"}
                    {m.ntrp ? ` · NTRP ${m.ntrp}` : ""}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-300 dark:text-slate-600" />
              </Link>
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
