/**
 * Turns a compiled motion timeline (src/lib/motiontimeline.ts) into a
 * HyperFrames project: one HTML composition whose GSAP timeline replays what
 * scripts/motion/render.py would draw, scene by scene, so either renderer
 * shows the same video from the same config.
 *
 * Pure: it returns the HTML and the files it refers to. The narration and
 * music are not part of it; they are laid under the silent render afterwards
 * (scripts/motion/hf_assist.py), so ducking and loudness match render.py.
 */
import type { Cutout } from "./hyperframes";
import { GSAP_FILE, assetBook, esc, num, type HyperframesProject } from "./hyperframesproject";
import type {
  ActorLayer,
  ChipsLayer,
  Ease,
  HeadlineLayer,
  Keyframe,
  Layer,
  RenderScene,
  RenderConfig,
  StatLayer,
  SublineLayer,
} from "./motiontimeline";

export type MotionHyperframesOptions = {
  /** The trimmed, keyed-out picture for an actor's source file; undefined drops the actor. */
  cutout: (src: string) => Cutout | undefined;
};

type Book = ReturnType<typeof assetBook>;

const FONT = `"Segoe UI", Inter, "DejaVu Sans", Arial, sans-serif`;
const EASES: Record<Ease, string> = {
  linear: "none",
  outCubic: "power3.out",
  outBack: "back.out(1.70158)",
  inOutSine: "sine.inOut",
};
/** Actors sit behind the text so a tall character never covers a headline. */
const ORDER: Record<Layer["type"], number> = { actor: 0, stat: 1, chips: 2, subline: 3, headline: 4 };
const FPS = [24, 30, 60];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (u: number) => 1 - (1 - u) ** 3;
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000");
const rgba = (c: string, a: number) => {
  const h = hex(c).slice(1);
  return `rgba(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",")},${a})`;
};

/** The number the stat card counts up to, split so the rest of the value stays put. */
const NUMBER = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/;

export function statText(value: string, u: number): string {
  const m = NUMBER.exec(value);
  if (!m || u >= 1) return value;
  const raw = m[2];
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  const v = parseFloat(raw.replace(/,/g, "")) * outCubic(clamp01(u));
  const text = raw.includes(",")
    ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : v.toFixed(decimals);
  return `${m[1]}${text}${m[3]}`;
}

type Segment = { at: number; duration: number; y: number; from: number; ease: string };

/**
 * A character's idle motion as a chain of quarter-wave eases, which join into
 * the same sine (or hop) render.py computes per frame. It eases in over 0.4 s
 * after the character has arrived.
 */
export function idleSegments(
  idle: NonNullable<ActorLayer["idle"]>,
  settle: number,
  end: number,
): Segment[] {
  const bob = idle.kind === "bob";
  const unit = bob ? idle.amp * 1.6 : idle.amp;
  const dy = (t: number) => {
    const wave = Math.sin((2 * Math.PI * t) / idle.period + idle.phase);
    const ramp = clamp01((t - settle) / 0.4);
    return bob ? -Math.abs(wave) * unit * ramp : wave * unit * ramp;
  };
  const out: Segment[] = [];
  let at = settle;
  let from = 0;
  const push = (to: number, y: number) => {
    if (to - at < 0.001) return;
    out.push({
      at: num(at),
      duration: num(to - at),
      y: num(y),
      from: num(from),
      ease: Math.abs(y) > Math.abs(from) ? "sine.out" : "sine.in",
    });
    at = to;
    from = y;
  };
  const first = Math.floor(((2 * Math.PI * settle) / idle.period + idle.phase) / (Math.PI / 2)) + 1;
  for (let k = first; ; k++) {
    const t = ((k * Math.PI) / 2 - idle.phase) * (idle.period / (2 * Math.PI));
    if (t >= end) break;
    push(t, dy(t));
  }
  push(end, dy(end));
  return out;
}

