#!/usr/bin/env python3
"""
Pure-standard-library PNG icon generator for the SmartSurveyor PWA.

No third-party dependencies (no PIL/Pillow) so it runs anywhere Python 3 is
available. It rasterises a simple "geodetic survey marker" glyph onto an amber
field/industrial background and writes the PNG sizes a PWA needs:

    icon-192.png         maskable + any
    icon-512.png         maskable + any
    apple-touch-icon.png 180x180, opaque, no transparency (iOS requirement)

Re-run with:  python3 generate_icons.py
"""

import struct
import zlib
import math
import os

# ---- Field / industrial palette ------------------------------------------
AMBER_TOP = (0xF2, 0xA8, 0x3D)   # warm amber
AMBER_BOT = (0xE0, 0x82, 0x1E)   # deeper amber (vertical gradient)
SLATE = (0x1E, 0x2A, 0x33)       # dark slate (glyph)
SLATE_SOFT = (0x2C, 0x3A, 0x45)  # softer slate
CREAM = (0xF7, 0xF3, 0xEA)       # light marker dot

HERE = os.path.dirname(os.path.abspath(__file__))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


class Canvas:
    def __init__(self, size, bg=(0, 0, 0, 0)):
        self.size = size
        # RGBA flat buffer
        self.px = bytearray(bg * size * size)

    def _idx(self, x, y):
        return (y * self.size + x) * 4

    def set(self, x, y, rgb, a=255):
        if x < 0 or y < 0 or x >= self.size or y >= self.size:
            return
        i = self._idx(x, y)
        sa = a / 255.0
        for c in range(3):
            self.px[i + c] = round(rgb[c] * sa + self.px[i + c] * (1 - sa))
        self.px[i + 3] = max(self.px[i + 3], a)

    def fill(self, fn):
        """fn(x, y) -> (rgb, alpha) or None"""
        for y in range(self.size):
            for x in range(self.size):
                res = fn(x, y)
                if res is not None:
                    rgb, a = res
                    self.set(x, y, rgb, a)

    def write_png(self, path, opaque_bg=None):
        size = self.size
        raw = bytearray()
        for y in range(size):
            raw.append(0)  # filter type 0
            for x in range(size):
                i = self._idx(x, y)
                r, g, b, a = self.px[i:i + 4]
                if opaque_bg is not None and a < 255:
                    t = a / 255.0
                    r = round(r * t + opaque_bg[0] * (1 - t))
                    g = round(g * t + opaque_bg[1] * (1 - t))
                    b = round(b * t + opaque_bg[2] * (1 - t))
                    a = 255
                raw += bytes((r, g, b, a))

        def chunk(tag, data):
            c = struct.pack(">I", len(data)) + tag + data
            return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        sig = b"\x89PNG\r\n\x1a\n"
        ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
        idat = zlib.compress(bytes(raw), 9)
        png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
        with open(path, "wb") as f:
            f.write(png)
        print("wrote", os.path.relpath(path, HERE), f"({size}x{size})")


def rounded_rect_alpha(x, y, size, radius, pad):
    """Anti-aliased coverage (0..1) for a rounded square inset by `pad`."""
    lo, hi = pad, size - 1 - pad
    # distance outside the rounded rect
    dx = max(lo - x, 0, x - hi)
    dy = max(lo - y, 0, y - hi)
    # corner regions use circular radius
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    dist = math.hypot(x - cx, y - cy) - radius
    if dx == 0 and dy == 0:
        return 1.0
    edge = max(dist, 0)
    return max(0.0, min(1.0, 1.0 - edge))


def aa_disc(x, y, cx, cy, r):
    d = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, r - d + 0.5))


def aa_ring(x, y, cx, cy, r, w):
    d = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, (w / 2) - abs(d - r) + 0.5))


def aa_hline(x, y, x0, x1, yc, w):
    if x < x0 or x > x1:
        return 0.0
    return max(0.0, min(1.0, (w / 2) - abs(y - yc) + 0.5))


def aa_vline(x, y, y0, y1, xc, w):
    if y < y0 or y > y1:
        return 0.0
    return max(0.0, min(1.0, (w / 2) - abs(x - xc) + 0.5))


def build(size, maskable=False):
    c = Canvas(size)
    s = size
    pad = round(s * (0.16 if maskable else 0.0))  # safe zone for maskable
    radius = round(s * (0.0 if maskable else 0.22))
    if maskable:
        # full-bleed background, glyph kept inside safe zone
        bg_pad, bg_radius = 0, 0
    else:
        bg_pad, bg_radius = pad, radius

    cx = cy = (s - 1) / 2
    inner = s - 2 * pad
    line_w = max(2.0, inner * 0.055)
    ring_r = inner * 0.30
    cross_r = inner * 0.42

    for y in range(s):
        for x in range(s):
            # --- background: vertical amber gradient, rounded ---
            cov = rounded_rect_alpha(x, y, s, bg_radius, bg_pad)
            if cov > 0:
                t = y / (s - 1)
                bg = lerp(AMBER_TOP, AMBER_BOT, t)
                c.set(x, y, bg, round(255 * cov))

            # --- subtle contour lines (topographic) ---
            for k, rr in enumerate((cross_r * 1.42, cross_r * 1.7)):
                rng = aa_ring(x, y, cx, cy, rr, line_w * 0.5)
                if rng > 0:
                    c.set(x, y, AMBER_TOP, round(70 * rng))

            # --- crosshair arms ---
            arm = max(
                aa_hline(x, y, cx - cross_r, cx + cross_r, cy, line_w),
                aa_vline(x, y, cy - cross_r, cy + cross_r, cx, line_w),
            )
            if arm > 0:
                c.set(x, y, SLATE, round(255 * arm))

            # --- outer ring ---
            rng = aa_ring(x, y, cx, cy, ring_r, line_w)
            if rng > 0:
                c.set(x, y, SLATE, round(255 * rng))

            # --- center marker dot ---
            dot = aa_disc(x, y, cx, cy, line_w * 1.5)
            if dot > 0:
                c.set(x, y, CREAM, round(255 * dot))
    return c


if __name__ == "__main__":
    build(192, maskable=True).write_png(os.path.join(HERE, "icon-192.png"))
    build(512, maskable=True).write_png(os.path.join(HERE, "icon-512.png"))
    # Apple touch icon must be opaque (no alpha) and square; bake amber bg.
    build(180, maskable=False).write_png(
        os.path.join(HERE, "apple-touch-icon.png"), opaque_bg=AMBER_TOP
    )
    print("done.")
