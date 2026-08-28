#!/usr/bin/env python3
"""Draw the app icons for both applications.

The two apps sit next to each other on a phone belonging to anybody who both works
here and lives in one of the societies, so they have to be told apart at a glance
and still read as the same product. Same mark, inverted palette: the resident app
is a light droplet on deep teal, the staff app a deep teal droplet on aqua.

The icons are generated rather than committed as artwork nobody can edit. Changing
the brand means changing four numbers here and re-running:

    python3 scripts/make_icons.py

Requires Pillow.

What each file is for:

  icon-*.png           1024x1024, opaque. iOS rejects an app icon with an alpha
                       channel, so the background is painted rather than left out.
  adaptive-icon-*.png  1024x1024 foreground for Android, transparent. Android
                       masks it to whatever shape the launcher uses, so the mark
                       stays inside the middle two thirds where nothing is cropped.
  splash-*.png         1024x1024, transparent. Drawn over the splash background
                       colour from app.config.ts with resizeMode "contain".
  favicon-*.png        48x48 for the web build.
"""

import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")

DEEP_TEAL = (0, 77, 77, 255)
AQUA = (0, 168, 168, 255)
ICE = (178, 240, 238, 255)
AMBER = (245, 166, 35, 255)

# Drawn at four times the size and shrunk, which is the cheapest way to get a clean
# curve out of a library with no anti-aliasing on its polygon fill.
SCALE = 4

PALETTES = {
    # The consumer app. Light mark on the dark brand colour: it has to look like a
    # laundry service on a home screen full of consumer apps.
    "resident": {"background": DEEP_TEAL, "droplet": ICE, "wave": AQUA},
    # The internal one. Inverted, so somebody carrying both can tell in the dark
    # which one they just opened, with the amber that means "attention" everywhere
    # else in the product.
    "staff": {"background": AQUA, "droplet": DEEP_TEAL, "wave": AMBER},
}


def droplet_polygon(cx, cy, r, height_ratio=2.25):
    """A teardrop: a circle with a point on top, joined where the point is tangent.

    Taking the apex straight to the top of the circle would leave a crease at the
    join. The tangent points are where the two lines from the apex actually touch
    the circle, which is what makes the outline one continuous curve.
    """
    h = r * height_ratio
    tangent_length = math.sqrt(h * h - r * r)
    tx = r * tangent_length / h
    ty = r * r / h
    return [(cx, cy - h), (cx - tx, cy - ty), (cx + tx, cy - ty)]


def wave_polygon(left, right, baseline, amplitude, bottom):
    """A band of water across the lower part of the droplet."""
    points = []
    steps = 96
    for i in range(steps + 1):
        x = left + (right - left) * i / steps
        phase = (i / steps) * math.pi * 2.4
        points.append((x, baseline + math.sin(phase) * amplitude))
    points.append((right, bottom))
    points.append((left, bottom))
    return points


def draw_mark(size, palette, background=None, inset=1.0):
    """The mark on its own, at `size` pixels square.

    `inset` shrinks it inside the canvas: Android crops an adaptive icon to the
    launcher's shape, so the foreground has to sit inside the middle two thirds.
    """
    canvas = size * SCALE
    image = Image.new("RGBA", (canvas, canvas), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    cx = canvas / 2
    r = canvas * 0.21 * inset
    # Sits below centre, because the point on top carries the shape upwards and a
    # mark centred on its circle reads as sitting too low.
    cy = canvas / 2 + r * 0.42

    draw.polygon(droplet_polygon(cx, cy, r), fill=palette["droplet"])
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=palette["droplet"])

    # The water inside it, clipped to the droplet so the band never escapes the
    # outline.
    band = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    ImageDraw.Draw(band).polygon(
        wave_polygon(cx - r * 1.2, cx + r * 1.2, cy + r * 0.30, r * 0.11, cy + r * 1.4),
        fill=palette["wave"],
    )
    mask = Image.new("L", (canvas, canvas), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(droplet_polygon(cx, cy, r), fill=255)
    mask_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    image.paste(band, (0, 0), Image.composite(mask, Image.new("L", (canvas, canvas), 0), band.split()[3]))

    return image.resize((size, size), Image.LANCZOS)


def write(image, name):
    path = os.path.join(ASSETS, name)
    image.save(path)
    print("wrote", os.path.relpath(path, os.path.dirname(HERE)))


def main():
    os.makedirs(ASSETS, exist_ok=True)
    for variant, palette in PALETTES.items():
        # Opaque: iOS refuses an app icon with an alpha channel.
        write(draw_mark(1024, palette, background=palette["background"]), f"icon-{variant}.png")
        # Transparent, and pulled in so a round or squircle launcher mask does not
        # clip the point off the droplet.
        write(draw_mark(1024, palette, inset=0.62), f"adaptive-icon-{variant}.png")
        write(draw_mark(1024, palette, inset=0.78), f"splash-{variant}.png")
        write(draw_mark(48, palette, background=palette["background"]), f"favicon-{variant}.png")


if __name__ == "__main__":
    main()