function actorHtml(
  a: ActorLayer,
  id: string,
  dur: number,
  T: (t: number) => number,
  js: string[],
  book: Book,
  opts: MotionHyperframesOptions,
  S: number,
): string {
  const cut = opts.cutout(a.src);
  if (!cut) return "";
  const k = Math.min(a.maxW / cut.width, a.maxH / cut.height);
  const w = Math.max(1, Math.round(cut.width * k));
  const h = Math.max(1, Math.round(cut.height * k));
  const file = book.add(cut.file, `${id}.png`);
  const box = `left:${num(a.cx - w / 2)}px;top:${num(a.baseline - h)}px;width:${w}px;height:${h}px`;
  const pose = (f: Keyframe) => `{x:${num(f.dx)},y:${num(f.dy)},scale:${num(f.scale)},opacity:${num(f.opacity)}}`;

  let shadow = "";
  if (!a.backdrop) {
    const sw = Math.max(1, Math.round(w * 0.7));
    const sh = Math.max(1, Math.round(18 * S));
    shadow = `<div id="${id}s" class="shadow" style="left:${num(a.cx - sw / 2)}px;top:${num(a.baseline - sh / 2)}px;width:${sw}px;height:${sh}px"></div>`;
  }
  let disc = "";
  if (a.backdrop) {
    const d = Math.round(Math.max(w, h) * 1.12);
    disc = `<div class="disc" style="left:${num((w - d) / 2)}px;top:${num((h - d) / 2)}px;width:${d}px;height:${d}px;background:${rgba(a.backdrop, 0.92)}"></div>`;
  }
  const html = [
    shadow,
    `<div id="${id}" class="actor" style="${box}"><div id="${id}i" class="idle">${disc}<img src="${file}" alt=""${a.flip ? ' style="transform:scaleX(-1)"' : ""}></div></div>`,
  ].join("");

  const kf = a.keyframes;
  // The shadow stays on the ground and fades with the character's size.
  const dim = (f: Keyframe) => num(f.opacity * Math.min(1, f.scale));
  js.push(`tl.set("#${id}",${pose(kf[0])},${T(kf[0].t)});`);
  if (shadow) js.push(`tl.set("#${id}s",{x:${num(kf[0].dx)},opacity:${dim(kf[0])}},${T(kf[0].t)});`);
  for (let j = 1; j < kf.length; j++) {
    const p = kf[j - 1];
    const q = kf[j];
    const span = q.t - p.t;
    const same = p.dx === q.dx && p.dy === q.dy && p.scale === q.scale && p.opacity === q.opacity;
    if (same || span <= 0) continue;
    const ease = EASES[q.ease] ?? "none";
    js.push(
      `tl.fromTo("#${id}",${pose(p)},{...${pose(q)},duration:${num(span)},ease:"${ease}",immediateRender:false},${T(p.t)});`,
    );
    if (shadow) {
      js.push(
        `tl.fromTo("#${id}s",{x:${num(p.dx)},opacity:${dim(p)}},{x:${num(q.dx)},opacity:${dim(q)},duration:${num(span)},ease:"${ease}",immediateRender:false},${T(p.t)});`,
      );
    }
  }
  if (a.idle) {
    for (const s of idleSegments(a.idle, kf[kf.length - 1].t, dur)) {
      js.push(
        `tl.fromTo("#${id}i",{y:${s.from}},{y:${s.y},duration:${s.duration},ease:"${s.ease}",immediateRender:false},${T(s.at)});`,
      );
    }
  }
  return html;
}

function headlineHtml(h: HeadlineLayer, id: string, W: number, S: number, T: (t: number) => number, js: string[]) {
  const words = h.words.map((w, k) => `<span id="${id}w${k}" class="w">${esc(w.text)}</span>`).join(" ");
  const padX = h.panel ? h.size * 0.6 : 0;
  const padY = h.panel ? h.size * 0.3 : 0;
  const bg = h.panel
    ? `<div id="${id}b" class="bg" style="background:${rgba(h.panel, 0.925)};border-radius:${num(22 * S)}px"></div>`
    : "";
  h.words.forEach((w, k) => {
    // The rise is eased, the fade is not, as in render.py.
    js.push(
      `tl.fromTo("#${id}w${k}",{opacity:0},{opacity:1,duration:0.35,ease:"none"},${T(w.at)});`,
      `tl.fromTo("#${id}w${k}",{y:${num(22 * S)}},{y:0,duration:0.35,ease:"power3.out"},${T(w.at)});`,
    );
  });
  if (h.panel && h.words.length) {
    const first = Math.min(...h.words.map((w) => w.at));
    js.push(
      `tl.fromTo("#${id}b",{opacity:0,scaleX:0.6},{opacity:1,scaleX:1,duration:0.3,ease:"power3.out"},${T(first - 0.15)});`,
    );
  }
  return (
    `<div class="hl" style="top:${h.y}px"><div class="hlp" data-panel="${h.panel ? 1 : 0}" style="padding:${num(padY)}px ${num(padX)}px">${bg}` +
    `<div id="${id}" class="hlt" data-size="${h.size}" style="font-size:${h.size}px;color:${hex(h.color)};max-width:${num(W * 0.84)}px">${words}</div></div></div>`
  );
}

