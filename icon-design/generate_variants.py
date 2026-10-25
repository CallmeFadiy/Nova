from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "nova-app-icon.png"
OUT = ROOT / "variants"
OUT.mkdir(exist_ok=True)

BASE = Image.open(SOURCE).convert("RGBA")
W, H = BASE.size

# Remove the connected near-white background, but keep the cream fill inside
# the line art (it is enclosed by the dark outline).
fill = Image.new("RGBA", BASE.size, (255, 0, 255, 255))
work = BASE.copy()
ImageDraw.floodfill(work, (0, 0), (255, 0, 255, 255), thresh=38)
ImageDraw.floodfill(work, (W - 1, 0), (255, 0, 255, 255), thresh=38)
ImageDraw.floodfill(work, (0, H - 1), (255, 0, 255, 255), thresh=38)
ImageDraw.floodfill(work, (W - 1, H - 1), (255, 0, 255, 255), thresh=38)

alpha = Image.new("L", BASE.size, 255)
pixels = work.load()
alpha_pixels = alpha.load()
for y in range(H):
    for x in range(W):
        r, g, b, _ = pixels[x, y]
        if r > 245 and g < 20 and b > 245:
            alpha_pixels[x, y] = 0
alpha = alpha.filter(ImageFilter.MinFilter(3))
alpha = alpha.filter(ImageFilter.GaussianBlur(0.35))

art = BASE.copy()
art.putalpha(alpha)
bbox = alpha.getbbox()
assert bbox
pad = 38
bbox = (
    max(0, bbox[0] - pad),
    max(0, bbox[1] - pad),
    min(W, bbox[2] + pad),
    min(H, bbox[3] + pad),
)
art = art.crop(bbox)

for name, tile_size in [("transparent", 1024)]:
    tile = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
    fitted = art.copy()
    fitted.thumbnail((900, 900), Image.LANCZOS)
    tile.alpha_composite(
        fitted,
        ((tile_size - fitted.width) // 2, (tile_size - fitted.height) // 2),
    )
    tile.save(OUT / f"01-{name}.png")


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def radial_glow(size, color, centre, radius):
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    cx, cy = centre
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=color,
    )
    return glow.filter(ImageFilter.GaussianBlur(radius * 0.65))


def dark_tile(size=1024):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = Image.new("RGBA", (size, size), (13, 12, 11, 255))
    px = bg.load()
    for y in range(size):
        t = y / (size - 1)
        shade = int(12 + 12 * (1 - t))
        for x in range(size):
            px[x, y] = (shade + 2, shade + 1, shade, 255)
    glow = radial_glow(size, (230, 177, 94, 36), (512, 470), 330)
    bg.alpha_composite(glow)
    mask = rounded_mask(size, 218)
    tile.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle(
        (8, 8, size - 9, size - 9),
        radius=214,
        outline=(62, 51, 35, 255),
        width=5,
    )
    draw.rounded_rectangle(
        (20, 20, size - 21, size - 21),
        radius=204,
        outline=(35, 31, 25, 180),
        width=1,
    )
    return tile


def ivory_tile(size=1024):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = Image.new("RGBA", (size, size), (247, 242, 232, 255))
    px = bg.load()
    for y in range(size):
        t = y / (size - 1)
        shade = int(246 - 9 * t)
        for x in range(size):
            px[x, y] = (shade, shade - 4, shade - 12, 255)
    mask = rounded_mask(size, 218)
    tile.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle(
        (8, 8, size - 9, size - 9),
        radius=214,
        outline=(208, 190, 156, 255),
        width=5,
    )
    return tile


def fit_art(canvas, art_image, target):
    fitted = art_image.copy()
    fitted.thumbnail((target, target), Image.LANCZOS)
    canvas.alpha_composite(
        fitted,
        ((canvas.width - fitted.width) // 2, (canvas.height - fitted.height) // 2),
    )
    return canvas


dark = dark_tile()
fit_art(dark, art, 820)
dark.save(OUT / "02-dark-tile.png")

# Gold line-art version: extract the dark ink and tint it warm amber.
gray = art.convert("L")
line_alpha = gray.point(lambda p: max(0, min(255, (168 - p) * 4)))
line_alpha = Image.composite(line_alpha, Image.new("L", art.size, 0), art.getchannel("A"))
gold = Image.new("RGBA", art.size, (230, 177, 94, 255))
gold.putalpha(line_alpha)
amber = dark_tile()
fit_art(amber, gold, 840)
amber.save(OUT / "03-amber-line.png")

ivory = ivory_tile()
fit_art(ivory, art, 820)
ivory.save(OUT / "04-ivory-tile.png")

# A contact sheet for quick comparison.
sheet = Image.new("RGBA", (1480, 1040), (10, 10, 12, 255))
draw = ImageDraw.Draw(sheet)
font_path = Path("C:/Windows/Fonts/segoeui.ttf")
from PIL import ImageFont

title_font = ImageFont.truetype(str(font_path), 28)
label_font = ImageFont.truetype(str(font_path), 18)
draw.text((40, 28), "Nova — варианты иконки", font=title_font, fill=(238, 232, 220, 255))
items = [
    ("01-transparent.png", "01 · Прозрачный фон"),
    ("02-dark-tile.png", "02 · Тёмная плитка"),
    ("03-amber-line.png", "03 · Золотой контур"),
    ("04-ivory-tile.png", "04 · Светлая плитка"),
]
for index, (filename, label) in enumerate(items):
    row, col = divmod(index, 2)
    x = 40 + col * 720
    y = 90 + row * 460
    preview = Image.open(OUT / filename).convert("RGBA")
    preview.thumbnail((400, 400), Image.LANCZOS)
    preview_bg = Image.new("RGBA", (420, 420), (24, 24, 28, 255))
    preview_bg.alpha_composite(preview, ((420 - preview.width) // 2, (420 - preview.height) // 2))
    sheet.alpha_composite(preview_bg, (x, y))
    draw.text((x, y + 430), label, font=label_font, fill=(218, 210, 198, 255))
sheet.convert("RGB").save(OUT / "00-contact-sheet.png", quality=95)
print("Wrote", OUT)
