# InfiniAIBook REST API

Everything the UI does goes through these JSON routes under `/api`, so they can
be scripted too. Requests and responses are JSON unless noted.

## Authentication

When `INFINIAIBOOK_PASSWORD` is unset, the API needs no credentials. When it is
set, every route except `/api/auth/*` needs either the session cookie from
`POST /api/auth/login` or a bearer token:

```http
Authorization: Bearer <INFINIAIBOOK_API_TOKEN>
```

Scripts should send `INFINIAIBOOK_API_TOKEN`. The password is not accepted as a
bearer token unless `INFINIAIBOOK_ALLOW_PASSWORD_BEARER=true`.

Unauthenticated API calls get `401 {"error": "..."}`.

Two checks apply whether or not a password is set:

- Requests whose `Host` is not a loopback name or listed in `ALLOWED_HOSTS` get
  `403 {"code": "host"}`. This check always runs without a password, and runs
  with one only when `ALLOWED_HOSTS` is set.
- A POST, PATCH or DELETE a browser sends from another site (a cross-site
  `Sec-Fetch-Site`, or a foreign `Origin`) gets `403 {"code": "csrf"}`. Scripts
  that send neither header are unaffected.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `{ password }` | Sets a signed 30-day HTTP-only cookie. Attempts are serialized; each failure delays the next one longer (up to 30 s) |
| POST | `/api/auth/logout` | — | Clears the cookie |
| GET | `/api/auth/status` | — | `{ auth }`: whether a password is required |

## Notebooks

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/notebooks` | — | All notebooks with counts |
| POST | `/api/notebooks` | `{ title }` | The new notebook |
| GET | `/api/notebooks/{id}` | — | Notebook, `sources`, `artifacts` (summaries), `sessions`, `notes`, and `messages` of the latest session |
| PATCH | `/api/notebooks/{id}` | `{ title?, narration? }` | Rename, or save the notebook's default narration instructions and replacements |
| DELETE | `/api/notebooks/{id}` | — | Deletes it and everything in it |
| GET | `/api/notebooks/{id}/export` | — | Zip of sources, notes, chats, artifacts and finished media |
| POST | `/api/notebooks/import` | multipart `file` | Restores an export as a new notebook. Semantic search stays off until re-embed |
| GET | `/api/budget` | — | `{ enabled, capCents, spentCents, remainingCents }` for today's model ceiling |
| POST/GET | `/api/notebooks/{id}/check-sources` | — | Re-check linked sources for changes |
| POST/GET | `/api/notebooks/{id}/reembed` | — | Re-embed chunks after changing embedding model |

## Sources

`POST /api/notebooks/{id}/sources` accepts one of:

- `multipart/form-data` with one or more `files` (documents, images, audio,
  video — media is transcribed, up to 25 MB — PowerPoint decks, or ZIP
  archives, whose supported files are each added as a source);
- `{ url, title? }` — web page, YouTube link, RSS/Atom feed, or direct media link;
- `{ text, title?, kind?: "note" | "pptx" }` — pasted text (`kind: "note"` marks a
  note turned into a source; `kind: "pptx"` marks text the browser extracted
  from a deck too large to upload);
- `{ copyFrom: "<sourceId>" }` — copy a source from another notebook, with its
  chunks and embeddings.

It returns `{ added: [...], errors: [...], warnings: [...] }`. A request body
larger than `MAX_UPLOAD_BYTES` (default 50 MB) gets
`413 {"code": "too_large"}` before it is read, and a larger file inside a
multipart upload is reported in `errors`. Each source's summary is generated
just after the response, so it appears on the next `GET /api/notebooks/{id}`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/sources?exclude={notebookId}` | Every source with its notebook's id and title — the Library |
| GET | `/api/sources/{id}` | Full text and metadata. `?part=n` also returns `passage`, the text of that cited part |
| POST | `/api/sources/{id}` | `{ action: "apply"\|"dismiss" }` — accept or discard a detected change to a linked source |
| DELETE | `/api/sources/{id}` | |