function sublineHtml(s: SublineLayer, id: string, S: number, cfg: RenderConfig, T: (t: number) => number, js: string[]) {
  // A soft light pill keeps the line readable over any plate.
  const pill = hex(s.color).toUpperCase() !== hex(cfg.palette.light).toUpperCase();
  js.push(
    `tl.fromTo("#${id}p",{opacity:0},{opacity:1,duration:0.4,ease:"none"},${T(s.at)});`,
    `tl.fromTo("#${id}p",{y:${num(14 * S)}},{y:0,duration:0.4,ease:"power3.out"},${T(s.at)});`,
  );
  const style = `padding:${num(6 * S)}px ${num(14 * S)}px;${pill ? `background:${rgba(cfg.palette.light, 0.92)};border-radius:999px` : ""}`;
  return (
    `<div class="sub" style="top:${s.y}px"><div id="${id}p" class="subp" style="${style}">` +
    `<span id="${id}" class="subt" data-size="${s.size}" style="font-size:${s.size}px;color:${hex(s.color)}">${esc(s.text)}</span></div></div>`
  );
}

function chipsHtml(c: ChipsLayer, id: string, S: number, T: (t: number) => number, js: string[]) {
  const chips = c.items
    .map((item, k) => {
      js.push(
        `tl.fromTo("#${id}c${k}",{scale:0.6},{scale:1,duration:0.45,ease:"back.out(1.70158)"},${T(item.at)});`,
        `tl.fromTo("#${id}c${k}",{opacity:0},{opacity:1,duration:0.281,ease:"none"},${T(item.at)});`,
      );
      return `<span id="${id}c${k}" class="chip" style="background:${hex(item.fill)};color:${hex(c.textColor)};padding:${num(8 * S)}px ${num(15 * S)}px;opacity:0">${esc(item.text)}</span>`;
    })
    .join("");
  return `<div id="${id}" class="chips" data-size="${c.size}" data-gap="${num(14 * S)}" style="top:${c.y}px;gap:${num(14 * S)}px;font-size:${c.size}px">${chips}</div>`;
}

function statHtml(s: StatLayer, id: string, S: number, T: (t: number) => number, js: string[]) {
  const small = Math.max(14, Math.trunc(s.size * 0.3));
  js.push(
    `tl.fromTo("#${id}c",{scale:0.7},{scale:1,duration:0.5,ease:"back.out(1.70158)"},${T(s.at)});`,
    `tl.fromTo("#${id}c",{opacity:0},{opacity:1,duration:0.333,ease:"none"},${T(s.at)});`,
    `tl.set("#${id}v",{opacity:1},${T(s.at + 0.2)});`,
    `tl.set("#${id}l",{opacity:1},${T(s.at + 0.2)});`,
  );
  // The number counts up for a second, a step every 1/30 s.
  if (NUMBER.test(s.value)) {
    for (let step = 0; step <= 30; step++) {
      js.push(`tl.set("#${id}v",{textContent:${JSON.stringify(statText(s.value, step / 30))}},${T(s.at + 0.2 + step / 30)});`);
    }
  }
  return (
    `<div class="stat" style="left:${s.cx}px;top:${s.cy}px">` +
    `<div id="${id}c" class="statc" data-size="${s.size}" style="padding:${num(22 * S)}px ${num(28 * S)}px;background:${rgba(s.card, 0.94)};border-radius:${num(24 * S)}px;opacity:0">` +
    `<div id="${id}v" class="statv" style="font-size:${s.size}px;color:${hex(s.color)};opacity:0">${esc(s.value)}</div>` +
    `<div id="${id}l" class="statl" style="font-size:${small}px;color:${hex(s.labelColor)};margin-top:${num(12 * S)}px;opacity:0">${esc(s.label)}</div></div></div>`
  );
}

