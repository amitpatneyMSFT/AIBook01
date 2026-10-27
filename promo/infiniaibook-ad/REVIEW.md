# REVIEW: InfiniAIBook advertisement (83 s, 1920x1080, 30 fps)

## Creative calls
- Built storyline A ("Click the citation") autonomously because the request asked for the finished film. Not built: B (a day with a pile of PDFs: needs drawn UI) and C (type on a beat grid: no music to cut to). See `STORYLINES.md`.
- 83 s is long for an ad. It is the length it takes to show every README feature once; the cut candidates, in order, are scene 5 (talk, type only), scene 11 (explorer / models / exports / local data) and scene 7 (infographic roller).
- Real material only: screenshots from `docs/screenshots/`, the three sample MP4s from the README (downloaded from the repository's attachments), the brand icon. Features with no screenshot (live discussions, screen helper, structure explorer, models, exports, local data) are type using the README's wording; nothing is drawn as UI.
- Yellow is the accent on grounds (scene 5, scene 11 beat 4) and for the citation highlight; it failed contrast as text on indigo, so highlighted words on indigo are white.

## Measured
- `npx hyperframes check`: 0 errors. 3 lint warnings (`nested_media_start_basis_ambiguous`): the video `data-start` values are scene-local on purpose. 4 layout infos (intentional bleed / off-canvas entrances).
- Snapshots of all 12 scenes and the seams were looked at; the first frame, the citation click, every video's first frame and the end card were checked.
- Rendered file: H.264 1080p30 + AAC, 83.0 s. `hyperframes audio`: sound only where the three sample videos play (44.7-49.8 s, 52.2-57.3 s, 59.7-64.4 s), -17 LUFS integrated, true peak -2.2 dB, no clipping.
- Frames from the render at those times confirm the videos advance (not frozen) despite the sources' sparse keyframes warning.

## Not checked
- The sound was measured, not heard. There is no music or effects bed: no music source was available (no HeyGen sign-in, no local model). Add a track with `/media-use`, keep it under the narration (about 0.14 volume), and end it on a bar line under the end card.
- The phone-width sheet and a second pass with a fresh reviewer were not run.

## Weakest shots
- Screenshots are 1.0x captures shown at 1.2-1.9x (notes panel at 1.9x), so they are soft. Re-capturing at a device scale factor of 2 would fix scenes 1, 3 and 4.
- Scene 5 (talk) and scene 11 (type) have no product pictures; a recorded clip of a live discussion and of the screen helper would replace them.
- Scene 11's beats hold about 2 s each; the explorer and providers lines are glanced at, not read.

## Warnings kept on purpose
- `container_overflow` on the scene 3 camera, the scene 6 entering window and the scene 9 cursor: they are deliberate (a pan, an off-canvas entrance, a cursor arriving from off-screen).
- The impeccable design hook reports fonts, colours and sizes outside `DESIGN.md`. That file describes the app's UI; the film's palette (indigo, white, yellow, ink) and Inter display sizes are deliberate and live in `SPEC.md`.
