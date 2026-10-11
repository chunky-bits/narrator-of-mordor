"""Renders the extension icons and logos (requires Pillow and NumPy).

    python3 scripts/make-icons.py

Sources in assets/:
  logo.webp  wizard logo (transparent)  -> 128 px icon, options page header
  book.jpg   book logo on white         -> small icons (16, 32, 48 px), bar brand icon

At 16/32 px and in the bar the swirls above the book only shrink it, so those use the
book alone (its connected shape, without the free-floating swirls and sparkles).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
OUT = ROOT / 'public' / 'icons'


def remove_white_background(img: Image.Image) -> Image.Image:
    """Make the white background transparent, keeping enclosed light areas opaque."""
    rgb = img.convert('RGB')
    w, h = rgb.size
    # Flood-fill the background from the borders (JPEG noise -> tolerance); the black
    # outline keeps the cream pages from being reached.
    marked = rgb.copy()
    key = (255, 0, 255)
    for x in range(0, w, 50):
        for y in (0, h - 1):
            if marked.getpixel((x, y)) != key:
                ImageDraw.floodfill(marked, (x, y), key, thresh=40)
    for y in range(0, h, 50):
        for x in (0, w - 1):
            if marked.getpixel((x, y)) != key:
                ImageDraw.floodfill(marked, (x, y), key, thresh=40)
    bg = np.all(np.asarray(marked) == key, axis=-1)

    px = np.asarray(rgb).astype(np.float32)
    alpha = np.where(bg, 0.0, 1.0)
    # Anti-aliased edge pixels (next to the background) are blends with white: unmix
    # them (colour-to-alpha) so they don't leave a white fringe on dark backgrounds.
    near = np.zeros_like(bg)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            near |= np.roll(np.roll(bg, dy, axis=0), dx, axis=1)
    edge = near & ~bg
    a = np.clip((255 - px).max(axis=-1) / 255, 0, 1)
    alpha = np.where(edge, a, alpha)
    safe = np.maximum(alpha, 1e-3)[..., None]
    unmixed = np.clip((px - 255 * (1 - safe)) / safe, 0, 255)
    px = np.where(edge[..., None], unmixed, px)

    out = np.dstack([px, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def book_only(img: Image.Image) -> Image.Image:
    """Keep only the connected shape at the image centre (the book), dropping the
    free-floating swirls, notes and sparkles around it."""
    opaque = img.getchannel('A').point(lambda a: 255 if a > 32 else 0)
    ImageDraw.floodfill(opaque, (img.width // 2, int(img.height * 0.7)), 128)
    keep = opaque.point(lambda v: 255 if v == 128 else 0)
    out = img.copy()
    out.putalpha(Image.fromarray(np.minimum(np.asarray(img.getchannel('A')), np.asarray(keep))))
    return out


def square(img: Image.Image, margin: float = 0.0) -> Image.Image:
    """Trim transparent margins and centre on a square canvas."""
    img = img.crop(img.getchannel('A').getbbox())
    side = round(max(img.size) * (1 + 2 * margin))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas


wizard = square(Image.open(ASSETS / 'logo.webp').convert('RGBA'))
cutout = remove_white_background(Image.open(ASSETS / 'book.jpg'))
book = square(cutout, margin=0.02)
book_small = square(book_only(cutout), margin=0.02)

OUT.mkdir(parents=True, exist_ok=True)
for size, image in ((16, book_small), (32, book_small), (48, book), (128, wizard)):
    image.resize((size, size), Image.LANCZOS).save(OUT / f'icon-{size}.png', optimize=True)
wizard.resize((256, 256), Image.LANCZOS).save(OUT / 'logo-256.png', optimize=True)
# Bar brand icon (shown at 28 px; 2x for high-DPI screens).
book_small.resize((64, 64), Image.LANCZOS).save(OUT / 'book-64.png', optimize=True)
print('icons written to', OUT)