## Chat and sessions

**`sourceIds`**, here and on the Studio routes below, limits grounding to those
sources. If you omit it, every source in the notebook is used. An empty list
`[]` is refused with `400 {"code": "no_sources"}` rather than treated as "all".

`POST /api/chat` with `{ notebookId, message, sourceIds?, sessionId? }` streams
newline-delimited JSON events:

| Event | Meaning |
|---|---|
| `{"type":"session","session":{...}}` | Always first; the session used (created if `sessionId` was omitted) |
| `{"type":"citations","citations":[...]}` | Retrieved passages the answer may cite as `[n]` |
| `{"type":"notice", ...}` | Non-fatal note, e.g. keyword fallback |
| `{"type":"delta","v":"..."}` | Next piece of answer text |
| `{"type":"done","id":"...","citations":[...],"stopped":false}` | Saved message id and only the citations the answer marked. An answer with no markers saves `[]` and the UI labels it not cited |
| `{"type":"error","error":"..."}` | Failure |

An unknown `sessionId` returns `404`; no configured model returns
`400 {"code":"no_config"}`; a `message` over 20,000 characters returns
`400 {"code":"too_long"}`.

Closing the connection mid-answer (the UI's **Stop** button) aborts the model
request. The text received so far is saved as the answer, ending with
"_(Stopped before the answer was finished.)_".

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/notebooks/{id}/sessions` | — | Sessions, newest first |
| POST | `/api/notebooks/{id}/sessions` | `{ title? }` | New session |
| GET | `/api/sessions/{id}` | — | Session with `messages` |
| PATCH | `/api/sessions/{id}` | `{ title }` | Rename |
| DELETE | `/api/sessions/{id}` | — | Deletes its messages too |

## Notes

| Method | Path | Body |
|---|---|---|
| GET | `/api/notebooks/{id}/notes` | — |
| POST | `/api/notebooks/{id}/notes` | `{ content, title?, kind?: "human"\|"ai", sourceId?, citations? }` |
| GET | `/api/notes/{id}` | — |
| PATCH | `/api/notes/{id}` | `{ title?, content? }` |
| DELETE | `/api/notes/{id}` | — |

To make a note searchable by chat, post its content as a source with
`kind: "note"`.

## Transformations

Built-in transformations have ids beginning `builtin:` (URL-encode the colon)
and cannot be edited or deleted.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/transformations` | — | Built-in and custom |
| POST | `/api/transformations` | `{ name, prompt, description? }` | New custom transformation |
| GET/PATCH/DELETE | `/api/transformations/{id}` | `{ name?, prompt?, description? }` | |
| POST | `/api/transformations/apply` | `{ transformationId, sourceId }` | `201` with the resulting note |

## Search

| Method | Path | Notes |
|---|---|---|
| GET | `/api/search?q=...&mode=text\|vector&notebookId=` | Passage `hits` (with notebook id/title) and matching `notes`; omit `notebookId` to search everything |
| POST | `/api/search/ask` | `{ question, notebookId? }` → grounded `answer` with `citations`; not saved to any session |

## Studio

| Method | Path | Body |
|---|---|---|
| POST | `/api/generate` | `{ notebookId, type, topic?, sourceIds?, style?, theme?, difficulty?, length?, orientation?, detail?, instructions? }` (`theme` applies to `type: "slides"`; `style`, `orientation` (`landscape`/`portrait`/`square`), `detail` (`concise`/`standard`/`detailed`) and `instructions` (free text, up to 600 characters) to `type: "infographic"`). Unknown types and styles, a `topic` over 2,000 characters and malformed `sourceIds` are refused with 400 |
| POST | `/api/infographic/suggest` | `{ notebookId, sourceIds?, topic? }` → `{ suggestions: [{ style, reason }], source: "model" \| "heuristic" }`: up to three infographic styles that suit the sources, best first. Falls back to a model-free guess when the model is unavailable |
| POST | `/api/podcast` | `{ notebookId, topic?, sourceIds?, preset?, speakers?: [{ voice?, name?, role? }] (1–4), rate?, breath?, length?, narration?, music? }` → audio-overview **script** (`stage: "script"`), not yet narrated |
| PATCH | `/api/podcast/{id}` | Edit `title`, `description`, `script: { segments: [{ title, turns: [{ speaker, text }] }] }`, `voices`, `rate`, `music`, `narration`; 409 while narrating |
| POST | `/api/podcast/{id}/narrate` | Synthesize the script (and mix any music); returns the artifact with `audioUrl` and timed `turns` |
| POST | `/api/video` | `{ notebookId, topic?, sourceIds?, voice?, narration?, music?, watermark? }` → whiteboard scene plan (`progress.stage: "script"`) |
| POST | `/api/motion` | `{ notebookId, topic?, sourceIds?, voice?, music?, watermark?, narration?, length?, tone?, audience?, visual?, palette?, customPalette?, character?, characterDescription?, closing?, resolution?, movement? }` → motion scene plan (`progress.stage: "script"`). Customization values are in [Motion explainers](motion-explainers.md#customizing-a-video); unknown values fall back to the defaults |
| PATCH | `/api/video/{id}` | Edit a whiteboard or motion script: `title`, `description`, `scenes`, `voice`, `music`, `watermark`, `narration`, and `movement` for motion; 409 while building |
| POST | `/api/video/{id}/render` | Build the reviewed script; poll `GET /api/artifacts/{id}` for `progress.stage`, play `GET /api/video/{id}` |
| GET | `/api/motion` | `{ music }`: whether any background-music track is available |
| POST | `/api/training` | `{ notebookId, topic?, sourceIds?, presenter?, voice?, background?, length?, narration?, music?, watermark?, composition? }` → training transcript artifact. With `composition.mode: "composed"`, visuals are planned too; without `composition` the video is presenter only |
| PATCH | `/api/training/{id}` | Edit `title`, `description`, `objectives`, `sections` (each with optional `cues`), `presenter`, `voice`, `background`, `music`, `watermark`, `narration`, `composition`; 409 while rendering |
| POST | `/api/training/{id}/render` | Start the render; poll `GET /api/artifacts/{id}` for `progress.stage` (and `progress.clips` for composed videos). Composed videos return 409 until every visual is drawn (`/raster`) |
| POST | `/api/training/{id}/visuals` | `{ section? }` → plan the visuals again for the whole video or one 0-based section |
| GET | `/api/training/{id}/timing` | Per-section speech timing and preview voice tracks (rendered clips, measured speech, or estimates) |
| GET, PUT | `/api/training/{id}/raster` | `GET` → `{ missing: [{ key, state }] }` visuals still to draw; `PUT { key, state, dataUrl }` stores one PNG |
| POST | `/api/training/{id}/assets` | `{ dataUrl }` (PNG) → `{ imageId, url }` for screenshots, pictures and logos |
| POST | `/api/training/{id}/assets/generate` | `{ prompt }` → `{ imageId, url }` drawn by the image model |
| POST | `/api/training/{id}/assets/find` | `{ query?, prompt?, exclude? }` → `{ imageId, url, credit?, source? }`: a Microsoft Learn screenshot for `query`, else an illustration drawn from `prompt`; 404 when neither fits. Screenshots already in the video or in `exclude` are skipped |
| GET | `/api/training/{id}/infographics` | The notebook's infographics, for infographic visuals |
| GET | `/api/training/{id}/clips/{hash}` | A rendered transparent presenter clip (WebM), with byte ranges |
| GET | `/api/training/{id}/speech/{hash}` | A section's preview voice track (MP3), with byte ranges |
| GET | `/api/training/{id}/captions` | WebVTT captions of the last composed render |
| GET/POST | `/api/music` | List the music library / upload a track (multipart field `file`; MP3, M4A, AAC, WAV, OGG or FLAC, up to 50 MB) |
| GET/DELETE | `/api/music/{id}` | Stream a track / delete an uploaded one (tracks from `MOTION_MUSIC_DIR` cannot be deleted) |
| GET/POST | `/api/watermark` | `{ images, maxBytes }`: the watermark image library / upload one with `{ name, dataUrl }` (a PNG data URL, up to 5 MB) → `{ image, images }` |
| GET/DELETE | `/api/watermark/{id}` | The watermark image (PNG) / delete it → `{ ok, images }` |
| GET/DELETE | `/api/artifacts/{id}` | A saved artifact |
| GET | `/api/audio/{id}`, `/api/image/{id}`, `/api/voice-preview/{name}` | Binary media |

Spoken formats take two optional fields. `narration` is
`{ instructions?: string, replacements?: [{ from, to }] }`: the instructions go
into the script prompt, and every `from` term is replaced with `to` (or removed
when `to` is empty) in the finished script and again right before speech. When
omitted, the notebook's saved defaults are used. `music` is
`{ track: "random" | trackId, volume?: "low" | "medium" | "high" }`, or `null`
for none.

The three video formats also take `watermark`:
`{ kind: "text", text }` or `{ kind: "image", image: imageId }`, plus optional
`position` (`"top-left"`, `"top-center"`, `"top-right"`, `"middle-left"`,
`"center"`, `"middle-right"`, `"bottom-left"`, `"bottom-center"` or
`"bottom-right"`, the default), `size` (`"small"`, `"medium"` or `"large"`) and
`opacity` (`"faint"`, `"medium"` or `"solid"`). `null` or anything malformed
means no watermark. It is stamped on the next render.

## Live discussions

See [Live discussions](discussions.md#how-it-works) for the flow.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/discussion` | — | `{ ready, model }`, or `{ ready: false, problem }` explaining what to configure |
| POST | `/api/discussion` | `{ notebookId, sourceIds?, setup: { mode, voice?, focus?, stance? }, sdp }` | `{ answer, citations }`: the SDP answer for the browser's WebRTC offer, and the numbered opening excerpts. The client secret stays on the server |
| POST | `/api/discussion/search` | `{ notebookId, sourceIds?, query, start, known?: [{ passageId, n }] }` | `{ output, citations }`: the tool output for the AI and the new excerpts, numbered from `start` |
| POST | `/api/discussion/save` | `{ notebookId, setup, turns: [{ role, text, cites }], citations, results?, durationSec }` | `201 { note, warning? }`: the discussion saved as a note with takeaways |
| GET | `/api/live-presenter` | — | `{ ready, region? }`, or `{ ready: false, problem }` (no Speech resource, or a region without VASA-2) |
| POST | `/api/live-presenter` | — | `{ token, region, ice: { urls, username, credential } }`: short-lived Speech token (the server exchanges its key or Entra credential for it; neither is returned) and TURN relay for the browser's live VASA-2 avatar session |

`mode` is one of `discussion`, `debate`, `qa`, `expert`, `interview`,
`quiz` or `tutor`. `voice` is a realtime voice: `marin` (default), `cedar`,
`coral`, `sage`, `ash`, `ballad`, `verse`, `shimmer`, `echo` or `alloy`.

## Screen helper

See [Screen helper](screen-helper.md) for the flow.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/screen-help` | `{ goal, message?, trigger: "ask" \| "watch", history?: [{ role, text }], frame, width, height }` | `{ status, say, step, target, model }` |

`frame` is a JPEG, PNG or WebP data URL of the shared screen (up to about
3 MB), and `width`/`height` are its pixel size. `status` is `next_step`,
`answer`, `done`, `cannot_see` or `unchanged` (auto-watch only). `target` is
`{ x, y, w, h, label }` as fractions of the frame, or `null`. Nothing is
stored. A model that cannot read images returns `400` with `code: "vision"`.

## Other

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/models` | Read / change the active chat, embedding, image and vision models (`null` resets one to the environment value) |
| POST | `/api/discover` | Web search for candidate sources |
| GET | `/api/browse?url=` | Server-side page fetch for the in-app browser |
