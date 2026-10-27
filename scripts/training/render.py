"""Compose a training video: the transparent avatar presenter over timed visuals.

Usage:
    python scripts/training/render.py config.json

Invoked by src/lib/trainingbuild.ts. The config is compiled by
src/lib/trainingtimeline.ts, which decides every time and position, and every
visual was drawn by the browser (the same components the preview shows); this
script only plays them back:

- a gradient stage in the video's background color
- one transparent WebM presenter clip per section, decoded with its alpha
  channel, gliding between layouts (full, side by side, corner, hidden)
- visual panels that cut, fade, slide, wipe or zoom in when their phrase is
  spoken, bullet builds revealed in step with the speech, a slow push-in on
  pictures
- intro, section and outro cards, a lower third, burned-in captions and a logo
- the presenter clips' own audio on the timeline, loudness normalized

A clip that arrives without transparency has its flat background keyed out.

Requires: numpy, Pillow, imageio-ffmpeg  (python -m pip install numpy pillow imageio-ffmpeg)
"""
import json, os, subprocess, sys, textwrap
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import imageio_ffmpeg

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
W, H, FPS = int(cfg["width"]), int(cfg["height"]), int(cfg.get("fps", 25))
OUT = cfg["output"]
TOTAL = float(cfg["duration"])
TIMING = cfg.get("timing", {})
CUE_IN = float(TIMING.get("cueIn", 0.5))
CUE_OUT = float(TIMING.get("cueOut", 0.35))
REVEAL = float(TIMING.get("reveal", 0.35))
CARD_FADE = float(TIMING.get("cardFade", 0.4))
LOWER_IN = float(TIMING.get("lowerIn", 0.5))
LOWER_OUT = float(TIMING.get("lowerOut", 0.4))
EDGE_IN = float(TIMING.get("edgeIn", 0.4))
EDGE_OUT = float(TIMING.get("edgeOut", 0.6))
ff = imageio_ffmpeg.get_ffmpeg_exe()