function sceneHtml(
  sc: RenderScene,
  i: number,
  cfg: RenderConfig,
  js: string[],
  book: Book,
  opts: MotionHyperframesOptions,
): string {
  const S = cfg.width / 1280;
  const T = (t: number) => num(sc.start + t);
  const parts: string[] = [];

  if (sc.background.src) {
    const ext = /\.[a-z0-9]{2,5}$/i.exec(sc.background.src)?.[0].toLowerCase() ?? ".png";
    parts.push(`<img id="p${i}" class="plate" src="${book.add(sc.background.src, `bg-${i}${ext}`)}" alt="">`);
    if (sc.background.zoomFrom !== sc.background.zoomTo) {
      js.push(
        `tl.fromTo("#p${i}",{scale:${sc.background.zoomFrom}},{scale:${sc.background.zoomTo},duration:${num(sc.duration)},ease:"sine.inOut"},${T(0)});`,
      );
    }
  }

  [...sc.layers]
    .sort((a, b) => ORDER[a.type] - ORDER[b.type])
    .forEach((layer, n) => {
      const id = `l${i}x${n}`;
      if (layer.type === "actor") parts.push(actorHtml(layer, id, sc.duration, T, js, book, opts, S));
      else if (layer.type === "headline") parts.push(headlineHtml(layer, id, cfg.width, S, T, js));
      else if (layer.type === "subline") parts.push(sublineHtml(layer, id, S, cfg, T, js));
      else if (layer.type === "chips") parts.push(chipsHtml(layer, id, S, T, js));
      else parts.push(statHtml(layer, id, S, T, js));
    });
  return parts.join("\n");
}

export function buildMotionHyperframes(cfg: RenderConfig, opts: MotionHyperframesOptions): HyperframesProject {
  const W = cfg.width;
  const H = cfg.height;
  const S = W / 1280;
  const fps = FPS.includes(cfg.fps) ? cfg.fps : 30;
  const total = cfg.duration;
  const book = assetBook();
  const js: string[] = [];
  const html: string[] = [];
  const last = cfg.scenes.length - 1;
  const bar = Math.round(56 * S);

  cfg.scenes.forEach((sc, i) => {
    // A scene stays until the next one has finished arriving over it.
    const hold = i === last ? total - sc.start : sc.duration + cfg.scenes[i + 1].transition.duration;
    const d = sc.transition.duration;
    const kind = i === 0 ? "fade" : sc.transition.kind;
    const z = i * 2 + 1;
    const at = num(sc.start);
    html.push(
      `<div id="s${i}" class="scene" data-start="${at}" data-duration="${num(hold)}" style="z-index:${z};background:${hex(sc.background.color)}">`,
      sceneHtml(sc, i, cfg, js, book, opts),
      `</div>`,
    );
    if (d <= 0) return;
    if (kind === "slide") {
      js.push(
        `tl.fromTo("#s${i}",{x:${W}},{x:0,duration:${d},ease:"sine.inOut"},${at});`,
        `tl.fromTo("#s${i - 1}",{x:0},{x:${-W},duration:${d},ease:"sine.inOut",immediateRender:false},${at});`,
      );
    } else if (kind === "wipe") {
      // The new scene is revealed from the left behind a sweeping accent bar.
      html.push(
        `<div id="w${i}" class="bar" data-start="${at}" data-duration="${num(d)}" style="z-index:${z + 1};width:${bar}px;height:${H}px;background:${hex(cfg.palette.accent)}"></div>`,
      );
      js.push(
        `tl.fromTo("#s${i}",{clipPath:"inset(0px ${W + bar}px 0px 0px)"},{clipPath:"inset(0px 0px 0px 0px)",duration:${d},ease:"sine.inOut"},${at});`,
        `tl.fromTo("#w${i}",{x:${-bar}},{x:${W},duration:${d},ease:"sine.inOut"},${at});`,
      );
    } else {
      js.push(`tl.fromTo("#s${i}",{opacity:0},{opacity:1,duration:${d},ease:"sine.inOut"},${at});`);
    }
  });

  if (cfg.fadeOut > 0) {
    const from = num(Math.max(0, total - cfg.fadeOut));
    html.push(
      `<div id="out" class="out" data-start="${from}" data-duration="${num(cfg.fadeOut)}" style="background:${hex(cfg.palette.dark)}"></div>`,
    );
    js.push(`tl.fromTo("#out",{opacity:0},{opacity:1,duration:${cfg.fadeOut},ease:"none"},${from});`);
  }
  // Pin the timeline to the video's length.
  js.push(`tl.set("#root",{opacity:1},${num(total)});`);

  const dark = hex(cfg.palette.dark);
  const css = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${dark}; }
