import { describe, expect, it } from "vitest";
import { normalizeMotionPlan } from "@/lib/motion";
import { compileTimeline, type ActorLayer, type RenderConfig, type SceneAssets } from "@/lib/motiontimeline";
import { buildMotionHyperframes, idleSegments, statText } from "@/lib/motionhyperframes";
import { GSAP_FILE } from "@/lib/hyperframesproject";
import { motionRenderer } from "@/lib/hyperframes";

const scene = (over: Record<string, unknown> = {}) => ({
  beat: "how",
  headline: "HOW IT WORKS",
  subline: "Scraps go in, clean water comes out.",
  callouts: ["Fast", "Quiet"],
  background: "a bright kitchen",
  actors: [
    { kind: "hero", placement: "left", entrance: "slide-left", idle: "float" },
    { kind: "prop", description: "a steel bin", placement: "right", entrance: "pop", idle: "bob" },
  ],
  narration: "Here's how it works. Scraps go in and water comes out.",
  transition: "wipe",
  ...over,
});

function config(transitions: [string, string] = ["wipe", "slide"], width?: number, height?: number): RenderConfig {
  const plan = normalizeMotionPlan({
    title: "Food waste, fixed",
    description: "How a digester turns scraps into water.",
    style: {},
    scenes: [
      scene({ beat: "problem", headline: "R&D FIRST", stat: { value: "1,200 tons", label: "wasted a year" } }),
      scene({
        transition: transitions[0],
        actors: [
          { kind: "hero", placement: "right", entrance: "rise", idle: "float" },
          { kind: "prop", description: "a steel bin", placement: "left", entrance: "pop", idle: "bob" },
        ],
      }),
      scene({ beat: "cta", callouts: ["Call us"], transition: transitions[1] }),
    ],
  })!;
  const assets: SceneAssets[] = [
    { background: "/w/bg1.png", actors: ["/w/hero.png", "/w/bin.png"], narration: "/w/n1.mp3", narrationSeconds: 6 },
    { background: null, actors: ["/w/hero.png", "/w/bin.png"], narration: "/w/n2.mp3", narrationSeconds: 5 },
    { background: "/w/unused.png", actors: ["/w/hero.png", "/w/bin.png"], narration: null, narrationSeconds: null },
  ];
  return compileTimeline(plan, assets, { output: "out.mp4", width, height });
}

const cutouts: Record<string, { file: string; width: number; height: number }> = {
  "/w/hero.png": { file: "/w/c/cutout-0.png", width: 500, height: 1000 },
  "/w/bin.png": { file: "/w/c/cutout-1.png", width: 400, height: 400 },
};
const opts = { cutout: (src: string) => cutouts[src] };

describe("statText", () => {
  it("counts up the number and keeps the rest of the value", () => {
    expect(statText("1.3B tons", 0)).toBe("0.0B tons");
    expect(statText("$40", 0.5)).toBe("$35");
    expect(statText("1,200 tons", 0.5)).toBe("1,050 tons");
    expect(statText("1.3B tons", 1)).toBe("1.3B tons");
    expect(statText("24/7", 0.3)).toBe("16/7");
    expect(statText("Always on", 0.3)).toBe("Always on");
  });
});

describe("idleSegments", () => {
  const idle = (kind: "float" | "bob") => ({ kind, amp: 8, period: 3.2, phase: 0.9 }) as NonNullable<ActorLayer["idle"]>;

  it("chains eases from the arrival to the end of the scene, starting at rest", () => {
    for (const kind of ["float", "bob"] as const) {
      const segs = idleSegments(idle(kind), 1.2, 6);
      expect(segs.length).toBeGreaterThan(4);
      expect(segs[0].at).toBe(1.2);
      expect(segs[0].from).toBe(0);
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i].at).toBeCloseTo(segs[i - 1].at + segs[i - 1].duration, 2);
        expect(segs[i].from).toBe(segs[i - 1].y);
      }
      const end = segs.at(-1)!;
      expect(end.at + end.duration).toBeCloseTo(6, 2);
      expect(segs.every((s) => s.ease === "sine.in" || s.ease === "sine.out")).toBe(true);
    }
  });

  it("makes a bob a hop (never below the ground) and a float swing both ways", () => {
    const bob = idleSegments(idle("bob"), 1, 8);
    expect(Math.max(...bob.map((s) => s.y))).toBeLessThanOrEqual(0);
    expect(Math.min(...bob.map((s) => s.y))).toBeCloseTo(-8 * 1.6, 1);
    const float = idleSegments(idle("float"), 1, 8);
    expect(Math.max(...float.map((s) => s.y))).toBeGreaterThan(7);
    expect(Math.min(...float.map((s) => s.y))).toBeLessThan(-7);
  });
});