_FONTS = [
    "C:/Windows/Fonts/segoeuisb.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
FONT = cfg.get("font") or next((p for p in _FONTS if os.path.exists(p)), None)


def font(size):
    # Hosts without system fonts (e.g. slim containers) get Pillow's built-in font.
    if FONT:
        try:
            return ImageFont.truetype(FONT, int(size))
        except OSError:
            pass
    try:
        return ImageFont.load_default(int(size))
    except TypeError:
        return ImageFont.load_default()


def rgb(hex_color, alpha=255):
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def out_cubic(u):
    return 1 - (1 - u) ** 3


def in_out_sine(u):
    return -(np.cos(np.pi * u) - 1) / 2


# ---------------------------------------------------------------- drawing ----

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
    right, bottom = min(im.width, W - x), min(im.height, H - y)
    if cx or cy or right < im.width or bottom < im.height:
        im = im.crop((cx, cy, right, bottom))
    frame.alpha_composite(with_opacity(im, opacity), (x + cx, y + cy))


_images = {}


def load(src, size=None):
    key = (src, size)
    if key not in _images:
        try:
            im = Image.open(src).convert("RGBA")
        except Exception as e:  # a missing drawing leaves its slot empty rather than failing
            print("visual failed:", src, e, file=sys.stderr)
            im = Image.new("RGBA", size or (1, 1), (0, 0, 0, 0))
        if size and im.size != size:
            im = im.resize(size, Image.LANCZOS)
        _images[key] = im
    return _images[key]


def stage():
    """The backdrop: the chosen color, lit from the top, a little darker at the foot."""
    r, g, b, _ = rgb(cfg.get("background", "#1F2A37"))
    base = np.array([r, g, b], dtype=np.float32)
    ys = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    xs = np.linspace(-1, 1, W, dtype=np.float32)[None, :, None]
    light = 1.12 - 0.3 * ys - 0.06 * xs**2
    arr = np.clip(base[None, None, :] * light + 6 * (1 - ys), 0, 255).astype(np.uint8)
    return Image.fromarray(np.ascontiguousarray(arr), "RGB").convert("RGBA")


_shadows = {}


def shadow(w, h):
    key = (w, h)
    if key not in _shadows:
        pad = int(28 * W / 1280)
        im = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        ImageDraw.Draw(im).rounded_rectangle(
            (pad, pad + pad // 3, pad + w, pad + h + pad // 3), radius=int(18 * W / 1280), fill=(0, 0, 0, 90)
        )
        _shadows[key] = (im.filter(ImageFilter.GaussianBlur(pad / 2.2)), pad)
    return _shadows[key]


# ------------------------------------------------------------- presenter ----

class Clip:
    """Sequential RGBA frames of one presenter clip, scaled to the frame."""

    def __init__(self, spec):
        self.src = spec["src"]
        self.start = float(spec["start"])
        self.duration = float(spec["duration"])
        self.proc = None
        self.index = -1
        self.raw = None
        self.image = None
        self.image_index = -2
        self.keyed = None
        self.key_color = None
        self.done = False

    def _open(self):
        # The native VP9 decoder drops the alpha plane; libvpx keeps it.
        self.proc = subprocess.Popen(
            [ff, "-v", "error", "-c:v", "libvpx-vp9", "-i", self.src, "-an",
             "-vf", f"fps={FPS},scale={W}:{H}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
            stdout=subprocess.PIPE,
        )

    def frame(self, t):
        want = int(t * FPS + 1e-6)
        if self.proc is None and not self.done:
            self._open()
        size = W * H * 4
        while self.index < want and not self.done:
            buf = self.proc.stdout.read(size)
            if len(buf) < size:
                # Speech can outlast the last frame by a few milliseconds; hold it.
                self.done = True
                break
            self.raw = buf
            self.index += 1
        if self.raw is None:
            return None
        if self.image_index != self.index:
            arr = np.frombuffer(self.raw, np.uint8).reshape(H, W, 4)
            if self.keyed is None:
                # No alpha at all means the service ignored the transparent background.
                self.keyed = bool(arr[..., 3].min() == 255)
                if self.keyed:
                    border = np.concatenate([arr[0, :, :3], arr[-1, :, :3], arr[:, 0, :3], arr[:, -1, :3]])
                    self.key_color = np.median(border, axis=0).astype(np.int16)
            if self.keyed:
                arr = arr.copy()
                dist = np.abs(arr[..., :3].astype(np.int16) - self.key_color).sum(axis=2)
                arr[..., 3] = np.clip((dist - 45) * 5, 0, 255).astype(np.uint8)
                # Pull the key color's spill out of the soft edge.
                edge = (arr[..., 3] > 0) & (arr[..., 3] < 255)
                if edge.any():
                    rgbv = arr[..., :3].astype(np.int16)
                    k = int(np.argmax(self.key_color))
                    others = [c for c in range(3) if c != k]
                    cap = np.maximum(rgbv[..., others[0]], rgbv[..., others[1]])
                    arr[..., k] = np.where(edge, np.minimum(rgbv[..., k], cap), rgbv[..., k]).astype(np.uint8)
                self.image = Image.fromarray(arr, "RGBA")
            else:
                self.image = Image.frombuffer("RGBA", (W, H), self.raw, "raw", "RGBA", 0, 1)
            self.image_index = self.index
        return self.image

    def close(self):
        if self.proc:
            try:
                self.proc.stdout.close()
                self.proc.kill()
                self.proc.wait(timeout=5)
            except Exception:
                pass
            self.proc = None
        self.done = True


def pose_at(frames, t):
    if not frames:
        return 0.5, 0.5, 1.0, 1.0
    if t < frames[0]["t"]:
        f = frames[0]
        return f["cx"], f["cy"], f["scale"], f["opacity"]
    for a, b in zip(frames, frames[1:]):
        if t < b["t"]:
            span = b["t"] - a["t"]
            u = clamp01((t - a["t"]) / span) if span > 0 else 1.0
            e = in_out_sine(u) if b.get("ease") == "inOutSine" else u
            return tuple(a[k] + (b[k] - a[k]) * e for k in ("cx", "cy", "scale", "opacity"))
    f = frames[-1]
    return f["cx"], f["cy"], f["scale"], f["opacity"]


def draw_presenter(frame, clip, t):
    im = clip.frame(t - clip.start)
    if im is None:
        return
    cx, cy, scale, opacity = pose_at(cfg["avatar"], t)
    if opacity <= 0.01:
        return
    if abs(scale - 1) > 0.002:
        im = im.resize((max(1, int(W * scale)), max(1, int(H * scale))), Image.BILINEAR)
    paste(frame, im, cx * W - im.width / 2, cy * H - im.height / 2, opacity)


# ---------------------------------------------------------------- visuals ----

def rect_px(r):
    return (
        int(round(r["x"] * W)),
        int(round(r["y"] * H)),
        max(1, int(round(r["w"] * W))),
        max(1, int(round(r["h"] * H))),
    )


def draw_cue(frame, q, t):
    start, end = q["start"], q["end"]
    if t < start or t >= end + CUE_OUT:
        return
    x, y, w, h = rect_px(q["panel"])
    states = q["states"]
    k = 0
    for i, s in enumerate(states):
        if t >= s["at"]:
            k = i
    im = load(states[k]["src"], (w, h))
    if k > 0 and states[k]["at"] > start and t - states[k]["at"] < REVEAL:
        im = Image.blend(load(states[k - 1]["src"], (w, h)), im, clamp01((t - states[k]["at"]) / REVEAL))

    if q.get("kenBurns"):
        z = 1 + 0.06 * clamp01((t - start) / max(0.1, end - start))
        cw, ch = w / z, h / z
        ox, oy = (w - cw) / 2, (h - ch) / 2
        im = im.resize((w, h), Image.BILINEAR, box=(ox, oy, ox + cw, oy + ch))

    opacity, dx, scale = 1.0, 0.0, 1.0
    u = clamp01((t - start) / CUE_IN) if CUE_IN else 1.0
    kind = q.get("transition", "fade")
    if u < 1 and kind != "cut":
        e = out_cubic(u)
        if kind == "slide":
            dx, opacity = (1 - e) * 0.08 * W, e
        elif kind == "zoom":
            scale, opacity = 0.9 + 0.1 * e, e
        elif kind == "wipe":
            im = im.crop((0, 0, max(1, int(w * e)), h))
        else:
            opacity = e
    if t >= end:
        opacity *= 1 - clamp01((t - end) / CUE_OUT) if CUE_OUT else 0.0

    if not (w >= W and h >= H):
        sh, pad = shadow(w, h)
        paste(frame, sh, x - pad + dx, y - pad, opacity * 0.9)
    if abs(scale - 1) > 0.002:
        sw, shh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
        paste(frame, im.resize((sw, shh), Image.BILINEAR), x + dx + (w - sw) / 2, y + (h - shh) / 2, opacity)
    else:
        paste(frame, im, x + dx, y, opacity)


def card_opacity(card, t):
    s, d = card["start"], card["duration"]
    if t < s or t >= s + d:
        return 0.0
    fade_in = 1.0 if s <= 0.01 or not CARD_FADE else clamp01((t - s) / CARD_FADE)
    fade_out = 1.0 if s + d >= TOTAL - 0.01 or not CARD_FADE else clamp01((s + d - t) / CARD_FADE)
    return min(fade_in, fade_out)


def draw_lower_third(frame, lt, t):
    if t < lt["start"] or t >= lt["end"]:
        return
    x, y, w, h = rect_px(lt["rect"])
    im = load(lt["src"], (w, h))
    u = out_cubic(clamp01((t - lt["start"]) / LOWER_IN)) if LOWER_IN else 1.0
    out = clamp01((lt["end"] - t) / LOWER_OUT) if LOWER_OUT else 1.0
    paste(frame, im, x - (1 - u) * (w * 0.4), y, u * out)


_captions = {}
CAP_SIZE = int(H * 0.036)


def caption_image(i, text):
    if i not in _captions:
        f = font(CAP_SIZE)
        max_w = int(W * 0.78)
        avg = max(1, f.getlength("abcdefghijklmnopqrstuvwxyz ") / 27)
        lines = textwrap.wrap(text, width=max(10, int(max_w / avg)))[:2] or [""]
        widths = [f.getbbox(line)[2] - f.getbbox(line)[0] for line in lines]
        lh = int(CAP_SIZE * 1.3)
        pad_x, pad_y = int(CAP_SIZE * 0.7), int(CAP_SIZE * 0.35)
        bw = max(widths) + pad_x * 2
        bh = lh * len(lines) + pad_y * 2
        im = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, bw - 1, bh - 1), radius=int(CAP_SIZE * 0.4), fill=(12, 14, 18, 190))
        for n, line in enumerate(lines):
            l, tp, r, b = f.getbbox(line)
            d.text(((bw - (r - l)) / 2 - l, pad_y + n * lh + (lh - (b - tp)) / 2 - tp), line, font=f,
                   fill=(255, 255, 255, 255))
        _captions[i] = im
    return _captions[i]


logo = None
if cfg.get("logo"):
    try:
        lg = Image.open(cfg["logo"]).convert("RGBA")
        s = min((H * 0.07) / lg.height, (W * 0.14) / lg.width)
        logo = lg.resize((max(1, int(lg.width * s)), max(1, int(lg.height * s))), Image.LANCZOS)
    except Exception as e:
        print("logo failed:", e, file=sys.stderr)


# ------------------------------------------------------------------ video ----

base = stage()
clips = [Clip(c) for c in cfg["clips"]]
cues = sorted(cfg.get("cues", []), key=lambda q: q["start"])
cards = cfg.get("cards", [])
captions = cfg.get("captions", [])
lower = cfg.get("lowerThird")
black = Image.new("RGBA", (W, H), (0, 0, 0, 255))

silent = OUT.rsplit(".", 1)[0] + "-silent.mp4"
proc = subprocess.Popen(
    [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
     "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20",
     "-movflags", "+faststart", silent],
    stdin=subprocess.PIPE,
)

frames_total = int(round(TOTAL * FPS))
cap_i = 0
for n in range(frames_total):
    t = n / FPS
    frame = base.copy()

    # Cards are opaque: skip everything beneath a fully shown one.
    covering = max((card_opacity(c, t) for c in cards), default=0.0)
    if covering < 0.999:
        for q in cues:
            if q["start"] > t:
                break
            draw_cue(frame, q, t)
        for clip in clips:
            if clip.start <= t < clip.start + clip.duration:
                draw_presenter(frame, clip, t)
            elif t >= clip.start + clip.duration and clip.proc:
                clip.close()
        if lower:
            draw_lower_third(frame, lower, t)
        while cap_i < len(captions) and captions[cap_i]["end"] <= t:
            cap_i += 1
        if cap_i < len(captions) and captions[cap_i]["start"] <= t:
            im = caption_image(cap_i, captions[cap_i]["text"])
            paste(frame, im, (W - im.width) / 2, H * 0.965 - im.height)
    for c in cards:
        o = card_opacity(c, t)
        if o > 0:
            paste(frame, load(c["src"], (W, H)), 0, 0, o)
    if logo is not None:
        paste(frame, logo, W - logo.width - int(W * 0.02), int(H * 0.03), 0.85)

    # Fade up from and down to black.
    edge = min(clamp01(t / EDGE_IN) if EDGE_IN else 1.0,
               clamp01((TOTAL - t) / EDGE_OUT) if EDGE_OUT else 1.0)
    if edge < 1:
        frame = Image.blend(black, frame, edge)
    proc.stdin.write(frame.convert("RGB").tobytes())

    if n % (FPS * 10) == 0:
        print(f"frame {n}/{frames_total}", file=sys.stderr, flush=True)

for clip in clips:
    clip.close()
proc.stdin.close()
proc.wait()
if proc.returncode != 0:
    sys.exit(f"ffmpeg failed while encoding frames (exit {proc.returncode})")

# ------------------------------------------------------------------ audio ----

fmt = "aformat=sample_rates=48000:channel_layouts=stereo"
cmd = [ff, "-y", "-loglevel", "error", "-i", silent]
parts = []
for i, c in enumerate(cfg["clips"], 1):
    cmd += ["-i", c["src"]]
    ms = int(round(float(c["start"]) * 1000))
    parts.append(f"[{i}:a]{fmt},adelay=delays={ms}:all=1[s{i}]")
joined = "".join(f"[s{i}]" for i in range(1, len(cfg["clips"]) + 1))
parts.append(
    f"{joined}amix=inputs={len(cfg['clips'])}:normalize=0,apad=whole_dur={TOTAL:.3f},atrim=0:{TOTAL:.3f},"
    f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]"
)
cmd += ["-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[mix]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "160k", "-t", f"{TOTAL:.3f}", "-movflags", "+faststart", OUT]
subprocess.run(cmd, check=True)
try:
    os.remove(silent)
except OSError:
    pass

print("done", OUT, round(TOTAL, 1), "seconds")
