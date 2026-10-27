"""Cutout loading for a motion explainer, shared by render.py and hf_assist.py.

An actor picture with no transparency has its background keyed out from the
border inward, so an image model that ignores the transparency request still
produces a clean cutout.
"""
import numpy as np
from PIL import Image, ImageFilter


def key_out(im):
    """Alpha from the border inward: pixels near the border color and connected to the edge."""
    small = im.convert("RGB")
    scale = 384 / max(small.size)
    if scale < 1:
        small = small.resize((max(1, int(small.width * scale)), max(1, int(small.height * scale))), Image.BILINEAR)
    a = np.asarray(small).astype(np.int32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    similar = np.abs(a - bg).sum(axis=2) < 70
    conn = np.zeros_like(similar)
    conn[0], conn[-1], conn[:, 0], conn[:, -1] = similar[0], similar[-1], similar[:, 0], similar[:, -1]
    for _ in range(4000):
        grown = conn.copy()
        grown[1:] |= conn[:-1]
        grown[:-1] |= conn[1:]
        grown[:, 1:] |= conn[:, :-1]
        grown[:, :-1] |= conn[:, 1:]
        grown &= similar
        if (grown == conn).all():
            break
        conn = grown
    mask = Image.fromarray(((~conn) * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def load_cutout(path):
    im = Image.open(path).convert("RGBA")
    alpha = np.asarray(im)[..., 3]
    # A model that ignored the transparency request returns a fully opaque picture.
    if (alpha < 200).mean() < 0.02:
        im = key_out(im)
    box = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    return im.crop(box) if box else im