body { font-family: ${FONT}; }
#root { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${dark}; }
.scene { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
.plate { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: cover; }
.bar { position: absolute; left: 0; top: 0; }
.out { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 9999; opacity: 0; }
.shadow { position: absolute; border-radius: 50%; background: rgba(0,0,0,.235); filter: blur(4px); }
.actor { position: absolute; transform-origin: 50% 100%; }
.idle { position: absolute; inset: 0; }
.idle img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.disc { position: absolute; border-radius: 50%; }
.hl, .sub { position: absolute; left: 0; width: ${W}px; display: flex; justify-content: center; }
.hlp { position: relative; }
.hlp .bg { position: absolute; inset: 0; }
.hlt { position: relative; width: max-content; text-align: center; font-weight: 700; line-height: 1.18; }
.hlt .w { display: inline-block; }
.subp { position: relative; }
.subt { white-space: nowrap; font-weight: 400; }
.chips { position: absolute; left: 0; width: ${W}px; display: flex; justify-content: center; }
.chip { display: inline-block; border-radius: 999px; font-weight: 700; white-space: nowrap; }
.stat { position: absolute; transform: translate(-50%, -50%); }
.statc { width: max-content; text-align: center; }
.statv { font-weight: 700; line-height: 1; white-space: nowrap; }
.statl { white-space: nowrap; }`;

  // Text is fitted in the browser, as render.py does with its fonts: headlines
  // shrink to two lines, one-liners and chip rows to the frame's width.
  const fit = `
const S = ${num(S)}, W = ${W};
document.querySelectorAll(".hlt").forEach(function (el) {
  var size = +el.dataset.size, ws = el.querySelectorAll(".w");
  function lines() { var tops = {}; ws.forEach(function (w) { tops[Math.round(w.offsetTop)] = 1; }); return Object.keys(tops).length; }
  while (lines() > 2 && size > 24 * S) { size -= 4; el.style.fontSize = size + "px"; }
  var p = el.parentElement;
  if (p.dataset.panel === "1") p.style.padding = (size * 0.3) + "px " + (size * 0.6) + "px";
});
document.querySelectorAll(".subt").forEach(function (el) {
  var size = +el.dataset.size;
  while (el.getBoundingClientRect().width > W * 0.86 && size > 14) { size -= 2; el.style.fontSize = size + "px"; }
});
document.querySelectorAll(".chips").forEach(function (row) {
  var size = +row.dataset.size, gap = +row.dataset.gap, chips = row.querySelectorAll(".chip");
  function total() { var t = gap * (chips.length - 1); chips.forEach(function (c) { t += c.getBoundingClientRect().width; }); return t; }
  while (total() > W * 0.9 && size > 12) { size -= 2; row.style.fontSize = size + "px"; }
});
document.querySelectorAll(".statc").forEach(function (card) {
  var v = card.querySelector(".statv"), l = card.querySelector(".statl"), size = +card.dataset.size;
  function widest() { return Math.max(v.getBoundingClientRect().width, l.getBoundingClientRect().width); }
  while (widest() > W * 0.26 && size > 28) {
    size -= 4;
    v.style.fontSize = size + "px";
    l.style.fontSize = Math.max(14, Math.floor(size * 0.3)) + "px";
  }
  card.style.width = card.getBoundingClientRect().width + "px";
});`;

  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${W}, height=${H}">
<script src="${GSAP_FILE}"></script>
<style>${css}
</style>
</head>
<body>
<div id="root" data-composition-id="root" data-width="${W}" data-height="${H}" data-start="0" data-duration="${num(total)}">
${html.join("\n")}
</div>
<script>${fit}
const tl = gsap.timeline({ paused: true });
${js.join("\n")}
window.__timelines = window.__timelines || {};
window.__timelines["root"] = tl;
</script>
</body>
</html>
`;
  return { html: doc, files: book.files, fps, duration: total };
}
