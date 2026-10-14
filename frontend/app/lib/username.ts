/** 로그인 아이디 규칙: 영문·숫자(그리고 _ . -) 3자 이상. 서버 UserCreate 와 같다. */
const HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

/** 입력 중에 보여 줄 안내 (문제 없으면 null) */
export function usernameHint(value: string): string | null {
  if (!value) return null;
  if (HANGUL.test(value))
    return "아이디는 영문·숫자예요. 한/영 키를 눌러 영문으로 바꿔 주세요.";
  if (/\s/.test(value)) return "아이디에는 띄어쓰기를 쓸 수 없어요.";
  if (/[^A-Za-z0-9_.-]/.test(value))
    return "아이디는 영문·숫자로 적어 주세요. (기호는 _ . - 만 돼요)";
  return null;
}

export function hasHangul(value: string) {
  return HANGUL.test(value);
}
