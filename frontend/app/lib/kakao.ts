// 카카오톡 공유. window를 쓰므로 클릭 핸들러 안에서만 호출한다(렌더 중 호출 금지).

const LIMIT = 200; // 카카오 텍스트 메시지 길이 제한
export const KAKAO_TEXT_LIMIT = LIMIT;

/**
 * 메시지 끝에 붙이는 바로 가기 링크 줄. 모든 카톡 공유 메시지에 붙여, 휴대폰·PC 카톡 어디서든
 * 글 속 주소를 눌러 그 화면으로 바로 간다 (말풍선 버튼은 기기마다 보이는 모양이 달라 주소도 같이 적는다).
 */
export const linkLine = (label: string, url: string) => `👉 ${label}: ${url}`;

/** 본문 끝에 붙는 부분: 빈 줄 + 링크 줄 */
export const linkSuffix = (label: string, url: string) => `\n\n${linkLine(label, url)}`;

/** room 글자를 넘으면 잘라 "…" */
const fit = (text: string, room: number) =>
  text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text;

/** 링크 줄이 잘리지 않게: 본문을 (200자 - 링크 줄) 안으로 줄이고 링크 줄을 붙인다 */
export function withLink(body: string, label: string, url: string): string {
  const suffix = linkSuffix(label, url);
  return fit(body, LIMIT - suffix.length) + suffix;
}

type KakaoSdk = {
  isInitialized: () => boolean;
  init: (key: string) => void;
  Share: { sendDefault: (o: object) => void };
};

/** 카카오 SDK를 준비한다. 설정이 없으면 안내하고 null. */
function kakaoSdk(): KakaoSdk | null {
  const w = window as unknown as {
    Kakao?: KakaoSdk;
    ENV?: { KAKAO_JS_KEY?: string };
  };
  const Kakao = w.Kakao;
  const key = w.ENV?.KAKAO_JS_KEY;
  if (!Kakao || !key) {
    alert("카카오 공유가 아직 설정되지 않았어요. (KAKAO_JS_KEY 필요)");
    return null;
  }
  if (!Kakao.isInitialized()) Kakao.init(key);
  return Kakao;
}

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
  const Kakao = kakaoSdk();
  if (!Kakao) return;

  const url = `${window.location.origin}${path}`;
  const suffix = linkSuffix("모임 보기", url);
  // 요약이 길어도 링크 줄은 남긴다 (요약을 줄이고, 남는 자리에 이름)
  const body = fit(base, LIMIT - suffix.length);
  const line = fitNames(namesLabel, names, LIMIT - body.length - suffix.length);
  Kakao.Share.sendDefault({
    objectType: "text",
    text: body + line + suffix,
    link: { mobileWebUrl: url, webUrl: url },
  });
}

/**
 * 이미 다듬은 문구(200자 안, 링크 줄 포함 — withLink)를 카카오톡 공유창으로 보낸다(사용자가 톡방을 고른다).
 * 메시지 아래 버튼(buttonTitle)을 누르면 path 로 이동한다.
 */
export function shareTextToKakao({
  text,
  path,
  buttonTitle,
}: {
  text: string;
  path: string;
  buttonTitle?: string;
}) {
  const Kakao = kakaoSdk();
  if (!Kakao) return;
  const url = `${window.location.origin}${path}`;
  Kakao.Share.sendDefault({
    objectType: "text",
    text: text.slice(0, LIMIT),
    link: { mobileWebUrl: url, webUrl: url },
    ...(buttonTitle ? { buttonTitle } : {}),
  });
}
