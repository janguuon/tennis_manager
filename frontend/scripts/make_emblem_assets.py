"""팀 엠블럼 이미지 한 장으로 앱에 쓰는 파일을 만든다 (frontend/public).

엠블럼이 바뀌면(초안 → 최종) 새 그림으로 다시 실행하면 된다. Pillow 가 든 백엔드 가상환경으로:

    backend/venv/bin/python frontend/scripts/make_emblem_assets.py <엠블럼.png>

만드는 파일
- emblem.png           : 바탕을 순백으로 정리하고 여백을 다듬은 엠블럼 (로그인 화면, 2배 해상도)
- icon-192/512.png     : 흰 정사각 아이콘 (머리의 작은 배지, 안드로이드 홈 화면 — site.webmanifest)
- apple-touch-icon.png : 180px (아이폰 홈 화면)
- favicon-64.png       : 브라우저 탭
- og-image.png         : 링크 미리보기. 왼쪽 주황 타일 가운데를 다시 칠하고 흰 카드에 담은 엠블럼을 넣는다
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"


def clean(src: Path) -> Image.Image:
    """거의 흰 바탕을 순백으로 바꾸고, 그림 둘레 4%만 남기고 자른다."""
    im = Image.open(src).convert("RGB")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if min(r, g, b) >= 228 and max(r, g, b) - min(r, g, b) <= 24:
                px[x, y] = (255, 255, 255)
    diff = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))).convert("L")
    left, top, right, bottom = diff.point(lambda v: 255 if v > 40 else 0).getbbox()
    pad = int(max(right - left, bottom - top) * 0.04)
    return im.crop((max(0, left - pad), max(0, top - pad), min(w, right + pad), min(h, bottom + pad)))


def fit(emblem: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / emblem.width, height / emblem.height)
    return emblem.resize((round(emblem.width * scale), round(emblem.height * scale)), Image.LANCZOS)


def square(emblem: Image.Image, size: int, fill: float) -> Image.Image:
    """흰 정사각형 가운데에 엠블럼 (fill = 차지하는 비율)."""
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    e = fit(emblem, round(size * fill), round(size * fill))
    canvas.paste(e, ((size - e.width) // 2, (size - e.height) // 2))
    return canvas


def save_small(im: Image.Image, name: str) -> None:
    """색이 몇 가지뿐이라(흰·검정·라임) 팔레트로 줄여 용량을 줄인다."""
    im.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(PUBLIC / name, optimize=True)


def og_image(emblem: Image.Image) -> None:
    og = Image.open(PUBLIC / "og-image.png").convert("RGB")
    orange = og.getpixel((46, 300))  # 타일 왼쪽 가장자리: 지우고 다시 칠하는 곳 바깥이라 다시 실행해도 주황
    draw = ImageDraw.Draw(og)
    draw.rectangle((60, 128, 482, 572), fill=orange)  # '오테식 매니저' 알약과 타일 모서리는 남긴다
    card_w, card_h, cx, cy = 372, 360, (36 + 506) // 2, 355
    x0, y0 = cx - card_w // 2, cy - card_h // 2
    draw.rounded_rectangle((x0, y0, x0 + card_w, y0 + card_h), radius=30, fill=(255, 255, 255))
    e = fit(emblem, card_w - 44, card_h - 44)
    og.paste(e, (cx - e.width // 2, cy - e.height // 2))
    og.save(PUBLIC / "og-image.png", optimize=True)


def main() -> None:
    emblem = clean(Path(sys.argv[1]))
    shown = fit(emblem, min(720, emblem.width), 10_000)
    save_small(shown, "emblem.png")
    for name, size, fill in [
        ("icon-512.png", 512, 0.86),
        ("icon-192.png", 192, 0.88),
        ("apple-touch-icon.png", 180, 0.86),  # 아이폰이 모서리를 둥글게 깎는다
        ("favicon-64.png", 64, 0.98),
    ]:
        save_small(square(emblem, size, fill), name)
    og_image(shown)
    print("emblem.png", shown.size, "→", PUBLIC)


if __name__ == "__main__":
    main()
