import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowUpRight, Users } from "lucide-react";

import { MemberAvatar, memberColor } from "~/components/Club";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";

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
    <PageBody>
      <PageHeader
        eyebrow="OUR PEOPLE, OUR CLUB."
        title="반가운, 테니스 식구들"
        sub="코트 위에서 만나 더 가까워지는 사이."
        actions={
          <span className="badge-gray !h-9 px-4">
            함께하는 식구 {members.length}명
          </span>
        }
      />
      {members.length ? (
        <div className="member-grid">
          {members.map((m) => (
            <Link
              key={m.id}
              to={`/app/members/${m.id}`}
              className="member-card"
            >
              <div className={`member-banner ${memberColor(m.id)}`}>
                <MemberAvatar
                  user={m}
                  className="absolute bottom-4 z-10 !h-12 !w-12 border-2 border-white/50 !bg-white/35 !text-lg"
                />
                {m.is_admin && (
                  <span className="chip-ink absolute right-3 top-3 z-10 !text-[10px]">
                    관리자
                  </span>
                )}
              </div>
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="min-w-0 truncate text-base font-bold">
                    {m.name}
                  </h2>
                  <ArrowUpRight size={16} className="shrink-0 text-slate-400" />
                </div>
                <p className="mt-2 min-h-5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {m.nickname || "오테식 테니스 식구"}
                </p>
                <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400">
                    {m.gender === "male"
                      ? "남성"
                      : m.gender === "female"
                      ? "여성"
                      : "성별 미입력"}
                  </span>
                  <strong className="font-semibold">
                    {m.ntrp ? `NTRP ${m.ntrp}` : "NTRP 미입력"}
                  </strong>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyCard icon={<Users size={28} />}>
          아직 등록된 회원이 없어요.
        </EmptyCard>
      )}
    </PageBody>
  );
}
