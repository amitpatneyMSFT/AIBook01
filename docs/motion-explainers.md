# Motion explainers

The 🎞️ button turns your sources into a short 2D animated explainer.
Characters and objects slide and pop into simple scenes, headlines animate on
word by word, stat cards count up, and scenes change with wipes and slides. A
narrator tells the story over it, and an optional music bed plays underneath.

By default it is a seven-scene, flat-vector video at 720p with a friendly
narrator. Everything about that can be changed under **Options ▸** → **Customize** on the card:
see [Customizing a video](#customizing-a-video).

The **focus box** at the top of the Studio panel steers it, like every other
generator.

## Sample

[![A cartoon gardener in overalls stands among rows of raised beds under the headline "Meet Riverside Garden", with a "24 raised beds" stat card and callout chips](screenshots/motion-explainer.jpg)](https://github.com/user-attachments/assets/9df785be-160a-4b0b-879d-531a4749b538)

*Click the image to play the 1:50 sample, shown here at 720p.* It was generated
from the fictional community-garden notebook used throughout these docs, with
every setting left at its default, and the seven-scene plan was rendered
unedited. It took about nine minutes: almost eight drawing 14 pictures, a few
seconds of narration and under a minute of rendering.

## What you need

| Piece | Setting | Used for |
|---|---|---|
| Studio script model | `AI_STUDIO_MODEL`, else the chat model (`AZURE_OPENAI_DEPLOYMENT` / `AI_MODEL`) | Writing the scene plan: story, on-screen text, narration, palette and character |
| Image model | `AZURE_OPENAI_IMAGE_DEPLOYMENT` or `AI_IMAGE_MODEL` | Drawing every background, the character and each prop |
| Azure Speech | `AZURE_SPEECH_REGION` + `AZURE_SPEECH_RESOURCE_ID` (Entra) or `AZURE_SPEECH_KEY` | The narrator's voice (`en-Multitalker:DragonHDLatestNeural`) |
| Embeddings (optional) | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` / `AI_EMBEDDING_MODEL` | Finding the passages that match the focus box |
| Python 3 | `PYTHON_BIN` (default `python`), plus `numpy`, `Pillow`, `imageio-ffmpeg` | Animating and encoding the MP4 |
| Music (optional) | Upload in the app, or `MOTION_MUSIC_DIR` | A background track under the narration |

No AI model animates anything. The motion, text and transitions come from the
renderer, `scripts/motion/render.py`, which plays back a timeline computed in
TypeScript. See [Models and what they're used for](configuration.md#models-and-what-theyre-used-for)
for every model setting in the app.

## The story

Each video follows the arc used by product and explainer videos:

| Beat | What it covers |
|---|---|
| Problem | The pain or question the sources address, made concrete |
| Solution | What the sources propose |
| How (×1, ×3 or ×5, by length) | One mechanism or step each, in order |
| Benefits | The payoff, with a number from the sources if there is one |
| Next step | The one thing a viewer should do next, shown on a closing card |

Every claim is grounded in the excerpts. The planner is told never to invent a
number, a URL, a price or an offer. A stat card only appears when the value
contains a digit, and the closing card recaps a next step taken from the
sources, or the closing message you supply. Scene prompts are barred from
naming real brands, logos or people.

## Customizing a video

Open **Options ▸** → **Customize** on the Motion explainer card. Every control is optional. The
header lists whatever differs from the defaults, and **Reset** puts them all
back.

| Control | Choices | Default | What it changes |
|---|---|---|---|
| **Length** | Short (5 scenes, about 1 min) · Standard (7, about 1.5–2 min) · Long (9, about 2.5 min) | Standard | How many "how" scenes the story gets, and so the running time, picture count and build time |
| **Tone** | Friendly · Professional · Energetic · Calm · Playful | Friendly | How the narration and headlines are written |
| **Audience** | General · Beginners · Executives · Technical | General | Depth and framing: beginners get defined terms and an analogy, executives get outcomes and risks, technical viewers get mechanisms and trade-offs |
| **Look** | Flat vector · Isometric · Paper cutout · Hand-drawn · Soft 3D clay · Minimal line art | Flat vector | The illustration style sent with every picture, so backgrounds, character and props match |
| **Colors** | Auto · Ocean · Sunset · Forest · Berry · Corporate · Monochrome · Custom | Auto | The five-color palette used by the pictures, text panels, chips, stat cards and closing card. Auto lets the planner pick colors to suit the subject; Custom shows five color pickers (text, primary, accent, highlight, background) |
| **Character** | Designed to suit the subject · Describe my own · No character | Designed | The recurring character. Describe your own (for example "a nurse in blue scrubs with a stethoscope") to fix its look, or choose none for a video told with objects and settings only |
| **Closing** | Free text, up to 160 characters | none | The call to action on the closing card and in the last line of narration. It is used as written, so it may include a link or contact detail that is not in the sources |
| **Quality** | 720p · 1080p | 720p | Output resolution. Every layer scales, so the layout is the same; 1080p takes longer to render and makes a larger file. Pictures are drawn at the image model's own sizes either way |
| **Motion** | Gentle float · Lively · Still | Gentle float | How characters and props move once they have arrived. Gentle float is a slow drift; Lively adds the small bounces the planner picks for some of them; Still keeps them in place. It can also be changed in the script editor before rendering again |

The **Voice** picker, **Music** picker and **Instructions** panel sit above
Customize, and the **focus box** at the top of the panel still decides what the
video is about. Generating writes the scene plan and opens it for review; the
artwork, narration and animation start when you press **Render video**. See
[Spoken formats](studio.md#spoken-formats-script-review-instructions-and-music).

Each finished video records the options it was made with, and the player lists
any that differ from the defaults under the video.

Through the API, send the same choices to `POST /api/motion` (see
[API](API.md#studio)):

```json
{
  "notebookId": "...",
  "topic": "watering rota",
  "voice": "Andrew",
  "length": "short",
  "tone": "energetic",
  "audience": "beginners",
  "visual": "papercut",
  "palette": "forest",
  "character": "none",
  "closing": "Sign up at the garden shed on Saturday",
  "resolution": "1080p"
}
```

`palette` also accepts `"custom"` with a `customPalette` object, or a palette
object directly: `{ "dark", "primary", "accent", "pop", "light" }`, each
`#RRGGBB`. `character` also accepts `"custom"` with `characterDescription`, or
a description directly. Unknown values fall back to the default.

## How it is built

```
sources ─► scene planner ─► pictures ─► narration ─► timeline ─► renderer ─► MP4
```

While it builds, the card lists each stage with a bar. Pictures and narration
count scenes done; the animating stage shows the percent of the video rendered,
which both renderers report as they go.

1. **Plan** (`src/lib/motion.ts`). One JSON call to the studio script model
   writes the scenes, a palette and a description of the recurring character,
   following the chosen length, tone, audience and closing message. The
   normalizer clamps lengths, whitelists every enum, spreads actors across the
   left, center and right slots, applies any palette or character you pinned,
   and caps the pictures: at most two actors per scene and eight props per
   video.
2. **Pictures** (`src/lib/motionbuild.ts`). The image model draws a background
   plate for each scene, the character **once** (reused in every scene it
   appears in, which keeps it consistent) and each prop. Characters and
   props are requested with a transparent background. Every prompt starts with
   the same style description (the chosen **Look**) and palette, so the pieces
   look like one film. A picture that fails is dropped and the video goes on
   without it. A configuration or permission error stops the build.
3. **Narration**. Each scene is voiced by Azure Speech. The clip lengths set
   the scene lengths.
4. **Timeline** (`src/lib/motiontimeline.ts`). A pure function turns the plan
   and clip lengths into the exact render config: when each scene starts,
   where each layer sits, and when each word, chip and character arrives. All
   timing lives here so it can be unit-tested.
5. **Render** (`scripts/motion/render.py`). Plays the config back: a slow
   push-in on each background, eased entrances followed by a gentle float or
   bob, kinetic type, transitions, a closing card and a fade out. Frames are
   piped to FFmpeg, then narration is placed on the soundtrack, the music (if
   any) is ducked under the voice, and the mix is normalized to −16 LUFS.
   Set `MOTION_RENDERER=hyperframes` to render with HyperFrames instead; see
   [The HyperFrames renderer](#the-hyperframes-renderer).

**The image model never draws text.** Headlines, sublines, chips, stats and the
closing card are set by the renderer in a real font, because image models
misspell lettering.

**Opaque cutouts still work.** If a model or endpoint ignores the transparency
request, the renderer keys out the background from the border inward. A white
area inside the object, like a phone screen, is kept.

## Setup

It uses the same pieces as [whiteboard videos](whiteboard-videos.md), listed
under [What you need](#what-you-need). Install the renderer's Python packages:

```bash
python -m pip install numpy pillow imageio-ffmpeg
```

Set `PYTHON_BIN` if `python` is not the interpreter you want. To check the
renderer without spending any model calls:

```bash
npm run check:motion              # 1280x720
npm run check:motion -- --1080p   # 1920x1080
npm run check:motion -- --hyperframes   # with the HyperFrames renderer
```

That renders a 13-second video from synthetic shapes and tones into
`.data/motion-check/`. It covers every layer type, every transition, the
key-out and music ducking.

### The HyperFrames renderer

Set `MOTION_RENDERER=hyperframes` to render with
[HyperFrames](https://github.com/heygen-com/hyperframes) instead of
`render.py`. The plan, narration and timeline are the same; only the render
step differs. `src/lib/motionhyperframes.ts` turns the config into one HTML
composition (a scene per section, with every layer animated by GSAP), and
`src/lib/hyperframes.ts` renders it in headless Chrome at the config's frame
rate. Before that, `scripts/motion/hf_assist.py` keys out and trims each
character picture with the same code `render.py` uses; afterward it lays the
narration and music (ducked, normalized to −16 LUFS) under the silent render,
also with `render.py`'s code, so the sound is identical. Text is real browser
text, so it is crisp, and set in the system's sans-serif font (Segoe UI where
the browser finds it).

It needs `ffmpeg` on `PATH`, Chrome (which HyperFrames downloads on first use)
and network access for `npx` to fetch the pinned release the first time. Set
`HYPERFRAMES_BIN`, `HYPERFRAMES_WORKERS` and `HYPERFRAMES_TIMEOUT_MIN` as for
[training videos](training-videos.md#the-hyperframes-compositor). If
HyperFrames cannot render, the video is made with `render.py` and its note says
so.

## Music

Music is off by default. Pick a track (or *Random track*) and a volume in the
**Music** picker on the card or in the script editor. Tracks come from the
in-app music library, where **＋** uploads one, and from the folder
`MOTION_MUSIC_DIR` names, if set; see
[Background music](studio.md#background-music). The track loops if needed,
fades in and out and is ducked under the narration. No music ships with the
app. Royalty-free doesn't always mean free to redistribute, so check each
track's license before you publish a video.

## Watermark

The **Mark** picker on the card or in the script editor adds an optional text
or image watermark in one of nine positions, with a size and opacity. It is
stamped onto the MP4 after the music is mixed; see
[Watermark](studio.md#watermark).

## Timings, measured

A seven-scene video about a one-page source took **12 minutes** end to end:
50 seconds to plan, 10.7 minutes for 14 pictures (six backgrounds, the hero and
seven props, about 45 seconds each), 20 seconds of narration and 50 seconds of
rendering. That produced a 99-second, 9.2 MB file at 1280×720, normalized to
−16 LUFS.

Pictures dominate, and they are drawn **one at a time**, for the same reason as
whiteboard videos: concurrent calls collide on a small image deployment's
per-minute limit. The prop cap (eight per video) bounds the worst case.
A **Short** video draws about ten pictures and a **Long** one up to eighteen, so
at the same pace expect roughly 8 and 16 minutes; choosing **No character**
saves one picture. **1080p** about doubles rendering time (7.4 s against 15.0 s
for the 12.6-second `check:motion` video), which adds roughly a minute to a
seven-scene video.

The build runs in the background, like the other videos. The artifact is saved
as soon as the plan exists, and the player shows each stage's progress.
