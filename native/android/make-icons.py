"""
Draws the Android launcher icons and the splash logo from the web app's icons
(apps/web/public/icons), so the app and the site carry the same mark.

    python3 native/android/make-icons.py      # needs Pillow (pip install pillow)
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent / "apps" / "web" / "public" / "icons"
RES = HERE / "app" / "res"

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

rounded = Image.open(WEB / "icon-512.png").convert("RGBA")  # rounded square, transparent corners
square = Image.open(WEB / "maskable-512.png").convert("RGBA")  # full bleed, mark in the safe zone

for name, scale in DENSITIES.items():
    folder = RES / f"mipmap-{name}"
    folder.mkdir(parents=True, exist_ok=True)
    # Phones before Android 8: the rounded square as it is, 48 dp.
    rounded.resize((round(48 * scale),) * 2, Image.LANCZOS).save(folder / "ic_launcher.png", optimize=True)
    # Android 8+: a 108 dp layer the launcher masks to its own shape (circle, squircle...).
    square.resize((round(108 * scale),) * 2, Image.LANCZOS).save(folder / "ic_launcher_foreground.png", optimize=True)

# Splash logo for phones before Android 12: 96 dp, drawn at xxhdpi.
splash = RES / "drawable-xxhdpi"
splash.mkdir(parents=True, exist_ok=True)
rounded.resize((288, 288), Image.LANCZOS).save(splash / "splash_logo.png", optimize=True)
print("icons written to", RES)
