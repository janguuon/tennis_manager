/** 볼 바구니 일러스트: 파란 바구니 + 테니스공 + 줄무늬 손잡이 라켓 (장식용) */
export function BallBasket({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 230" className={className} aria-hidden="true">
      <g transform="rotate(-24 128 96)">
        <rect x="119" y="112" width="18" height="96" rx="7" fill="#fff" />
        <rect x="119" y="128" width="18" height="9" fill="#E4513A" />
        <rect x="119" y="146" width="18" height="9" fill="#E4513A" />
        <rect x="119" y="164" width="18" height="9" fill="#E4513A" />
        <rect x="119" y="182" width="18" height="9" fill="#E4513A" />
        <ellipse cx="128" cy="58" rx="44" ry="56" fill="#121212" />
        <ellipse cx="128" cy="58" rx="35" ry="46" fill="#F3EAE2" />
        <g stroke="#121212" strokeWidth="2.2" opacity=".8">
          <line x1="104" y1="22" x2="104" y2="94" />
          <line x1="116" y1="14" x2="116" y2="102" />
          <line x1="128" y1="12" x2="128" y2="104" />
          <line x1="140" y1="14" x2="140" y2="102" />
          <line x1="152" y1="22" x2="152" y2="94" />
          <line x1="96" y1="34" x2="160" y2="34" />
          <line x1="94" y1="48" x2="162" y2="48" />
          <line x1="93" y1="62" x2="163" y2="62" />
          <line x1="94" y1="76" x2="162" y2="76" />
          <line x1="97" y1="90" x2="159" y2="90" />
        </g>
      </g>
      <circle cx="58" cy="140" r="26" fill="#DCEB45" />
      <path d="M38 124c10 8 10 26-2 34M76 122c-8 10-6 26 6 32" fill="none" stroke="#fff" strokeWidth="3.5" />
      <circle cx="104" cy="146" r="24" fill="#DCEB45" />
      <path d="M86 134c9 8 9 22 0 28M122 132c-8 8-8 22 0 28" fill="none" stroke="#fff" strokeWidth="3.5" />
      <path d="M22 156 H178 L164 226 H36 Z" fill="#3F6CE1" />
      <g stroke="#2C50B4" strokeWidth="3">
        <line x1="26" y1="176" x2="174" y2="176" />
        <line x1="30" y1="198" x2="170" y2="198" />
        <line x1="66" y1="156" x2="72" y2="226" />
        <line x1="100" y1="156" x2="100" y2="226" />
        <line x1="134" y1="156" x2="128" y2="226" />
      </g>
    </svg>
  );
}
