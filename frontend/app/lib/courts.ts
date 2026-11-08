// 코트 번호 칸 해석 (서버 app/schedule_import.py court_labels 와 같은 규칙)

const RANGE = /^(\d{1,3})\s*[~\-–]\s*(\d{1,3})$/;

/** "3, 5"·"3/5"·"3·5" → ["3", "5"], "1~4"·"1-4" → ["1", "2", "3", "4"] (범위는 30면까지 펼친다) */
export function courtLabels(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const piece of String(raw ?? "").split(/[,/·]/)) {
    const part = piece.trim();
    if (!part) continue;
    const m = RANGE.exec(part);
    const [a, b] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
    if (m && a < b && b - a < 30) {
      for (let n = a; n <= b; n++) out.push(String(n));
    } else {
      out.push(part);
    }
  }
  return out;
}
