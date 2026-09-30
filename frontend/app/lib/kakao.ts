// 카카오톡 공유. window를 쓰므로 클릭 핸들러 안에서만 호출한다(렌더 중 호출 금지).

const LIMIT = 200; // 카카오 텍스트 메시지 길이 제한

/**
 * "라벨 N명: 이름, 이름" 한 줄. budget(남은 글자 수)을 넘으면
 * 이름을 앞에서부터 채우고 나머지는 "외 N명"으로 줄인다.
 */
function fitNames(label: string, names: string[], budget: number): string {
  if (!names.length) return "";
  const header = `\n${label} ${names.length}명: `;
  const full = header + names.join(", ");
  if (full.length <= budget) return full;

  const room = budget - header.length - 6; // " 외 N명" 자리
  const shown: string[] = [];
  let used = 0;
  for (const n of names) {
    if (used + n.length + 2 > room) break;
    shown.push(n);
    used += n.length + 2;
  }
  const rest = names.length - shown.length;
  return shown.length
    ? header + shown.join(", ") + (rest > 0 ? ` 외 ${rest}명` : "")
    : `\n${label} ${names.length}명`;
}

/**
 * 모임 관련 메시지를 카카오톡 공유창으로 보낸다(사용자가 톡방을 고른다).
 * 메시지 끝에 모임 링크가 붙고, 메시지를 누르면 그 모임 상세로 이동한다.
 */
export function shareToKakao({
  base,
  names = [],
  namesLabel = "👥 참석",
  path,
}: {
  base: string;
  names?: string[];
  namesLabel?: string;
  path: string;
}) {
  const w = window as unknown as {
    Kakao?: {
      isInitialized: () => boolean;
      init: (key: string) => void;
      Share: { sendDefault: (o: object) => void };
    };
    ENV?: { KAKAO_JS_KEY?: string };
  };
  const Kakao = w.Kakao;
  const key = w.ENV?.KAKAO_JS_KEY;
  if (!Kakao || !key) {
    alert("카카오 공유가 아직 설정되지 않았어요. (KAKAO_JS_KEY 필요)");
    return;
  }
  if (!Kakao.isInitialized()) Kakao.init(key);

  const url = `${window.location.origin}${path}`;
  const suffix = `\n\n👉 모임 보기: ${url}`;
  const line = fitNames(namesLabel, names, LIMIT - base.length - suffix.length);
  Kakao.Share.sendDefault({
    objectType: "text",
    text: base + line + suffix,
    link: { mobileWebUrl: url, webUrl: url },
  });
}
