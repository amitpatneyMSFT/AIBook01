# SPEC: InfiniAIBook advertisement

GOAL:    The viewer sees every InfiniAIBook feature working on one real notebook and leaves knowing: sources in, cited work out, on your own machine.
OUTPUT:  HyperFrames, 1920x1080, 30 fps. 83 s = 2490 frames. 12 scenes, hosts overlap 15 frames at each seam.

LOOK
- Grounds (flat, no gradient, no texture): lamplight `#6f7dff`, cool white `#f2f5f9`, sun yellow `#ffd23f`, product ink `#0b0d10`. Ink text `#0b0d10`; on ink ground `#f2f5f9`.
- Accent: yellow on indigo / ink grounds, indigo `#5a68ee` on white. One highlighted word per shot.
- Type: Inter 900, -3% tracking, display 72-150 px (roller words 260-300 px); body Inter 700 34-44 px; commands JetBrains Mono 700 40 px.
- Medium: the real product UI (screenshots from docs/, crops at 1.0-1.6x) in 14 px-radius windows, shadow `0 32 64 rgba(11,13,16,.38)`; the three sample videos as real MP4s with their own sound.
- Cursor: 64 px arrow, enters from off-screen, its click causes the next thing on the same frame.

OBJECTS: only real ones: the cited chat answer, the Sources panel, the Studio artifacts, the three sample videos, the brand icon. Features without a screenshot (discussions, screen helper, structure explorer, models, exports, local data) are type with the README's own words; nothing is drawn as UI.

MOTION: arrival `expo.out` / `power4.out` 0.35-0.6 s; camera and floods `power2.inOut` 0.5-0.6 s; exits `power3.in` 0.2-0.3 s. Titles land dead still. Word entrance: blur 8 px -> 0, 0.08 s stagger.
Seams (4 kinds): iris from the clicked point, horizontal / vertical whip with blur, flood wipe, diagonal wipe.

SHOTS (seconds, global)
 1. 0.0-5.5   hook: cited answer, cursor clicks citation 1, the passage lights. Line "Every claim cites its source."
 2. 5.0-11.0  every file type piles up as giant type; the Sources panel fills. "Drop anything in."
 3. 10.5-16.2 iris from the panel: workspace + wordmark; camera pans to the Notes tab; cursor clicks it.
 4. 15.7-23.0 iris from the click: Notes -> Transformations -> Search.
 5. 22.5-28.5 whip: live discussions roller, screen helper (type only).
 6. 28.0-37.5 flood up: "Fourteen formats", nine Studio artifacts at 0.9 s each.
 7. 37.0-42.5 diagonal wipe: 33 infographic styles, 17 real style names cut at 0.2 s.
 8. 42.0-50.0 whip: whiteboard script, cursor clicks Render, iris opens the real video (5 s, own sound).
 9. 49.5-57.5 whip up: motion explainer script, Render, full-bleed real video (5 s, own sound).
10. 57.0-67.0 diagonal: training script, Render, presenter video (4.7 s, own sound), live VASA-2 preview.
11. 66.5-75.9 four floods: structure explorer, any model, exports, local data / undo / password.
12. 75.4-83.0 claim, cursor clicks the mark, ground floods ink, wordmark wipes in, repo and command hold 2.8 s.

BANNED: dark void with small floating elements, glow / bloom / particles, purple-blue gradients, glass cards, cream paper + serif, small mono caps labels, pill chips, three-card rows, a title over a dimmed screenshot, the logo docked in a corner, titles that drift after landing, click rings, fade-and-slide-up on everything, invented UI.

QA: frame 0 (cited answer + title); the citation click (t=2.4); each seam midpoint; each video's first frame; the end card at 77 s and 81 s; phone-width sheet.
