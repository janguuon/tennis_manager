import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";

import { Modal } from "~/components/Modal";
import type { Gender } from "~/lib/types";

// "나중에 할게요"를 누르면 이 브라우저 탭에서는 다시 묻지 않고, 다음에 로그인하면 다시 묻는다
const LATER_KEY = "otesik:gender-later";

function laterChosen(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
}

/** 로그인 화면에서 부른다: 다시 로그인하면 성별을 다시 묻게 */
export function resetGenderPrompt() {
  try {
    sessionStorage.removeItem(LATER_KEY);
  } catch {
    // 저장소를 못 쓰면 매번 묻는다
  }
}

/**
 * 성별이 필수 항목이 되기 전에 가입해 성별이 비어 있는 회원에게 로그인 후 한 번 묻는다.
 * 고르면 바로 저장되고, 대진(혼복·남복·여복)에 쓰인다.
 */
export function GenderPrompt({
  user,
}: {
  user: { name: string; gender: Gender | null };
}) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const [open, setOpen] = useState(false);

  // 서버 렌더와 어긋나지 않게 화면이 뜬 뒤에 열지 정한다. 저장되면 회원 정보가 새로 와서 닫힌다.
  useEffect(() => {
    setOpen(!user.gender && !laterChosen());
  }, [user.gender]);

  if (!open) return null;

  const later = () => {
    try {
      sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      // 저장소를 못 쓰면 이번 화면에서만 닫는다
    }
    setOpen(false);
  };
  const busy = fetcher.state !== "idle";
  const error = fetcher.state === "idle" ? fetcher.data?.error : null;

  return (
    <Modal title="성별을 알려 주세요" onClose={later}>
      <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
        {user.name}님, 이제 성별이 회원 정보의 필수 항목이에요.
        <br />
        혼복·남복·여복 대진을 짤 때 쓰여요. 한 번만 골라 주세요.
      </p>
      <fetcher.Form
        method="post"
        action="/resources/gender"
        className="mt-5 grid grid-cols-2 gap-3"
      >
        <button
          type="submit"
          name="gender"
          value="male"
          className="btn-secondary h-14 text-base"
          disabled={busy}
        >
          남성
        </button>
        <button
          type="submit"
          name="gender"
          value="female"
          className="btn-secondary h-14 text-base"
          disabled={busy}
        >
          여성
        </button>
      </fetcher.Form>
      {error ? (
        <p role="alert" className="alert-error mt-3">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">
          {busy ? "저장 중…" : "마이페이지에서 언제든 바꿀 수 있어요."}
        </p>
        <button
          type="button"
          onClick={later}
          className="shrink-0 text-xs font-bold text-slate-500 underline-offset-2 hover:underline"
        >
          나중에 할게요
        </button>
      </div>
    </Modal>
  );
}
