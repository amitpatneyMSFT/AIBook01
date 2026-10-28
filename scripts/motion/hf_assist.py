"""Helpers around the HyperFrames motion renderer (src/lib/hyperframes.ts).

Usage:
    python scripts/motion/hf_assist.py config.json

config.json is one of:

    {"op": "cutouts", "srcs": ["hero.png", ...], "dir": "work", "result": "cutouts.json"}
        Keys out and trims each actor picture exactly as render.py does, saves
        the result into `dir` and writes {src: {"file", "width", "height"}}.

    {"op": "mux", "config": "config.json", "input": "silent.mp4", "output": "out.mp4"}
        Adds the narration and music described by render.py's config to a
        silent HyperFrames render: placed, ducked, normalized to -16 LUFS.

Requires: numpy, Pillow, imageio-ffmpeg  (python -m pip install numpy pillow imageio-ffmpeg)
"""
import json, os, sys

import imageio_ffmpeg

from audio import mux
from cutout import load_cutout

cfg = json.load(open(sys.argv[1], encoding="utf-8"))

if cfg["op"] == "cutouts":
    os.makedirs(cfg["dir"], exist_ok=True)
    result = {}
    for n, src in enumerate(dict.fromkeys(cfg["srcs"])):
        im = load_cutout(src)
        file = os.path.join(cfg["dir"], f"cutout-{n}.png").replace("\\", "/")
        im.save(file)
        result[src] = {"file": file, "width": im.width, "height": im.height}
    with open(cfg["result"], "w", encoding="utf-8") as f:
        json.dump(result, f)
elif cfg["op"] == "mux":
    render = json.load(open(cfg["config"], encoding="utf-8"))
    mux(imageio_ffmpeg.get_ffmpeg_exe(), cfg["input"], cfg["output"], render)
else:
    sys.exit(f"unknown op {cfg['op']!r}")
