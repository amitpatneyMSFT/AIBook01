/**
 * Turns a compiled training timeline (src/lib/trainingtimeline.ts) into a
 * HyperFrames project: one HTML composition whose GSAP timeline replays what
 * scripts/training/render.py would draw, so either renderer shows the same
 * video from the same timeline.
 *
 * Pure: it returns the HTML and the list of files the HTML refers to. Copying
 * them next to it and running the renderer is src/lib/hyperframes.ts.
 */
import type { AvatarKeyframe, AvatarPose, Rect, TrainingTimeline } from "./trainingtimeline";

export type HyperframesOptions = {
  background: string;
  /** Where each section's transparent presenter clip is stored. */
  clip: (section: number) => string;
  /** Where the browser saved a visual's drawing. */
  raster: (key: string, state: number) => string;
  burnCaptions: boolean;
  logo?: string | null;
  fps?: number;
};

export type HyperframesProject = {
  html: string;
  /** Files the HTML refers to: `name` is relative to the project, `from` is where it is now. */
  files: { name: string; from: string }[];
  fps: number;
  duration: number;
};

/** The animation library the runner copies into every project. */
export const GSAP_FILE = "assets/gsap.min.js";
/** HyperFrames renders at 24, 30 or 60 frames per second. */
export const HYPERFRAMES_FPS = 30;

const num = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DEFAULT_BACKGROUND = "#1F2A37";