describe("HyperFrames motion project", () => {
  it("is a root composition sized and timed like the config", () => {
    const cfg = config();
    const p = buildMotionHyperframes(cfg, opts);
    expect(p.html).toContain(`data-composition-id="root" data-width="1280" data-height="720" data-start="0" data-duration="${cfg.duration}"`);
    expect(p.html).toContain(`<script src="${GSAP_FILE}">`);
    expect(p.html).toContain('window.__timelines["root"] = tl;');
    expect(p.fps).toBe(24);
    expect(p.duration).toBe(cfg.duration);
  });

  it("holds each scene until the next has finished arriving over it", () => {
    const cfg = config();
    const html = buildMotionHyperframes(cfg, opts).html;
    cfg.scenes.forEach((s, i) => {
      const next = cfg.scenes[i + 1];
      const hold = next ? s.duration + next.transition.duration : cfg.duration - s.start;
      expect(html).toContain(`id="s${i}" class="scene" data-start="${s.start}" data-duration="${Math.round(hold * 1000) / 1000}"`);
    });
  });

  it("maps each transition: fade in from the dark, wipe behind a bar, slide both scenes", () => {
    const html = buildMotionHyperframes(config(), opts).html;
    expect(html).toContain('tl.fromTo("#s0",{opacity:0},{opacity:1,duration:0.5,ease:"sine.inOut"},0);');
    expect(html).toContain('id="w1" class="bar"');
    expect(html).toContain('clipPath:"inset(0px 1336px 0px 0px)"');
    expect(html).toContain('tl.fromTo("#s2",{x:1280},{x:0,');
    expect(html).toContain('tl.fromTo("#s1",{x:0},{x:-1280,');
    const fades = buildMotionHyperframes(config(["fade", "fade"]), opts).html;
    expect(fades).toContain('tl.fromTo("#s1",{opacity:0}');
    expect(fades).not.toContain('class="bar"');
  });

  it("fades the whole video out to the dark color", () => {
    const cfg = config();
    const html = buildMotionHyperframes(cfg, opts).html;
    const from = Math.round((cfg.duration - cfg.fadeOut) * 1000) / 1000;
    expect(html).toContain(`id="out" class="out" data-start="${from}"`);
    expect(html).toContain(`tl.fromTo("#out",{opacity:0},{opacity:1,duration:${cfg.fadeOut},ease:"none"},${from});`);
  });

  it("fits each actor's picture in its box, flips the hero on the right, and lists the files once", () => {
    const cfg = config();
    const p = buildMotionHyperframes(cfg, opts);
    const first = cfg.scenes[0].layers.find((l) => l.type === "actor") as ActorLayer;
    const k = Math.min(first.maxW / 500, first.maxH / 1000);
    expect(p.html).toContain(`width:${Math.round(500 * k)}px;height:${Math.round(1000 * k)}px`);
    expect(p.html).toContain("transform:scaleX(-1)");
    const names = p.files.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    expect(p.files.find((f) => f.from === "/w/bg1.png")?.name).toBe("assets/bg-0.png");
    // Each cutout is listed once however many scenes use it.
    expect(names.filter((n) => /^assets\/l\d+x\d+\.png$/.test(n))).toHaveLength(2);
    for (const ref of p.html.matchAll(/src="(assets\/[^"]+)"/g)) {
      if (ref[1] !== GSAP_FILE) expect(names).toContain(ref[1]);
    }
  });

  it("drops an actor whose picture could not be prepared", () => {
    const p = buildMotionHyperframes(config(), { cutout: (src) => (src.includes("bin") ? undefined : cutouts[src]) });
    expect(p.html.match(/class="actor"/g)).toHaveLength(3);
  });

  it("puts a light disc behind the closing scene's characters instead of a shadow", () => {
    const html = buildMotionHyperframes(config(), opts).html;
    expect(html).toContain('class="disc"');
    expect(html.match(/class="shadow"/g)).toHaveLength(4);
  });

  it("escapes text and reveals the headline word by word on a panel that grows in", () => {
    const html = buildMotionHyperframes(config(), opts).html;
    expect(html).toContain("R&amp;D");
    expect(html).not.toContain("R&D");
    expect(html).toMatch(/tl\.fromTo\("#l0x\d+b",\{opacity:0,scaleX:0\.6\}/);
    expect(html).toMatch(/tl\.fromTo\("#l0x\d+w0",\{opacity:0\},\{opacity:1,duration:0\.35,ease:"none"\}/);
    expect(html).toMatch(/tl\.fromTo\("#l0x\d+w0",\{y:/);
  });

  it("counts the stat up in 31 steps once its card has arrived, and hides it until then", () => {
    const html = buildMotionHyperframes(config(), opts).html;
    const steps = html.match(/textContent:"[^"]*"/g) ?? [];
    expect(steps).toHaveLength(31);
    expect(steps[0]).toBe('textContent:"0 tons"');
    expect(steps.at(-1)).toBe('textContent:"1,200 tons"');
    expect(html).toMatch(/class="statl"[^>]*opacity:0/);
  });

  it("scales to the frame and keeps unsupported frame rates out", () => {
    const hd = buildMotionHyperframes(config(["wipe", "slide"], 1920, 1080), opts);
    expect(hd.html).toContain('data-width="1920" data-height="1080"');
    expect(hd.html).toContain('clipPath:"inset(0px 2004px 0px 0px)"');
    const odd = config();
    expect(buildMotionHyperframes({ ...odd, fps: 25 }, opts).fps).toBe(30);
  });
});

describe("renderer choice", () => {
  it("defaults to the Python renderer", () => {
    const before = process.env.MOTION_RENDERER;
    try {
      delete process.env.MOTION_RENDERER;
      expect(motionRenderer()).toBe("python");
      process.env.MOTION_RENDERER = "HyperFrames";
      expect(motionRenderer()).toBe("hyperframes");
      process.env.MOTION_RENDERER = "other";
      expect(motionRenderer()).toBe("python");
    } finally {
      if (before === undefined) delete process.env.MOTION_RENDERER;
      else process.env.MOTION_RENDERER = before;
    }
  });
});
