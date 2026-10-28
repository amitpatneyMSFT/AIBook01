"""Render a 2D motion-graphics explainer from layered artwork, kinetic text and narration.

Usage:
    python scripts/motion/render.py config.json

Invoked by src/lib/motionbuild.ts. The config is compiled by
src/lib/motiontimeline.ts, which decides every time and position; this script
only plays it back:

- a background plate per scene with a slow push-in (or a solid color card)
- actor cutouts that slide, pop, rise or fade in, then float or bob
- a headline revealed word by word on a rounded panel, a subline, pop-in chips
  and a stat card whose number counts up
- wipe, slide or fade transitions between scenes and a fade out at the end
- narration placed on the timeline, an optional music bed ducked under it,
  and loudness normalized to -16 LUFS

Actor pictures with no transparency have their background keyed out from the
border inward, so an image model that ignores the transparency request still
produces a clean cutout.

Requires: numpy, Pillow, imageio-ffmpeg  (python -m pip install numpy pillow imageio-ffmpeg)
"""
import json, math, os, re, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import imageio_ffmpeg

from audio import mux
from cutout import load_cutout

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
W, H, FPS = cfg["width"], cfg["height"], cfg.get("fps", 24)
PAL = cfg["palette"]
OUT = cfg["output"]
TOTAL = float(cfg["duration"])
ff = imageio_ffmpeg.get_ffmpeg_exe()
S = W / 1280