function rgb(hex: string): [number, number, number] {
  const h = (/^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BACKGROUND).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** The stage render.py draws: the color lit from the top, darker at the foot and the sides. */
function stageCss(hex: string): string {
  const [r, g, b] = rgb(hex);
  const at = (k: number, add: number) =>
    `rgb(${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c * k + add)))).join(",")})`;
  return (
    "background:linear-gradient(90deg,rgba(0,0,0,.06),rgba(0,0,0,0) 30%,rgba(0,0,0,0) 70%,rgba(0,0,0,.06))," +
    `linear-gradient(180deg,${at(1.12, 6)},${at(0.82, 0)})`
  );
}

const poseVars = (p: AvatarPose, W: number, H: number) =>
  `{x:${num((p.cx - 0.5) * W)},y:${num((p.cy - 0.5) * H)},scale:${num(p.scale)},opacity:${num(p.opacity)}}`;

const samePose = (a: AvatarPose, b: AvatarPose) =>
  a.cx === b.cx && a.cy === b.cy && a.scale === b.scale && a.opacity === b.opacity;

export function buildHyperframesProject(tl: TrainingTimeline, opts: HyperframesOptions): HyperframesProject {
  const { width: W, height: H } = tl;
  const fps = opts.fps ?? HYPERFRAMES_FPS;
  const total = tl.duration;
  const scale = W / 1280;
  const files: HyperframesProject["files"] = [];
  const names = new Map<string, string>();
  const asset = (from: string, name: string) => {
    const known = names.get(from);
    if (known) return known;
    const rel = `assets/${name}`;
    names.set(from, rel);
    files.push({ name: rel, from });
    return rel;
  };
  const picture = (key: string, state: number) => asset(opts.raster(key, state), `r-${key}-${state}.png`);
  const px = (r: Rect) =>
    `left:${Math.round(r.x * W)}px;top:${Math.round(r.y * H)}px;` +
    `width:${Math.max(1, Math.round(r.w * W))}px;height:${Math.max(1, Math.round(r.h * H))}px`;
  const timed = (start: number, duration: number) =>
    `data-start="${num(start)}" data-duration="${num(Math.max(0.05, duration))}"`;

  const html: string[] = [];
  const js: string[] = [];
  const t = tl.timing;

  html.push(`<div id="stage" style="${stageCss(opts.background)}"></div>`);

  // Visuals sit beneath the presenter, in the panel the layout leaves for them.
  tl.cues.forEach((q, n) => {
    if (!q.rasterKey || !q.panel) return;
    const id = `c${n}`;
    const full = q.panel.w >= 1 && q.panel.h >= 1;
    const start = q.start;
    const hold = Math.max(0.1, q.end - q.start);
    const style = [
      px(q.panel),
      full ? "" : `border-radius:${num(18 * scale)}px;box-shadow:0 ${num(18 * scale)}px ${num(40 * scale)}px rgba(0,0,0,.35)`,
    ]
      .filter(Boolean)
      .join(";");
    const imgs = q.states.map((at, k) => {
      const src = picture(q.rasterKey!, k);
      // Later build steps fade in over the earlier ones; one that arrives with the panel is simply on top.
      const hidden = k > 0 && at > start + 0.001;
      return `<img id="${id}s${k}" src="${src}" alt=""${hidden ? ' style="opacity:0"' : ""}>`;
    });
    const inner = q.kenBurns
      ? `<div id="${id}p" class="pic" style="overflow:hidden">${imgs.join("")}</div>`
      : `<div id="${id}p" class="pic">${imgs.join("")}</div>`;
    html.push(
      `<div id="${id}" class="cue" ${timed(start, q.end - q.start + t.cueOut)} style="${style}">${inner}</div>`
    );

    // render.py's arrival: out-cubic over cueIn, per transition.
    if (t.cueIn > 0 && q.transition !== "cut") {
      const enter =
        q.transition === "slide"
          ? { from: `{opacity:0,x:${num(0.08 * W)}}`, to: `{opacity:1,x:0}` }
          : q.transition === "zoom"
            ? { from: `{opacity:0,scale:.9}`, to: `{opacity:1,scale:1}` }
            : q.transition === "wipe"
              ? { from: `{clipPath:"inset(0 100% 0 0)"}`, to: `{clipPath:"inset(0 0% 0 0)"}` }
              : { from: `{opacity:0}`, to: `{opacity:1}` };
      const to = enter.to.slice(0, -1) + `,duration:${t.cueIn},ease:"power3.out"}`;
      js.push(`tl.fromTo("#${id}",${enter.from},${to},${num(start)});`);
    }
    if (t.cueOut > 0) {
      js.push(`tl.to("#${id}",{opacity:0,duration:${t.cueOut},ease:"none"},${num(q.end)});`);
    }
    if (q.kenBurns) {
      js.push(`tl.fromTo("#${id}p",{scale:1},{scale:1.06,duration:${num(hold)},ease:"none"},${num(start)});`);
    }
    q.states.forEach((at, k) => {
      if (k === 0 || at <= start + 0.001) return;
      js.push(
        t.reveal > 0
          ? `tl.to("#${id}s${k}",{opacity:1,duration:${t.reveal},ease:"none"},${num(at)});`
          : `tl.set("#${id}s${k}",{opacity:1},${num(at)});`
      );
    });
  });

  // The presenter: one wrapper glides between poses while each section's clip plays inside it.
  const videos = tl.sections.map(
    (s) =>
      `<video id="v${s.index}" src="${asset(opts.clip(s.index), `clip-${s.index}.webm`)}" ${timed(s.start, s.duration)} data-track-index="1" playsinline></video>`
  );
  html.push(`<div id="avatar">${videos.join("")}</div>`);
  const frames: AvatarKeyframe[] = tl.avatar;
  if (frames.length) js.push(`tl.set("#avatar",${poseVars(frames[0], W, H)},0);`);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (samePose(a, b)) continue;
    const span = b.t - a.t;
    if (span <= 0) {
      js.push(`tl.set("#avatar",${poseVars(b, W, H)},${num(a.t)});`);
      continue;
    }
    const ease = b.ease === "inOutSine" ? "sine.inOut" : "none";
    js.push(
      `tl.fromTo("#avatar",${poseVars(a, W, H)},{...${poseVars(b, W, H)},duration:${num(span)},ease:"${ease}",immediateRender:false},${num(a.t)});`
    );
  }

  if (tl.lowerThird?.rasterKey) {
    const lt = tl.lowerThird;
    const rect = px(lt.rect);
    html.push(
      `<img id="lower" class="lower" src="${picture(lt.rasterKey, 0)}" alt="" ${timed(lt.start, lt.end - lt.start)} style="${rect}">`
    );
    if (t.lowerIn > 0) {
      js.push(
        `tl.fromTo("#lower",{opacity:0,x:${num(-0.4 * lt.rect.w * W)}},{opacity:1,x:0,duration:${t.lowerIn},ease:"power3.out"},${num(lt.start)});`
      );
    }
    if (t.lowerOut > 0) {
      js.push(`tl.to("#lower",{opacity:0,duration:${t.lowerOut},ease:"none"},${num(lt.end - t.lowerOut)});`);
    }
  }

  if (opts.burnCaptions) {
    tl.captions.forEach((c, i) => {
      html.push(
        `<div id="cap${i}" class="cap" ${timed(c.start, c.end - c.start)}><span>${esc(c.text)}</span></div>`
      );
    });
  }

  // Cards cover everything beneath them and fade at their edges, except at the very ends of the video.
  tl.cards.forEach((k, n) => {
    const id = `card${n}`;
    html.push(
      `<img id="${id}" class="card" src="${picture(k.rasterKey, 0)}" alt="" ${timed(k.start, k.duration)}>`
    );
    if (t.cardFade > 0) {
      if (k.start > 0.01) js.push(`tl.fromTo("#${id}",{opacity:0},{opacity:1,duration:${t.cardFade},ease:"none"},${num(k.start)});`);
      if (k.start + k.duration < total - 0.01) {
        js.push(`tl.to("#${id}",{opacity:0,duration:${t.cardFade},ease:"none"},${num(k.start + k.duration - t.cardFade)});`);
      }
    }
  });

  if (opts.logo) {
    html.push(
      `<img id="logo" src="${asset(opts.logo, `logo${/\.[a-z0-9]{2,5}$/i.exec(opts.logo)?.[0].toLowerCase() ?? ".png"}`)}" alt="" ${timed(0, total)} ` +
        `style="left:${num(W - W * 0.02 - W * 0.14)}px;top:${num(H * 0.03)}px;width:${num(W * 0.14)}px;height:${num(H * 0.07)}px">`
    );
  }

  // The fade up from and down to black.
  if (t.edgeIn > 0 || t.edgeOut > 0) {
    html.push(`<div id="fade"></div>`);
    if (t.edgeIn > 0) js.push(`tl.fromTo("#fade",{opacity:1},{opacity:0,duration:${t.edgeIn},ease:"none"},0);`);
    if (t.edgeOut > 0) {
      js.push(`tl.to("#fade",{opacity:1,duration:${t.edgeOut},ease:"none"},${num(Math.max(0, total - t.edgeOut))});`);
    }
  }
  // Pin the timeline to the video's length.
  js.push(`tl.set("#stage",{opacity:1},${num(total)});`);

  const cap = num(H * 0.036);
  const css = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${DEFAULT_BACKGROUND}; }
