"""Write synthetic assets for scripts/check-training.ts.

Usage:
    python scripts/training/fixtures.py OUT_DIR JOBS_JSON [--alpha]

Creates two presenter clips — one transparent VP9 WebM, as Azure returns them,
and one opaque on green to exercise the compositor's key-out (both transparent
with --alpha) — each with a tone
standing in for speech, plus a placeholder drawing for every raster job the
timeline needs. No model calls, no network.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
import imageio_ffmpeg

d = sys.argv[1]
jobs = json.load(open(sys.argv[2], encoding="utf-8"))
os.makedirs(d, exist_ok=True)
ff = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = 960, 540, 25


def presenter(i, n, opaque):
    im = Image.new("RGBA", (W, H), (0, 200, 0, 255) if opaque else (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    sway = int(6 * np.sin(i / 6))
    cx = W // 2 + sway
    draw.ellipse((cx - 55, 120, cx + 55, 240), fill=(240, 200, 170, 255))
    draw.rounded_rectangle((cx - 110, 250, cx + 110, H), 50, fill=(27, 80, 170, 255))
    mouth = 6 + int(6 * abs(np.sin(i / 2)))
    draw.ellipse((cx - 14, 205 - mouth // 2, cx + 14, 205 + mouth // 2), fill=(120, 40, 40, 255))
    return im


def clip(name, seconds, freq, opaque):
    out = os.path.join(d, name)
    n = int(seconds * FPS)
    proc = subprocess.Popen(
        [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p" if opaque else "yuva420p", "-auto-alt-ref", "0",
         "-deadline", "realtime", "-cpu-used", "8", "-b:v", "600k", "-c:a", "libopus", "-shortest", out],
        stdin=subprocess.PIPE,
    )
    for i in range(n):
        proc.stdin.write(presenter(i, n, opaque).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"could not write {name}")


clip("clip-0.webm", 6, 330, False)
# HyperFrames lays clips over the stage as they are, so its check needs both transparent.
clip("clip-1.webm", 5, 392, "--alpha" not in sys.argv)

palette = [(37, 99, 235), (14, 165, 233), (245, 158, 11), (30, 41, 59)]
for n, job in enumerate(jobs):
    for s in range(job["states"]):
        im = Image.new("RGBA", (job["width"], job["height"]), (0, 0, 0, 0))
        draw = ImageDraw.Draw(im)
        full = job["role"] in ("intro", "section", "outro")
        draw.rounded_rectangle((0, 0, im.width - 1, im.height - 1), 0 if full else 18,
                               fill=palette[n % len(palette)] + (255,))
        for b in range(s):
            y = 30 + b * 40
            draw.rounded_rectangle((30, y, im.width - 30, y + 28), 8, fill=(255, 255, 255, 230))
        draw.text((24, im.height - 30), f"{job['role']} {job.get('cueId', '')} state {s}", fill=(255, 255, 255, 255))
        im.save(os.path.join(d, f"{job['key']}-{s}.png"))

print("fixtures written to", d)
