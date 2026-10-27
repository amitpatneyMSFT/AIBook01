"""Narration and music for a motion explainer, shared by render.py and hf_assist.py.

Places each narration clip on the timeline, mixes in the music bed (looped,
faded, and ducked under the narrator by sidechain compression keyed off the
voice itself), normalizes loudness to -16 LUFS and copies the finished picture
untouched.
"""
import os, shutil, subprocess, sys


def mux(ff, silent, out, cfg):
    """Write `out`: the silent video plus the soundtrack described by the render config `cfg`."""
    total = float(cfg["duration"])
    clips = [c for c in cfg.get("narration", []) if c.get("src") and os.path.exists(c["src"])]
    music = cfg.get("music")
    if music and not os.path.exists(music.get("src", "")):
        print("music track not found, rendering without it", file=sys.stderr)
        music = None

    if not clips and not music:
        shutil.copy(silent, out)
        return

    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"
    cmd = [ff, "-y", "-loglevel", "error", "-i", silent]
    for c in clips:
        cmd += ["-i", c["src"]]
    parts = []
    if clips:
        for i, c in enumerate(clips, 1):
            ms = int(round(c["at"] * 1000))
            parts.append(f"[{i}:a]adelay=delays={ms}:all=1,{fmt}[n{i}]")
        joined = "".join(f"[n{i}]" for i in range(1, len(clips) + 1))
        parts.append(f"{joined}amix=inputs={len(clips)}:normalize=0,"
                     f"apad=whole_dur={total:.3f},atrim=0:{total:.3f}[narr]")
    if music:
        m = len(clips) + 1
        cmd += ["-stream_loop", "-1", "-i", music["src"]]
        fade_at = max(0.0, total - 2.5)
        parts.append(
            f"[{m}:a]{fmt},volume={music.get('volume', 0.35)},atrim=0:{total:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_at:.3f}:d=2.5[mus]"
        )
        if clips:
            # Duck the music whenever the narrator speaks, keyed off the voice itself.
            parts.append("[narr]asplit=2[voice][key]")
            parts.append("[mus][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=450[duck]")
            parts.append("[voice][duck]amix=inputs=2:normalize=0[pre]")
        else:
            parts.append("[mus]anull[pre]")
    else:
        parts.append("[narr]anull[pre]")
    parts.append("[pre]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[mix]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "160k", "-t", f"{total:.3f}", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