#root { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
#stage { position: absolute; inset: 0; z-index: 0; }
.cue { position: absolute; z-index: 10; }
.cue .pic { position: absolute; inset: 0; }
.cue img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
#avatar { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 20; transform-origin: 50% 50%; }
#avatar video { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
.lower { position: absolute; z-index: 30; }
.cap { position: absolute; left: 0; right: 0; bottom: ${num(H * 0.035)}px; display: flex; justify-content: center; z-index: 40; }
.cap span { max-width: ${num(W * 0.78)}px; padding: ${num(cap * 0.35)}px ${num(cap * 0.7)}px; border-radius: ${num(cap * 0.4)}px; background: rgba(12,14,18,.745); color: #fff; text-align: center; font: 600 ${cap}px/1.3 "Segoe UI", Inter, "DejaVu Sans", Arial, sans-serif; }
.card { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 50; }
#logo { position: absolute; z-index: 60; object-fit: contain; object-position: right top; opacity: .85; }
#fade { position: absolute; inset: 0; z-index: 70; background: #000; opacity: 0; }`;

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
<div id="root" data-composition-id="root" data-width="${W}" data-height="${H}" ${timed(0, total)}>
${html.join("\n")}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${js.join("\n")}
window.__timelines = window.__timelines || {};
window.__timelines["root"] = tl;
</script>
</body>
</html>
`;
  return { html: doc, files, fps, duration: total };
}
