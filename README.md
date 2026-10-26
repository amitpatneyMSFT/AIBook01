<p align="center"><img src="public/brand/infiniaibook-icon.png" alt="InfiniAIBook logo" width="160"></p>

# InfiniAIBook

[![CI](https://github.com/russrimm/InfiniAIBook/actions/workflows/ci.yml/badge.svg)](https://github.com/russrimm/InfiniAIBook/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A self-hosted Agentic Powered Notebook research studio. Upload your own sources, chat with
them, talk them through out loud, and turn them into **reports, briefings,
PowerPoint decks, infographics, mind maps, quizzes, flashcards, study guides,
FAQs, timelines, audio overviews, whiteboard videos, motion explainers and
avatar training videos**. Every claim is cited back to the document it came from.

Built with Next.js 15, TypeScript and SQLite. Runs against Azure OpenAI, a dozen
named providers (OpenAI, Anthropic, Gemini, Groq, Mistral, DeepSeek, OpenRouter,
xAI, Perplexity, Together) or any OpenAI-compatible endpoint, including local
models via Ollama, llama.cpp or LM Studio.

Inspired by [open-notebook](https://github.com/lfnovo/open-notebook).

> **Single-user.** Without `INFINIAIBOOK_PASSWORD`, anyone who can reach the
> server can use it, and your model quota with it. It listens on localhost only
> by default; set a password before using `npm run dev:lan`, or put it behind an
> authenticating proxy — see [SECURITY.md](SECURITY.md).

![InfiniAIBook workspace with four selected sources, a chat session picker, a cited chat answer and Studio generation tools including a multi-speaker audio overview](docs/screenshots/workspace.png)

More in the [screenshot tour](docs/screenshots.md).

### Sample: an avatar training video

The 🧑‍🏫 **Training video** generator turns a notebook's sources and notes into an
editable trainer's script, then renders it with an Azure AI Foundry
text-to-speech avatar: a lip-synced presenter, signed in with Microsoft Entra ID.
By default the presenter is composed with slides, key numbers, quotes,
knowledge checks, pictures, screenshots and the notebook's infographics. Each
visual slides in when the presenter says the words it illustrates, and you can
plan, edit and preview them in the browser before anything is billed. This 3:37
presenter-only sample came from a notebook of two public "What's new in Copilot
Studio" pages. It rendered in about four and a half minutes.

https://github.com/user-attachments/assets/7651fdca-42dd-45e4-8e56-f56f07c3b6d9

| Pick a presenter, voice, length and background | Review the script, render, and play or download the MP4 |
|---|---|
| ![Training video card in the Studio panel with trainer, voice, length and background choices](docs/screenshots/training-card.png) | ![Finished training video playing above the editable transcript, with presenter settings and a Render again button](docs/screenshots/training-editor.png) |

How it works, setup and costs: [Training videos](docs/training-videos.md).

#### Live VASA-2 presenter (preview)

Open a training video's script and choose **Preview live (VASA-2)** to have one
of four VASA-2 talking-head avatars (Leonie, Leonie Professional, George or
Marcel) speak the transcript in your browser, in real time. Nothing is recorded
or added to the video. It needs an Azure Speech resource in West US 2, Central
India, Southeast Asia or Sweden Central; see
[Live VASA-2 presenter](docs/training-videos.md#live-vasa-2-presenter).

![Live presenter dialog offering the four VASA-2 avatars Leonie, Leonie Professional, George and Marcel, a voice picker, a video area and the training transcript](docs/screenshots/live-presenter.png)

### Sample: a whiteboard video

The 🎬 **Whiteboard video** generator plans a short scene-by-scene story from
your sources, then draws it: a hand sketches each hand-lettered title and
doodle on a whiteboard while a narrator explains it, with a caption under every
scene. You review and edit the script before anything is drawn or voiced. This
1:14 sample has six scenes and came from the fictional community-garden
notebook used in the [Studio examples](#studio-examples). It rendered in about
six minutes.

https://github.com/user-attachments/assets/86b4d194-5210-43af-b2da-2bf508d73ec4

How it works and setup: [Whiteboard videos](docs/whiteboard-videos.md).

### Sample: a motion explainer

The 🎞️ **Motion explainer** generator tells a story in 2D animation:
illustrated backgrounds, a recurring character, kinetic headlines, callout chips
and stat cards, following problem, solution, how it works, benefits and a next
step. Length, tone, audience, illustration style, colors, the character and the
closing call to action can all be changed. This 1:50 sample has seven scenes,
uses the default settings and came from the same notebook. It rendered in about
nine minutes.

https://github.com/user-attachments/assets/9df785be-160a-4b0b-879d-531a4749b538

How it works, customization and setup: [Motion explainers](docs/motion-explainers.md).

## Features

- **Sources** — PDF, DOCX, PPTX, TXT, MD, CSV, JSON, HTML, images, audio/video, ZIP archives,
  pasted text, URLs, YouTube links and RSS/Atom feeds; discover sources from a topic,
  browse the web in-app, or reuse a source from another notebook. Uploads are
  processed in the background, and linked sources are re-checked for changes.
  [More](docs/sources.md)
- **Grounded chat** — streaming answers built only from your selected sources,
  with clickable inline citations that open the highlighted passage, **Stop**
  that keeps the partial answer, and multiple chat sessions per notebook.
- **Notes and transformations** — Markdown notes, saved chat answers (citations
  kept), notes turned into sources, and reusable prompts run on a source.
  [More](docs/notes-and-search.md)
- **Live discussions** — talk through your sources out loud: discuss, debate,
  Q&A, interview an expert, get interviewed, an oral quiz or a Socratic tutor.
  The AI answers in real time, lets you interrupt, looks things up in your
  sources mid-conversation and shows clickable citations. Save the call as a
  note with takeaways. [More](docs/discussions.md)
- **Search everything** — keyword or semantic search, and a grounded **Ask**,
  across every notebook. [More](docs/notes-and-search.md#search-and-ask)
- **Screen helper** — share any app's window, type what you need help with,
  and get coached one step at a time, with the next control highlighted on a
  screenshot. Auto-watch notices when you have done a step and suggests the
  next. [More](docs/screen-helper.md)
- **Studio** — fourteen generators, each producing a structured, interactive
  artifact ([see an example of each](#studio-examples)):

  | Format | Output |
  |---|---|
  | 🎧 [Audio overview](docs/audio-overviews.md) | One to four speakers discuss your sources, with a synced transcript |
  | 🎬 [Whiteboard video](docs/whiteboard-videos.md) | A narrated, hand-drawn explainer, MP4 |
  | 🎞️ [Motion explainer](docs/motion-explainers.md) | A narrated 2D animated explainer (problem → solution → how → benefits → next step), MP4. [Customize](docs/motion-explainers.md#customizing-a-video) the length, tone, audience, illustration style, colors, character, closing call to action, resolution and character motion |
  | 🧑‍🏫 [Training video](docs/training-videos.md) | An editable trainer's script from sources and notes, rendered by a lip-synced Azure avatar presenter with timed slides, pictures and infographics, MP4 |
  | 📽️ [PowerPoint deck](docs/studio.md#powerpoint-deck) | Title, agenda, content slides with speaker notes and a sources slide; download as PPTX |
  | 📊 [Infographic](docs/infographics.md) | **33 styles**, each with a live example in the style gallery before you generate — timelines, funnels, pyramids, cycles, myth vs fact, pros & cons, cheat sheets, kawaii, bricks and AI-drawn anime, retro print and paper craft among them. Pick the shape (landscape, portrait, square), the level of detail, describe what you want, or ask for styles that suit your sources |
  | 🕸️ [Mind map](docs/studio.md#mind-maps) | Interactive, expandable concept tree |
  | 🧠 [Quiz](docs/studio.md#quiz) · 🗂️ [Flashcards](docs/studio.md#flashcards) | Scored quizzes and self-graded decks |
  | 📄 Report · 🧾 Briefing · 🎓 Study guide · ❓ FAQ · 🗓️ Timeline | Structured written summaries |

  Audio overviews and all three video formats stop at an **editable script**
  before anything is narrated or rendered, accept **narration instructions**
  and a **word-replacement list** (for terms to avoid, translation or a
  different register), and can add **background music** you upload. Videos
  can also carry a text or image **watermark** in any of nine positions.
  [More](docs/studio.md#spoken-formats-script-review-instructions-and-music)

- **Structure explorer** — open any JSON, XML, CSV/TSV or HAR source in a modal that discovers its structure: a path tree and graph with types, counts and value stats, or a sortable table. HAR files get a request table, waterfall, findings (failures, slow TTFB, uncompressed or uncached responses, redirects, duplicates, third parties, secrets in URLs), Server-Timing and redirect-chain views, CSV export, a sanitized download, and **Diagnose with AI**, which sends a redacted digest (never the raw archive) to the Studio model to name likely root causes.
- **Exports** — Markdown, PPTX, MP3, MP4, PNG and Anki/Quizlet CSV. [More](docs/studio.md#exporting)
- **Model picker** — switch the chat, embedding, image and vision models from
  the workspace header; a saved choice overrides the environment until reset.
  [More](docs/configuration.md#models-and-what-theyre-used-for)
- **Undo deletes** — deleted sources, notes, chats, artifacts and notebooks can
  be restored for 8 seconds.
- **Reduced motion** — honors the OS or browser `prefers-reduced-motion`
  setting: entrances fade instead of moving, spinners and mind maps stop
  animating, and scrolling jumps instead of gliding.
- **Everything is local** — sources, embeddings, chat history, artifacts and
  media live under `.data/`. Password protection and a Docker image included.

See the [full feature list](docs/features.md) for details.

## Studio examples

Every example below, except the training video, was generated from the same
fictional notebook: four sources about a community-garden pilot (a project
brief, a planting and water plan, volunteer workshop notes and a resident
survey). The numbered badges are citations; hover or click one to see the
passage it came from.

### Documents

| 📄 Report | 🧾 Briefing doc |
|---|---|
| ![Report with an executive summary, analysis sections, a comparison table and inline citations](docs/screenshots/studio/report.png) | ![One-page briefing with a bottom line, what the sources say, risks and caveats, and recommended next steps](docs/screenshots/studio/briefing.png) |
| An in-depth write-up with an executive summary, analysis, tables, key takeaways and open questions | An executive one-pager: bottom line, evidence, risks and next steps |
| **🎓 Study guide** | **❓ FAQ** |
| ![Study guide with core concepts, a glossary table and short-answer questions](docs/screenshots/studio/study-guide.png) | ![FAQ with expandable questions and cited answers](docs/screenshots/studio/faq.png) |
| Core concepts, a glossary, ten short-answer questions and an answer key | The questions the sources actually answer, as expandable items |
| **🗓️ Timeline** | **📽️ [PowerPoint deck](docs/studio.md#powerpoint-deck)** |
| ![Vertical timeline of the pilot from the February survey to the October lease decision](docs/screenshots/studio/timeline.png) | ![Slide preview with thumbnails and cited speaker notes](docs/screenshots/studio/powerpoint-deck.png) |
| A dated chronology of the events in the sources | Slides with speaker notes and a sources slide; download as PPTX |

### Visuals

| 📊 [Infographic](docs/infographics.md) | 🕸️ [Mind map](docs/studio.md#mind-maps) |
|---|---|
| ![Illustrated infographic with headline numbers and grouped visual concepts](docs/screenshots/studio/infographic.png) | ![Fully expanded mind map with four color-coded branches](docs/screenshots/studio/mind-map.png) |
| The *Illustrated* style, one of 33; see every style in the [style gallery](docs/infographics.md#style-gallery) | An expandable concept tree; export it as PNG |

### Study

| 🧠 [Quiz](docs/studio.md#quiz) | 🗂️ [Flashcards](docs/studio.md#flashcards) |
|---|---|
| ![Scored quiz showing 5 of 6 correct with a retry button and cited explanations](docs/screenshots/studio/quiz.png) | ![Flashcard deck in Browse all view with two cards marked got it and one marked missed](docs/screenshots/studio/flashcards.png) |
| Scored multiple choice with cited explanations; retry only the ones you missed | Flip, self-grade and shuffle, or browse the deck as a list; export to Anki or Quizlet |

### Audio & video

Audio overviews, whiteboard videos and motion explainers stop at an
**editable script** before anything is narrated or rendered, which is the stage
shown here. Narrating and rendering need Azure Speech, and whiteboard and motion
videos also need an image model and Python; see
[Models and what they're used for](#models-and-what-theyre-used-for).

| 🎧 [Audio overview](docs/audio-overviews.md) | 🎬 [Whiteboard video](docs/whiteboard-videos.md) |
|---|---|
| ![Audio overview script editor with two named hosts, voices, music and chaptered lines](docs/screenshots/studio/audio-overview.png) | ![Whiteboard video script with a caption, drawing description and narration for each scene](docs/screenshots/studio/whiteboard-video.png) |
| A conversation between one to four speakers, with chapters; narrate it to MP3 | Six hand-drawn scenes, each with a caption, a drawing and narration; watch the 1:14 [sample above](#sample-a-whiteboard-video) |
| **🎞️ [Motion explainer](docs/motion-explainers.md)** | **🧑‍🏫 [Training video](docs/training-videos.md)** |
| ![Motion explainer script with story beats, on-screen headlines, callout chips and narration](docs/screenshots/studio/motion-explainer.png) | [![A presenter on a slate background, with the subtitle "If you build or manage agents in Copilot Studio, the pace of change is fast"](docs/screenshots/training-video.jpg)](#sample-an-avatar-training-video) |
| Problem, solution, how, benefits and a call to action, with headlines and callouts; watch the 1:50 [sample above](#sample-a-motion-explainer) | A lip-synced avatar presenter with timed slides; watch the 3:37 [sample above](#sample-an-avatar-training-video) |

## Quick start

Requires **Node.js 22.13+** and a model endpoint: reuse or create one
(Microsoft Foundry, OpenAI, Gemini, a local model…) before you install. Only a
chat model is required; embeddings, voices, images and the rest are optional.

> **New to this?** Follow [Install step by step](docs/install-guide.md). It
> starts with choosing and creating your model endpoint, then explains every
> step on Windows and Mac, including how to create the settings file, with no
> prior experience needed.

```bash
npm install
cp .env.example .env.local   # then configure a provider
npm run dev
```

Open <http://localhost:3000>. See [Getting started](docs/getting-started.md) for
Docker and password protection, and [Configuration](docs/configuration.md) for
providers and environment variables.

### Models and what they're used for

Only a chat model is required; each of the others switches features on. Azure
settings are shown here; other providers use the `AI_*` equivalents. The
[full table](docs/configuration.md#models-and-what-theyre-used-for) covers
defaults and what happens without each one.

| Model | Setting | Used for |
|---|---|---|
| Chat (required) | `AZURE_OPENAI_DEPLOYMENT` or `AI_MODEL` | Chat, search Ask, notes and transformations, and the written Studio formats |
| Studio script | `AI_STUDIO_MODEL` (optional, defaults to chat) | Audio-overview scripts, whiteboard and motion scene plans, training transcripts, HAR diagnosis |
| Embeddings | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` or `AI_EMBEDDING_MODEL` | Semantic retrieval and search; keyword ranking without it |
| Image | `AZURE_OPENAI_IMAGE_DEPLOYMENT` or `AI_IMAGE_MODEL` | AI-image infographics, whiteboard videos and motion explainers |
| Vision | `AZURE_OPENAI_VISION_DEPLOYMENT` or `AI_VISION_MODEL` | Reading uploaded images and the screen helper (defaults to chat) |
| Transcription | `AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT` or `AI_TRANSCRIPTION_MODEL` | Audio and video sources |
| Realtime voice | `AZURE_OPENAI_REALTIME_DEPLOYMENT` or `AI_REALTIME_MODEL` | Live discussions |
| Azure Speech | `AZURE_SPEECH_REGION` + `AZURE_SPEECH_RESOURCE_ID` (or `AZURE_SPEECH_KEY`) | Every voice: audio overviews, video narration, training-video avatars |
| Gemini | `GEMINI_API_KEY` | YouTube transcripts |

Whiteboard videos and motion explainers also need Python 3 with `numpy`,
`Pillow` and `imageio-ffmpeg`.

## Documentation

Full documentation is in [docs/](docs/README.md), including
[how grounding works](docs/grounding.md), the [architecture](docs/architecture.md)
and the [REST API](docs/API.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and the checks to
run before a pull request, and the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
