import { useFetcher } from "@remix-run/react";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { MemberAvatar } from "~/components/Club";

type AvatarResult = { ok: boolean; error: string | null; avatar_url: string | null };

const MAX_BYTES = 8_000_000;

/**
 * 고른 사진을 가운데 정사각형으로 잘라 줄인 JPEG.
 * 휴대폰 사진(수 MB)을 그대로 올리면 서버 앞단의 업로드 크기 제한에 걸리므로 브라우저에서 먼저 줄인다.
 * (createImageBitmap 은 사진의 회전 정보를 반영해 그린다)
 */
async function shrinkToSquare(file: File, size = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(size, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    out,
    out
  );
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))),
      "image/jpeg",
      0.9
    )
  );
}

/** 마이페이지 프로필 사진: 동그라미를 눌러 사진 고르기, 지우기 */
export function AvatarEditor({
  user,
  className = "",
}: {
  user: { id: number; name: string; avatar_url: string | null };
  className?: string;
}) {
  const fetcher = useFetcher<AvatarResult>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";

  // 올리기·지우기가 끝나면(화면이 서버 사진으로 갱신된 뒤) 미리보기를 걷는다
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
    } else if (wasBusy.current) {
      wasBusy.current = false;
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
    }
  }, [busy]);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 사진을 다시 골라도 동작하게
    if (!file) return;
    setLocalError(null);
    let blob: Blob = file;
    try {
      blob = await shrinkToSquare(file);
    } catch {
      // 브라우저가 못 여는 형식이면 원본을 보내 서버가 판단한다
      if (file.size > MAX_BYTES) {
        setLocalError("사진이 너무 커요. 8MB 이하로 올려 주세요.");
        return;
      }
    }
    setPreview(URL.createObjectURL(blob));
    const fd = new FormData();
    fd.append("file", blob, "avatar.jpg");
    fetcher.submit(fd, {
      method: "post",
      action: "/resources/avatar",
      encType: "multipart/form-data",
    });
  };

  const onRemove = () => {
    if (!confirm("프로필 사진을 지울까요?")) return;
    fetcher.submit({}, { method: "delete", action: "/resources/avatar" });
  };

  const error = localError ?? (fetcher.state === "idle" ? fetcher.data?.error : null);
  const size = "!h-16 !w-16 !text-[26px] sm:!h-20 sm:!w-20 sm:!text-[32px]";

  return (
    <div className={`flex shrink-0 flex-col items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="프로필 사진 바꾸기"
        className="relative rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-house-yellow disabled:opacity-70"
      >
        {preview ? (
          <span className={`avatar overflow-hidden bg-house-yellow ${size}`}>
            <img src={preview} alt="" className="h-full w-full object-cover" />
          </span>
        ) : (
          <MemberAvatar user={user} className={`!bg-house-yellow ${size}`} />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white ring-2 ring-white/80">
          <Camera size={14} />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
      <span className="flex items-center gap-2 text-[11px] font-bold">
        {busy ? (
          "저장 중…"
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="underline-offset-2 hover:underline"
            >
              {user.avatar_url ? "사진 바꾸기" : "사진 올리기"}
            </button>
            {user.avatar_url ? (
              <button
                type="button"
                onClick={onRemove}
                className="opacity-70 underline-offset-2 hover:underline"
              >
                지우기
              </button>
            ) : null}
          </>
        )}
      </span>
      {error ? (
        <p role="alert" className="max-w-[9rem] text-center text-[11px] font-bold text-[#9F2A17]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
