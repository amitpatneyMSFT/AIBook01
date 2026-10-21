# Training videos

The 🧑‍🏫 **Training video** card turns a notebook's research into a short
training session delivered by a realistic, lip-synced presenter. It works in
two steps, so nothing is billed for video until you are happy with the script.

1. **Write transcript.** The selected sources, every note in the notebook
   (including chat answers you saved as notes) and the focus box are combined
   into a trainer's script: a welcome and learning objectives, a handful of
   teaching sections, a recap, and a spoken knowledge check. The script is saved
   as a `training` artifact and opens in an editor.
2. **Render video.** Edit the title, sections and presenter, then press
   **Render video**. The script is sent to Azure's text-to-speech avatar batch
   service. The finished file is saved locally and plays in the artifact;
   **MP4** in the header downloads it.

The card's **Style** (under **Options ▸**) picks one of two kinds of video:

- **Presenter with slides and visuals** (the default). Title cards, bullet
  points, key numbers, quotes, knowledge checks, AI pictures, screenshots and
  the notebook's infographics slide in beside or behind the presenter, each at
  the moment the presenter says the words it illustrates. See
  [Presenter with visuals](#presenter-with-visuals).
- **Presenter only.** The presenter speaking on a solid brand background, with
  subtitles burned in. This is what every training video made before visuals
  existed renders as.

Editing is locked while a render runs. If you change the script afterwards, the
editor says the video is out of date and offers **Render again**.

The card and the editor also have a **Music** picker and an **Instructions**
panel. Music is mixed into the MP4 after the video is finished, lowered whenever
the presenter speaks. The replacement list is applied to the transcript each
time it is sent for rendering. See
[Spoken formats](studio.md#spoken-formats-script-review-instructions-and-music).
The **Mark** picker stamps an optional text or image watermark in one of nine
positions after the music is mixed; see [Watermark](studio.md#watermark).

## Presenter with visuals

A composed training video starts with the avatar and lays visuals over and
around it on one timeline:

- **Visuals tied to words, not times.** Each visual is pinned to a phrase of
  its section's script, such as "it uses about 40 percent less water". It
  appears as the presenter starts saying that phrase. Bullet points are revealed
  one by one as each is spoken, and a knowledge check reveals its answer when
  the presenter starts giving it. Because visuals follow words, editing the rest
  of the script never knocks them out of sync. A visual whose words no longer
  appear is flagged, and is placed by its order until you fix it.
- **Planned with the transcript.** The studio model plans the visuals right after
  writing the transcript. It copies its anchors word for word from the script,
  and anything whose words are not in the script is dropped. **Plan all visuals
  again** and **Plan this section** on the **Visuals** tab plan them again
  after you edit the script.
- **Layouts.** Each visual chooses where the presenter stands: presenter left
  with the visual right, presenter right with the visual left, the visual full
  frame with the presenter in a corner, or the visual alone while the voice
  continues. The presenter glides between layouts. A **Back to presenter** cue
  returns to the presenter alone.
- **Kinds of visual.** Title card, learning objectives, bullet points, key
  number, quote, knowledge check, AI image (drawn on demand by the image model),
  screenshot or picture (upload, paste or capture a screen), and any of the
  notebook's infographics.
- **A picture on every slide.** Title cards, objectives, bullet points, key
  numbers, quotes and knowledge checks show a picture of the idea beside their
  words: above them on the side panel, beside them on a wide one. When the idea
  concerns a Microsoft product, the planner writes a Microsoft Learn search and
  a real screenshot is taken from the matching Learn article, credited
  "Microsoft Learn" on the slide. Otherwise, or when Learn has nothing
  suitable, the image model draws an illustration from the planner's
  description. Pictures are found while the visuals are planned, as time
  allows; **Add pictures to N visuals** on the **Visuals** and **Preview** tabs
  fills the rest, and rendering does too. Each visual's editor can search Learn
  again (**Find another**), draw, upload or remove its picture. A slide whose
  search and drawing both fail shows its words alone.
- **Capitalization.** On-screen text is shown as an edited slide would be:
  sentence case, with product names and acronyms written the way the script
  writes them ("Copilot Studio", "AI"), even when the planner copied the words
  in lowercase from mid-sentence. Text is only ever capitalized, never lowered.
- **Transitions.** Cut, fade, slide in, wipe or zoom, plus a slow push-in on
  pictures.
- **Design.** The **Design** tab sets the theme colors, the default layout and
  transition, the corner for the small presenter, opening and closing cards, a
  title card between sections, an on-screen name for the presenter, a logo, the
  resolution (720p or 1080p) and captions: burned in, a separate WebVTT file,
  or none.

### Editing and previewing

The editor has four tabs:

| Tab | What it does |
|---|---|
| **Script** | The transcript, presenter, voice, background, music and instructions |
| **Visuals** | Each section's script, with visual anchors highlighted. Select words, then **Add visual at selected words** to place a new one there. Expand a visual to change its kind, layout, transition, words, timing nudge and content |
| **Design** | The video-level look described above |
| **Preview** | Plays the composed video in the browser from the same timeline the renderer uses. Markers on the strip below the player show every visual; clicking one opens it for editing |

The preview costs nothing. It times the speech by synthesizing each sentence
with the presenter's own standard neural voice through the ordinary speech
endpoint, which costs a fraction of a cent per video and is cached. It plays
that voice under the visuals. Until the presenter has been rendered, the spot
where they will stand shows one of the section's pictures, labeled "Presenter
appears here once rendered". Once the presenter has been rendered, the preview
plays the real transparent presenter clips instead. Without Azure Speech
configured, timing is estimated from the word count and the preview is silent.

### How it renders

1. **Visuals are drawn in the browser.** Visuals still without their picture
   get one first: a Microsoft Learn screenshot, or a generated illustration.
   Then every visual, and every build step of
   bullets and knowledge checks, is drawn as a PNG at its exact size by the same
   components the preview shows, and uploaded. Only visuals that changed since
   the last render are drawn again.
2. **The presenter is rendered per section.** Each section is a separate Azure
   avatar job, rendered as a transparent WebM (VP9 with alpha) without
   subtitles. Up to `AZURE_AVATAR_CONCURRENCY` jobs run at once. Clips are
   cached by presenter, voice and words, so a section whose words did not change
   is never rendered or billed again. Changing only visuals, design or music
   shows **Recompose video**, which costs no avatar time.
3. **Timing.** Each section starts when its clip starts, and the measured
   sentence timings are scaled to the clip's real length. Anchors land within a
   few tenths of a second of the spoken words.
4. **Compositing.** `scripts/training/render.py` decodes the clips with their
   alpha channel and composes them over the visuals, with transitions, cards,
   captions and the logo. It mixes the clips' audio, normalizes loudness to
   −16 LUFS, then mixes in any music. A title card between sections hides the
   cut between clips. If a clip ever arrives without transparency, its flat
   background is keyed out.

Compositing takes roughly a minute of computer time per minute of 720p video,
and longer at 1080p. It needs Python with `numpy`, `Pillow` and
`imageio-ffmpeg`, the same as whiteboard and motion videos. Run
`npm run check:training` to compose a short synthetic video and confirm the
setup works. It needs no Azure or model access.

## Sample

[![A presenter on a slate background, with the subtitle "If you build or manage agents in Copilot Studio, the pace of change is fast"](screenshots/training-video.jpg)](https://github.com/user-attachments/assets/7651fdca-42dd-45e4-8e56-f56f07c3b6d9)

*Click the image to play the 3:37 sample, shown here at 720p.* It was generated from a notebook of
two public "What's new in Copilot Studio" pages, using the Short length and Lisa
(casual) with the Ava voice.

![Finished training video playing above the editable transcript, with presenter settings and a Render again button](screenshots/training-editor.png)

## Measured

The sample above is a real run:

| Step | Result |
|---|---|
| Write transcript | 32 s with `gpt-5-mini`, 5 sections, 557 words |
| Render | about 4.5 minutes from submission to a saved MP4 |
| Output | 3:37 at 1920x1080, H.264, 217 s of avatar time billed |

Videos are requested at 2 Mbps, about 15 MB per minute. That is ample for a
presenter on a flat background.

## Why the text-to-speech avatar, not a generative video model

Foundry offers two ways to produce a person on video:

| | Sora 2 (Azure OpenAI) | Text-to-speech avatar (Azure Speech) |
|---|---|---|
| Clip length | 4–12 seconds per generation | Up to 20 minutes per job |
| Same presenter throughout | No — each clip is a new person | Yes |
| Lip-sync to a script | No | Yes, driven by the neural voice |
| Approximate price | ~$0.10 per second (~$6 per minute) | Roughly $0.50–$2 per minute |
| Entra ID auth | Yes | Yes |

A training video is minutes of one person talking, so it needs a stable,
lip-synced presenter for its whole length. Sora is the better creative model,
but it cannot hold a presenter across clips and costs several times as much.
The avatar service is the best fit for this job at a fraction of the price.

## Setup

Training videos reuse the Azure Speech configuration from
[Audio overviews](audio-overviews.md). Additionally:

- The Speech (or AI Services) resource must be in an **avatar region**:
  East US 2, West US 2, South Central US, West Europe, North Europe,
  Sweden Central or Southeast Asia.
- Your identity needs **Cognitive Services Speech User** on that resource. It
  includes the `BatchAvatar/*` data actions. Subscription *Owner* or
  *Contributor* does not grant them, so an Owner still gets a 403.

  ```bash
  az role assignment create --assignee <your-object-id> \
    --role "Cognitive Services Speech User" --scope <AZURE_SPEECH_RESOURCE_ID>
  ```

- Entra auth calls the resource's custom-domain endpoint,
  `https://<account>.cognitiveservices.azure.com`, derived from
  `AZURE_SPEECH_RESOURCE_ID`. Set `AZURE_SPEECH_ENDPOINT` if yours differs.
  With `AZURE_SPEECH_KEY` the regional endpoint is used instead.

Optional settings:

| Variable | Effect |
|---|---|
| `AZURE_AVATAR_BACKGROUND_URL` | A public image shown behind the presenter instead of the chosen color (presenter-only videos) |
| `AZURE_AVATAR_PRICE_PER_MINUTE` | Shows an estimated cost in the editor before rendering |
| `AZURE_AVATAR_CONCURRENCY` | Section clips of a composed video rendered at once (default 2, at most 8) |
| `TRAINING_IMAGES` | Set to `off` to stop the visual planner proposing AI images and drawing illustrations for slides. Microsoft Learn screenshots are still found |

## Presenters and voices

Every standard full-body avatar Microsoft lists is offered: Lisa, Lori, Meg, Harry
and Max in all their styles, plus Rowan, Celine, Nia and Malik. Each has a default
neural voice. The voice picker lists the en-US voices from the Speech `voices/list`
API (cached for 24 hours; a built-in list is used if the service is unreachable),
including HD and preview MAI voices. Voices with speaking styles offer a style
menu, and a Sample button plays a short clip of the chosen voice and style. Styles
that measurably do nothing are hidden. The 34 talking-head (photo) avatars are
offered too: 30 run on Microsoft's VASA-1 model and four (Leonie, Leonie
Professional, George and Marcel) on the newer VASA-2. VASA-2 is in preview, is
limited to West US 2, Central India, Southeast Asia and Sweden Central, and
Microsoft's docs say batch synthesis does not support it yet, so those renders
may be rejected until the service enables it. Jeff is left out because Microsoft
retires him in December 2026.

## Limits and behavior

- **Length.** Short, medium and long target about 3, 6 and 10 minutes. The
  service accepts up to 20 minutes, and the editor blocks rendering when the
  word count would exceed that.
- **Rendering time.** Azure renders in the cloud. The measured sample took
  about 1.25 minutes of wall-clock time per minute of video. Progress is
  stored on the artifact, so you can close it and carry on, and watching
  resumes after a server restart.
- **Rate limit.** On the S0 tier the service accepts about two new render jobs
  a minute. Starting more at once returns a "retry after N seconds" message.
  Composed videos submit one job per section, so keep `AZURE_AVATAR_CONCURRENCY`
  low on S0.
- **Rendering time for composed videos.** Transparent VP9 clips render more
  slowly in Azure than the H.264 presenter-only video, and compositing adds
  local time on top.
- **Cleanup.** Once a video or clip is downloaded, its Azure job is deleted.
  Deleting the artifact or its notebook deletes the local files too: the MP4,
  the cached presenter clips, the drawn visuals, captions and its pictures.
  After each composed render, clips and drawings the script no longer uses are
  removed.
- **Billing.** The finished artifact records the avatar seconds Azure billed.