_BOLD = [
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/opt/venv/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
_REGULAR = [
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/opt/venv/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
FONT_BOLD = cfg.get("fontBold") or next((p for p in _BOLD if os.path.exists(p)), None)
FONT_REGULAR = cfg.get("font") or next((p for p in _REGULAR if os.path.exists(p)), FONT_BOLD)
_font_cache = {}


def font(size, bold=True):
    key = (int(size), bold)
    if key not in _font_cache:
        path = FONT_BOLD if bold else FONT_REGULAR
        _font_cache[key] = _load_font(path, int(size))
    return _font_cache[key]


def _load_font(path, size):
    # Hosts without system fonts (e.g. slim containers) get Pillow's built-in font.
    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def rgb(hex_color, alpha=255):
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


# ---------------------------------------------------------------- easing ----

def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


EASE = {
    "linear": lambda u: u,
    "outCubic": lambda u: 1 - (1 - u) ** 3,
    "outBack": lambda u: 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2,
    "inOutSine": lambda u: -(math.cos(math.pi * u) - 1) / 2,
}


def sample(keyframes, t):
    """Interpolated (dx, dy, scale, opacity) at scene time t."""
    first = keyframes[0]
    if t <= first["t"]:
        return first["dx"], first["dy"], first["scale"], first["opacity"]
    for a, b in zip(keyframes, keyframes[1:]):
        if t <= b["t"]:
            span = b["t"] - a["t"]
            u = EASE.get(b.get("ease", "linear"), EASE["linear"])(clamp01((t - a["t"]) / span) if span > 0 else 1)
            return tuple(a[k] + (b[k] - a[k]) * u for k in ("dx", "dy", "scale", "opacity"))
    last = keyframes[-1]
    return last["dx"], last["dy"], last["scale"], last["opacity"]


# ---------------------------------------------------------------- assets ----

def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((max(w, int(im.width * s + 0.5)), max(h, int(im.height * s + 0.5))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


class Background:
    def __init__(self, spec):
        self.color = rgb(spec["color"])
        self.z0, self.z1 = spec.get("zoomFrom", 1), spec.get("zoomTo", 1)
        self.zmax = max(self.z0, self.z1)
        self.plate = None
        if spec.get("src"):
            try:
                self.plate = cover(Image.open(spec["src"]).convert("RGB"), int(W * self.zmax), int(H * self.zmax))
            except Exception as e:  # a broken plate falls back to the scene color
                print("background failed:", e, file=sys.stderr)

    def frame(self, u):
        if self.plate is None:
            return Image.new("RGBA", (W, H), self.color)
        z = self.z0 + (self.z1 - self.z0) * EASE["inOutSine"](u)
        cw = min(self.plate.width, W * self.zmax / z)
        ch = min(self.plate.height, H * self.zmax / z)
        x, y = (self.plate.width - cw) / 2, (self.plate.height - ch) / 2
        return self.plate.resize((W, H), Image.BILINEAR, box=(x, y, x + cw, y + ch)).convert("RGBA")


# ---------------------------------------------------------------- layers ----

def with_opacity(im, opacity):
    if opacity >= 0.999:
        return im
    out = im.copy()
    out.putalpha(im.getchannel("A").point(lambda v: int(v * opacity)))
    return out


def paste(frame, im, x, y, opacity=1.0):
    if opacity <= 0.003 or im.width < 1 or im.height < 1:
        return
    x, y = int(round(x)), int(round(y))
    # alpha_composite rejects negative offsets, so crop whatever hangs off the frame.
    cx, cy = max(0, -x), max(0, -y)
    if cx >= im.width or cy >= im.height or x >= W or y >= H:
        return
    if cx or cy:
        im = im.crop((cx, cy, im.width, im.height))
    frame.alpha_composite(with_opacity(im, opacity), (x + cx, y + cy))


def rounded(w, h, radius, fill):
    im = Image.new("RGBA", (max(1, int(w)), max(1, int(h))), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=int(radius), fill=fill)
    return im


def text_image(text, f, color):
    left, top, right, bottom = f.getbbox(text)
    im = Image.new("RGBA", (max(1, right - left + 4), max(1, bottom - top + 4)), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((2 - left, 2 - top), text, font=f, fill=color)
    return im


class Actor:
    def __init__(self, spec):
        im = load_cutout(spec["src"])
        if spec.get("flip"):
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        s = min(spec["maxW"] / im.width, spec["maxH"] / im.height)
        self.im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        self.spec = spec
        self.settle = spec["keyframes"][-1]["t"]
        self._scaled = {}
        shadow = Image.new("RGBA", (max(1, int(self.im.width * 0.7)), max(1, int(18 * S))), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).ellipse((0, 0, shadow.width - 1, shadow.height - 1), fill=(0, 0, 0, 60))
        self.shadow = shadow.filter(ImageFilter.GaussianBlur(4))
        self.backdrop = None
        if spec.get("backdrop"):
            d = int(max(self.im.width, self.im.height) * 1.12)
            disc = Image.new("RGBA", (d, d), (0, 0, 0, 0))
            ImageDraw.Draw(disc).ellipse((0, 0, d - 1, d - 1), fill=rgb(spec["backdrop"], 235))
            self.backdrop = disc

    def scaled(self, scale):
        q = round(max(scale, 0.01), 2)
        if q == 1:
            return self.im
        if q not in self._scaled:
            self._scaled[q] = self.im.resize(
                (max(1, int(self.im.width * q)), max(1, int(self.im.height * q))), Image.BILINEAR)
        return self._scaled[q]

    def draw(self, frame, t):
        sp = self.spec
        dx, dy, scale, opacity = sample(sp["keyframes"], t)
        if opacity <= 0.003 or scale <= 0.01:
            return
        idle = sp.get("idle")
        if idle:
            ramp = clamp01((t - self.settle) / 0.4)
            wave = math.sin(2 * math.pi * t / idle["period"] + idle["phase"])
            if idle["kind"] == "bob":
                dy -= abs(wave) * idle["amp"] * 1.6 * ramp
            else:
                dy += wave * idle["amp"] * ramp
        im = self.scaled(scale)
        if self.backdrop is not None:
            q = max(0.01, scale)
            disc = self.backdrop if q == 1 else self.backdrop.resize(
                (max(1, int(self.backdrop.width * q)), max(1, int(self.backdrop.height * q))), Image.BILINEAR)
            paste(frame, disc, sp["cx"] + dx - disc.width / 2,
                  sp["baseline"] + dy - im.height / 2 - disc.height / 2, opacity)
        else:
            paste(frame, self.shadow, sp["cx"] + dx - self.shadow.width / 2,
                  sp["baseline"] - self.shadow.height / 2, opacity * min(1.0, scale))
        paste(frame, im, sp["cx"] + dx - im.width / 2, sp["baseline"] + dy - im.height, opacity)


class Headline:
    def __init__(self, spec):
        self.spec = spec
        words = [w["text"] for w in spec["words"]]
        size = spec["size"]
        max_w = W * 0.84
        while True:
            f = font(size)
            space = f.getlength(" ")
            lines, cur, cur_w = [], [], 0.0
            for i, w in enumerate(words):
                ww = f.getlength(w)
                if cur and cur_w + space + ww > max_w:
                    lines.append(cur)
                    cur, cur_w = [], 0.0
                cur.append(i)
                cur_w += (space if len(cur) > 1 else 0) + ww
            if cur:
                lines.append(cur)
            if len(lines) <= 2 or size <= 24 * S:
                break
            size -= 4
        line_h = int(size * 1.18)
        top = spec["y"] + (int(size * 0.3) if spec.get("panel") else 0)
        self.words = []
        widest = 0
        for li, idxs in enumerate(lines):
            widths = [f.getlength(words[i]) for i in idxs]
            total = sum(widths) + space * (len(idxs) - 1)
            widest = max(widest, total)
            x = (W - total) / 2
            for i, wd in zip(idxs, widths):
                img = text_image(words[i], f, rgb(spec["color"]))
                self.words.append((img, x, top + li * line_h, spec["words"][i]["at"]))
                x += wd + space
        self.panel = None
        if spec.get("panel"):
            pad_x, pad_y = int(size * 0.6), int(size * 0.3)
            ph = line_h * len(lines) + pad_y * 2
            self.panel = rounded(widest + pad_x * 2, ph, min(ph / 2, 22 * S), rgb(spec["panel"], 236))
        self.first = min((w[3] for w in self.words), default=0)

    def draw(self, frame, t):
        if self.panel is not None:
            u = clamp01((t - self.first + 0.15) / 0.3)
            if u > 0:
                pw = max(1, int(self.panel.width * (0.6 + 0.4 * EASE["outCubic"](u))))
                p = self.panel.resize((pw, self.panel.height), Image.BILINEAR)
                paste(frame, p, (W - pw) / 2, self.spec["y"], u)
        for img, x, y, at in self.words:
            u = clamp01((t - at) / 0.35)
            if u > 0:
                paste(frame, img, x, y + (1 - EASE["outCubic"](u)) * 22 * S, u)


class Subline:
    def __init__(self, spec):
        self.spec = spec
        size = spec["size"]
        while font(size, bold=False).getlength(spec["text"]) > W * 0.86 and size > 14:
            size -= 2
        self.img = text_image(spec["text"], font(size, bold=False), rgb(spec["color"]))
        # Readable over any plate: a soft light pill behind the line.
        if spec["color"].upper() != PAL["light"].upper():
            pill_h = self.img.height + 12 * S
            bg = rounded(self.img.width + 28 * S, pill_h, pill_h / 2, rgb(PAL["light"], 235))
            bg.alpha_composite(self.img, (int(14 * S), int(6 * S)))
            self.img = bg

    def draw(self, frame, t):
        u = clamp01((t - self.spec["at"]) / 0.4)
        if u > 0:
            paste(frame, self.img, (W - self.img.width) / 2, self.spec["y"] + (1 - EASE["outCubic"](u)) * 14 * S, u)


class Chips:
    def __init__(self, spec):
        self.spec = spec
        size = spec["size"]
        gap = 14 * S
        while True:
            f = font(size)
            chips = []
            for item in spec["items"]:
                label = text_image(item["text"], f, rgb(spec["textColor"]))
                pill_h = label.height + 16 * S
                pill = rounded(label.width + 30 * S, pill_h, pill_h / 2, rgb(item["fill"]))
                pill.alpha_composite(label, (int(15 * S), int(8 * S)))
                chips.append(pill)
            total = sum(c.width for c in chips) + gap * (len(chips) - 1)
            if total <= W * 0.9 or size <= 12:
                break
            size -= 2
        x = (W - total) / 2
        self.chips = []
        for c, item in zip(chips, spec["items"]):
            self.chips.append((c, x, item["at"]))
            x += c.width + gap

    def draw(self, frame, t):
        for img, x, at in self.chips:
            u = clamp01((t - at) / 0.45)
            if u <= 0:
                continue
            s = max(0.05, 0.6 + 0.4 * EASE["outBack"](u))
            im = img if s == 1 else img.resize(
                (max(1, int(img.width * s)), max(1, int(img.height * s))), Image.BILINEAR)
            paste(frame, im, x + (img.width - im.width) / 2, self.spec["y"] + (img.height - im.height) / 2,
                  min(1.0, u * 1.6))


class Stat:
    NUM = re.compile(r"^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$")

    def __init__(self, spec):
        self.spec = spec
        m = self.NUM.match(spec["value"])
        self.parts = None
        if m:
            raw = m.group(2)
            decimals = len(raw.split(".")[1]) if "." in raw else 0
            self.parts = (m.group(1), float(raw.replace(",", "")), m.group(3), decimals, "," in raw)
        size = spec["size"]
        vf, lf = font(size), font(max(14, int(size * 0.3)), bold=False)
        while max(vf.getlength(spec["value"]), lf.getlength(spec["label"])) > W * 0.26 and size > 28:
            size -= 4
            vf, lf = font(size), font(max(14, int(size * 0.3)), bold=False)
        self.vf = vf
        self.label = text_image(spec["label"], lf, rgb(spec["labelColor"]))
        zero = vf.getbbox("0")
        self.vh = zero[3] - zero[1]
        cw = max(vf.getlength(spec["value"]), self.label.width) + 56 * S
        ch = self.vh + self.label.height + 60 * S
        self.card = rounded(cw, ch, 24 * S, rgb(spec["card"], 240))

    def value_text(self, u):
        if not self.parts or u >= 1:
            return self.spec["value"]
        pre, target, post, decimals, commas = self.parts
        v = target * EASE["outCubic"](u)
        s = f"{v:,.{decimals}f}" if commas else f"{v:.{decimals}f}"
        return f"{pre}{s}{post}"

    def draw(self, frame, t):
        sp = self.spec
        u = clamp01((t - sp["at"]) / 0.5)
        if u <= 0:
            return
        s = 0.7 + 0.3 * EASE["outBack"](u)
        card = self.card.resize((max(1, int(self.card.width * s)), max(1, int(self.card.height * s))), Image.BILINEAR)
        paste(frame, card, sp["cx"] - card.width / 2, sp["cy"] - card.height / 2, min(1.0, u * 1.5))
        if u < 0.4:
            return
        count = clamp01((t - sp["at"] - 0.2) / 1.0)
        val = text_image(self.value_text(count), self.vf, rgb(sp["color"]))
        top = sp["cy"] - self.card.height / 2 + 22 * S
        paste(frame, val, sp["cx"] - val.width / 2, top)
        paste(frame, self.label, sp["cx"] - self.label.width / 2, top + self.vh + 22 * S)


LAYER = {"actor": Actor, "headline": Headline, "subline": Subline, "chips": Chips, "stat": Stat}
# Actors sit behind the text so a tall character never covers a headline.
ORDER = {"actor": 0, "stat": 1, "chips": 2, "subline": 3, "headline": 4}


def build_layers(scene):
    layers = []
    for spec in sorted(scene["layers"], key=lambda l: ORDER.get(l["type"], 9)):
        try:
            layers.append(LAYER[spec["type"]](spec))
        except Exception as e:  # one broken layer should not sink the video
            print(f"skipping {spec['type']} layer:", e, file=sys.stderr)
    return layers


# ------------------------------------------------------------ transitions ----

def transition(kind, prev, cur, u):
    p = EASE["inOutSine"](u)
    if kind == "slide":
        out = Image.new("RGBA", (W, H))
        off = int(W * p)
        out.paste(prev.crop((off, 0, W, H)), (0, 0))
        if off > 0:
            out.paste(cur.crop((0, 0, off, H)), (W - off, 0))
        return out
    if kind == "wipe":
        bar = int(56 * S)
        edge = int((W + bar) * p)
        out = prev.copy()
        reveal = min(W, max(0, edge - bar))
        if reveal > 0:
            out.paste(cur.crop((0, 0, reveal, H)), (0, 0))
        if min(W, edge) > reveal:
            out.paste(rgb(PAL["accent"]), (reveal, 0, min(W, edge), H))
        return out
    return Image.blend(prev, cur, p)


# ------------------------------------------------------------------ video ----

silent = OUT.rsplit(".", 1)[0] + "-silent.mp4"
proc = subprocess.Popen(
    [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
     "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
     "-movflags", "+faststart", silent],
    stdin=subprocess.PIPE,
)

dark = Image.new("RGBA", (W, H), rgb(PAL["dark"]))
prev_last = dark
frames_total = int(round(TOTAL * FPS))
fade_frames = int(cfg.get("fadeOut", 0.8) * FPS)
written = 0

for si, scene in enumerate(cfg["scenes"]):
    bg = Background(scene["background"])
    layers = build_layers(scene)
    last_scene = si == len(cfg["scenes"]) - 1
    end = frames_total if last_scene else int(round((scene["start"] + scene["duration"]) * FPS))
    n = max(1, end - written)
    tr = scene["transition"]
    last = None
    for f in range(n):
        t = f / FPS
        frame = bg.frame(clamp01(t / max(scene["duration"], 0.001)))
        for layer in layers:
            layer.draw(frame, t)
        last = frame
        if t < tr["duration"]:
            frame = transition(tr["kind"], prev_last, frame, t / tr["duration"])
        g = written + f
        if fade_frames > 0 and g >= frames_total - fade_frames:
            frame = Image.blend(frame, dark, clamp01((g - (frames_total - fade_frames)) / fade_frames))
        proc.stdin.write(frame.convert("RGB").tobytes())
    written += n
    prev_last = last if last is not None else prev_last

proc.stdin.close()
proc.wait()
if proc.returncode != 0:
    sys.exit(f"ffmpeg failed while encoding frames (exit {proc.returncode})")

# ------------------------------------------------------------------ audio ----

mux(ff, silent, OUT, cfg)

print("done", OUT, round(TOTAL, 1), "seconds")
