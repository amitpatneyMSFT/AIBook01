## Configuration

InfiniAIBook talks to any **OpenAI-compatible** endpoint, or to Azure OpenAI.

### Named providers

The quickest route is a preset: set `AI_PROVIDER` and that provider's usual key
variable, and the base URL and default models are filled in.

```ini
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
# AI_MODEL=gpt-4o                       # optional: override the preset's model
```

| `AI_PROVIDER` | Key variable | Default chat model | Embeddings | Transcription |
|---|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | gpt-4o-mini | text-embedding-3-small | whisper-1 |
| `anthropic` | `ANTHROPIC_API_KEY` | claude-sonnet-4-5 | — | — |
| `gemini` | `GEMINI_API_KEY` | gemini-2.5-flash | gemini-embedding-001 | — |
| `groq` | `GROQ_API_KEY` | llama-3.3-70b-versatile | — | whisper-large-v3 |
| `mistral` | `MISTRAL_API_KEY` | mistral-small-latest | mistral-embed | — |
| `deepseek` | `DEEPSEEK_API_KEY` | deepseek-chat | — | — |
| `openrouter` | `OPENROUTER_API_KEY` | openai/gpt-4o-mini | — | — |
| `xai` | `XAI_API_KEY` | grok-3-mini | — | — |
| `perplexity` | `PERPLEXITY_API_KEY` | sonar | — | — |
| `together` | `TOGETHER_API_KEY` | Llama-3.3-70B-Instruct-Turbo | bge-large-en-v1.5 | — |
| `ollama` | none (local) | qwen3.5:latest | nomic-embed-text | — |
| `lmstudio` / `llamacpp` | none (local) | set `AI_MODEL` | set `AI_EMBEDDING_MODEL` | — |
| `azure` | Entra ID or `AZURE_OPENAI_API_KEY` | see below | | |

**Mixing providers.** Embeddings (for semantic retrieval) and transcription
(for audio/video sources) can go to a different provider from chat, which is
what a chat-only provider such as Anthropic needs:

```ini
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
AI_EMBEDDING_PROVIDER=openai          # or AI_EMBEDDING_BASE_URL / _API_KEY / _MODEL
AI_TRANSCRIPTION_PROVIDER=groq        # or AI_TRANSCRIPTION_BASE_URL / _API_KEY / _MODEL
OPENAI_API_KEY=...
GROQ_API_KEY=...
```

Without an embedding endpoint the app still works; retrieval falls back to
keyword ranking and says so.

### Custom endpoints

**Local or third-party** — set a base URL and it takes precedence over Azure:

```ini
AI_BASE_URL=http://localhost:8080/v1   # llama.cpp llama-server
AI_MODEL=qwen3.5:latest
AI_EMBEDDING_MODEL=nomic-embed-text
# AI_API_KEY=                          # only if the endpoint needs one
```

Works with llama.cpp's `llama-server`, Ollama (`:11434/v1`), LM Studio
(`:1234/v1`), vLLM, or OpenAI itself. Chat and embeddings are separate models:
llama.cpp needs `--embeddings`, Ollama needs a dedicated embedding model
(`ollama pull nomic-embed-text`).

> **Expect it to be slow without a GPU.** Measured on a CPU-only VM via Ollama:
> ingesting one short source took 8m34s, and a one-line chat answer 2m52s. The
> same work on Azure takes seconds. On a GPU or Apple Silicon this is far
> quicker, but "no API key needed" is not the same as "fast".

**Azure OpenAI** — used when neither `AI_PROVIDER` nor `AI_BASE_URL` is set
(or with `AI_PROVIDER=azure`):
```ini
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_DEPLOYMENT=gpt-5                             # chat deployment name
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large  # embedding deployment name
AZURE_OPENAI_IMAGE_DEPLOYMENT=gpt-image-2.5-sunburst      # optional: image infographics, whiteboard and motion videos
# DATA_DIR=./.data                                        # optional
```

These deployment values are **deployment names** from Azure AI Foundry, not model names.
List what your resource actually has:

```bash
az cognitiveservices account deployment list -n <resource> -g <rg> -o table
```

## Models and what they're used for

Only a **chat model** is required. Everything else is optional and turns on the
features that need it. For Azure, each value is a deployment name; for any
other provider it is a model id.

### What each model does

| Model | Used for | Without it |
|---|---|---|
| **Chat** (required) | Grounded chat, search **Ask**, transformations, source summaries and change summaries, source discovery, and every Studio text format: report, briefing, study guide, FAQ, timeline, quiz, flashcards, mind map and infographic content | Nothing works |
| **Studio script** | Audio-overview scripts, whiteboard and motion-explainer scene plans, and training-video transcripts ([details](#studio-script-model)) | The chat model writes them |
| **Embeddings** | Semantic retrieval for chat and Studio, semantic search, and matching the Studio focus box | Retrieval falls back to keyword ranking |
| **Image** | The "AI image" infographic style, whiteboard-video scenes and the drawing hand, and motion-explainer backgrounds, character and props | Those three features fail unless a deployment with the default name exists |
| **Vision** | Reading uploaded images so they can be indexed as sources, and the [screen helper](screen-helper.md) | Uses the chat model, which must then support images |
| **Transcription** | Audio and video file sources | Audio and video uploads fail with a message saying what to set |
| **Realtime voice** | [Live discussions](discussions.md): the spoken conversation itself, plus a transcription model for what you say | The Live discussion card explains what to set |
| **Speech** (Azure AI Speech, not a deployment) | Audio overviews, voice previews, whiteboard and motion narration, and training-video avatars | Those features are unavailable |
| **Gemini** | YouTube transcripts, fetched by Gemini on Google's side | The app tries YouTube's own captions, then falls back to the video description, clearly labeled |

### How to configure it

| Model | Azure setting | Other providers | Default |
|---|---|---|---|
| **Chat** | `AZURE_OPENAI_DEPLOYMENT` | `AI_MODEL` (or the `AI_PROVIDER` preset) | `gpt-4o` |
| **Studio script** | `AI_STUDIO_MODEL`<br>`AI_STUDIO_ENDPOINT` if on another resource | `AI_STUDIO_MODEL`<br>`AI_STUDIO_API=anthropic` for Claude | the chat model |
| **Embeddings** | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | `AI_EMBEDDING_MODEL` (or `AI_EMBEDDING_PROVIDER`) | `text-embedding-3-small` |
| **Image** | `AZURE_OPENAI_IMAGE_DEPLOYMENT`<br>`AZURE_OPENAI_IMAGE_API_VERSION` for its API version | `AI_IMAGE_MODEL` | `gpt-image-2.5-sunburst` |
| **Vision** | `AZURE_OPENAI_VISION_DEPLOYMENT` | `AI_VISION_MODEL` | the chat model |
| **Transcription** | `AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT` | `AI_TRANSCRIPTION_MODEL` (or `AI_TRANSCRIPTION_PROVIDER`) | the preset's, if any |
| **Realtime voice** | `AZURE_OPENAI_REALTIME_DEPLOYMENT` | `AI_REALTIME_MODEL` (OpenAI only) | none (`gpt-realtime` with OpenAI) |
| **Realtime transcription** | `AI_REALTIME_TRANSCRIPTION_MODEL` | same | `gpt-4o-mini-transcribe` |
| **Speech** | `AZURE_SPEECH_REGION` + `AZURE_SPEECH_RESOURCE_ID`, or `AZURE_SPEECH_KEY`<br>`AZURE_SPEECH_ENDPOINT` for the avatar service | same | Multitalker HD and standalone neural voices |
| **Gemini** | `GEMINI_API_KEY`, `GEMINI_MODEL` | same | `gemini-2.5-flash` |

The default Speech voice is `en-Multitalker:DragonHDLatestNeural`, alongside the
standalone neural voices.

No model animates the videos. Whiteboard and motion explainers are assembled
by the Python renderers in `scripts/`, which need Python 3 with `numpy`,
`Pillow` and `imageio-ffmpeg` (`PYTHON_BIN` picks the interpreter).

The chat, embedding, image and vision models can also be switched from the
**model picker** in the app header. A choice saved there overrides the
environment until you reset it.

## Environment variables

Set these in `.env.local`; [`.env.example`](../.env.example) has every one with
commentary. Only a model provider is required.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` + the provider's key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) | Named provider preset; see [Named providers](#named-providers) |
| `AI_BASE_URL`, `AI_MODEL`, `AI_EMBEDDING_MODEL`, `AI_API_KEY` | OpenAI-compatible provider, or overrides for a preset; takes precedence over Azure |
| `AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_BASE_URL`, `AI_EMBEDDING_API_KEY` | Send embeddings to a different provider from chat |
| `AI_TRANSCRIPTION_PROVIDER`, `AI_TRANSCRIPTION_BASE_URL`, `AI_TRANSCRIPTION_API_KEY`, `AI_TRANSCRIPTION_MODEL` | Speech-to-text for audio/video sources |
| `AI_IMAGE_MODEL`, `AI_VISION_MODEL` | Image-generation and image-reading models (override the Azure equivalents) |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION` | Azure OpenAI resource and data-plane API version |
| `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Chat and embedding deployment names |
| `AZURE_OPENAI_IMAGE_DEPLOYMENT`, `AZURE_OPENAI_IMAGE_API_VERSION` | Optional image model for AI-image infographics and videos |
| `AZURE_OPENAI_VISION_DEPLOYMENT` | Optional vision model for image sources; defaults to the chat deployment |
| `AZURE_OPENAI_REALTIME_DEPLOYMENT`, `AI_REALTIME_MODEL`, `AI_REALTIME_TRANSCRIPTION_MODEL`, `DISCUSSION_CONTEXT_CHARS` | Realtime voice model, transcription and starting context for [live discussions](discussions.md#setup) |
| `AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT` | Optional Whisper / gpt-4o-transcribe deployment for audio/video sources |
| `AZURE_OPENAI_API_KEY` | Legacy key auth; takes precedence over Entra when set |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Service principal or user-assigned identity for Entra auth |
| `AZURE_SPEECH_REGION`, `AZURE_SPEECH_RESOURCE_ID`, `AZURE_SPEECH_KEY` | Azure Speech for audio overviews, video narration and training-video avatars |
| `AZURE_SPEECH_ENDPOINT` | Custom-domain Speech endpoint for the avatar service; derived from `AZURE_SPEECH_RESOURCE_ID` when unset |
| `AZURE_AVATAR_BACKGROUND_URL`, `AZURE_AVATAR_PRICE_PER_MINUTE`, `AZURE_AVATAR_CONCURRENCY`, `TRAINING_IMAGES` | Optional training-video background image, cost estimate, parallel section renders and AI-image planning ([Training videos](training-videos.md)) |
| `STUDIO_CONTEXT_CHARS` | Starting source budget for Studio generation (default `30000`) |
| `AI_STUDIO_MODEL`, `AI_STUDIO_ENDPOINT`, `AI_STUDIO_API`, `AI_STUDIO_BASE_URL`, `AI_STUDIO_API_KEY`, `AI_STUDIO_MAX_TOKENS` | Separate model for audio-overview, video and training scripts and scene plans; see [Studio script model](#studio-script-model) |
| `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` | Optional discovery providers; DuckDuckGo is used without them |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | YouTube transcripts via Gemini |
| `YOUTUBE_API_KEY`, `YOUTUBE_COOKIE`, `YOUTUBE_CAPTION_LANG` | YouTube metadata and transcript fallbacks |
| `PYTHON_BIN` | Python interpreter for the whiteboard, motion and training renderers (default `python`; `python3` in the Docker image) |
| `TRAINING_RENDERER`, `MOTION_RENDERER`, `HYPERFRAMES_BIN`, `HYPERFRAMES_WORKERS`, `HYPERFRAMES_TIMEOUT_MIN` | Opt in to the HyperFrames renderer for training videos (`TRAINING_RENDERER=hyperframes`) and motion explainers (`MOTION_RENDERER=hyperframes`); the default is the Python renderer. Tune it with a `hyperframes` executable to use instead of `npx`, parallel browser workers (default 1–4 by CPU count) and a time limit (default 120 minutes) ([Training videos](training-videos.md#the-hyperframes-compositor), [Motion explainers](motion-explainers.md#the-hyperframes-renderer)) |
| `MOTION_MUSIC_DIR` | Optional folder of music tracks, listed read-only in the music picker alongside tracks uploaded in the app ([Background music](studio.md#background-music)) |
| `ALLOW_PRIVATE_NETWORK_FETCH` | Allow fetching private/loopback addresses (default off; see [SECURITY.md](../SECURITY.md)) |
| `MAX_FETCH_BYTES`, `FETCH_MAX_REDIRECTS`, `FETCH_TIMEOUT_MS` | Limits on fetched pages and files |
| `MAX_UPLOAD_BYTES` | Largest uploaded file or request body when adding sources (default 50 MB; larger requests get a 413) |
| `MAX_ARCHIVE_FILES`, `MAX_ARCHIVE_EXPANDED_BYTES` | Most files imported from one uploaded ZIP (default 100) and the total size it may expand to (default 500 MB) |
| `DATA_DIR` | Where the database and generated media live (default `./.data`) |
| `SQLITE_JOURNAL_MODE` | SQLite journal mode: `WAL` (default) or `DELETE`. Use `DELETE` when `DATA_DIR` is on a network share such as Azure Files |
| `INFINIAIBOOK_PASSWORD` | Require a password for the UI and API (default off) |
| `INFINIAIBOOK_API_TOKEN` | Bearer token for scripts calling the API. Once set, the password is no longer accepted as a bearer token |
| `INFINIAIBOOK_SESSION_SECRET` | Optional extra key for signing session cookies; change it to sign every browser out |
| `ALLOWED_HOSTS` | Extra hostnames the server answers to, comma-separated (`*` for any). Loopback names are always allowed. Without a password, other hosts get a 403 |
| `TRUST_PROXY` | `true` behind a reverse proxy: honor `X-Forwarded-Host` / `X-Forwarded-Proto` |

## Checking a provider

Model servers differ in what they actually support, and the gaps only show up
in use. `check:ai` exercises the real code paths against whatever is configured:

```bash
npm run check:ai              # connectivity, chat, streaming, JSON, embeddings
npm run check:ai -- --studio  # also generate all 9 text Studio formats
npm run check:ai -- --styles  # also generate an infographic in every style
npm run check:ai -- --image   # also render a test image
```

It imports the application's own modules, so it cannot drift from what the app
does, and it compares the live embedding size against what is already stored —
catching a model change that would otherwise degrade retrieval silently.

Reference run against Azure `gpt-5-mini`:

```
core
  PASS  chat           3.7s      PASS  embeddings  0.5s — 3072 dims
  PASS  streaming      1.4s      PASS  stored      517 chunks, all 3072 dims
  PASS  json mode      2.1s
studio formats
  PASS  Report        12.3s      PASS  Quiz        21.9s
  PASS  Briefing doc  10.6s      PASS  Study guide 19.2s
  PASS  Infographic   11.9s      PASS  FAQ          7.6s
  PASS  Mind map      15.0s      PASS  Timeline    14.2s
```

## Moving to local inference

1. Start a server with **both** chat and embedding models available —
   `llama-server --port 8080 -m model.gguf --embeddings`, or
   `ollama serve` plus `ollama pull nomic-embed-text`.
2. Point `AI_BASE_URL`, `AI_MODEL` and `AI_EMBEDDING_MODEL` at it.
3. Run `npm run check:ai -- --studio`. Structured output is where smaller models
   struggle, and this reports exactly which formats come back malformed rather
   than leaving you to discover it one artifact at a time.
4. Notebooks embedded by the previous model will rank by keyword only until
   repaired; the check warns when it sees this. Fix per notebook with
   `POST /api/notebooks/<id>/reembed`.

> `AZURE_OPENAI_API_VERSION` is a dated **API** release such as `2024-10-21`.
> It is not a model version — setting it to something like gpt-5's `2025-08-07`
> makes every call return a confusing 404. The app detects this and says so.

## Reasoning models (gpt-5, o-series)

These deployments reject a custom `temperature` and accept only the default.
Because a deployment name is user-chosen, the model family can't be inferred from
it, so the client probes once, caches the result for the process, and transparently
retries without `temperature`. No configuration needed — gpt-4o and gpt-5 both work.

## Authentication (Microsoft Entra ID)

There is no API key. The app authenticates with `DefaultAzureCredential` and
requests tokens for `https://cognitiveservices.azure.com/.default`.

**Locally** — sign in once, then start the app:

```bash
az login
npm run dev
```

Your account needs the **Cognitive Services OpenAI User** role on the Azure
OpenAI resource:

```bash
az role assignment create \
  --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Cognitive Services OpenAI User" \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<resource>"
```

**On Azure** (App Service, Container Apps, AKS, VM) — enable a managed identity
and grant it the same role. Nothing else to configure. For a *user-assigned*
identity, set `AZURE_CLIENT_ID` to its client id.

**CI / off-Azure containers** — supply a service principal via
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`.

Token acquisition, caching and refresh are handled per request, so long-running
servers never serve an expired token. Auth failures are translated into
actionable messages in the UI (missing credential vs. missing role assignment)
rather than a bare 401.

> A legacy `AZURE_OPENAI_API_KEY` is still honored if present, and takes
> precedence over Entra. Leave it unset to use Entra.

Without any working credential the app still runs: sources ingest and are
searchable by keyword, but chat and studio generation return a clear error.

## Rate limits and deployment quota

A deployment's tokens-per-minute quota caps how much context one request may
carry, and studio generation is context-hungry. Two mechanisms keep it working
on small deployments:

1. **Retry with backoff** — 429 and 5xx responses are retried up to five times,
   honoring `Retry-After` when Azure supplies it.
2. **Adaptive context** — if rate limiting persists, generation halves its
   excerpt budget and retries, down to a floor, rather than failing.

`STUDIO_CONTEXT_CHARS` (default `30000`, roughly 7.5K prompt tokens) sets the
starting budget. Raise it on a large deployment for richer artifacts; lower it
if you see repeated throttling. Check what your deployment allows with:

```bash
az cognitiveservices account deployment list -n <resource> -g <rg> \
  --query "[].{name:name, capacity:sku.capacity}" -o table
```

## Studio script model

Audio-overview scripts, whiteboard and motion-explainer scene plans, and
training-video transcripts can use a different model from chat. Leave
`AI_STUDIO_MODEL` unset to use the chat model.

Another deployment on the same resource, such as a larger GPT model:

```bash
AI_STUDIO_MODEL=gpt-5
```

A deployment on a different Azure resource. Entra ID is used unless
`AI_STUDIO_API_KEY` holds that resource's key:

```bash
AI_STUDIO_MODEL=gpt-chat-latest
AI_STUDIO_ENDPOINT=https://<other-resource>.cognitiveservices.azure.com
```

A Claude deployment in Microsoft Foundry, which accepts only Anthropic's
Messages API. The app calls the Azure endpoint (`AI_STUDIO_ENDPOINT`, else
`AZURE_OPENAI_ENDPOINT`) + `/anthropic` with Entra ID (scope
`https://ai.azure.com/.default`, role **Cognitive Services User**) or a key:

```bash
AI_STUDIO_MODEL=claude-opus-5-5   # the deployment name
AI_STUDIO_API=anthropic
```

Without an Azure endpoint, `AI_STUDIO_API=anthropic` calls `api.anthropic.com`
with `ANTHROPIC_API_KEY`. `AI_STUDIO_BASE_URL` and `AI_STUDIO_API_KEY` override
the endpoint and key, and `AI_STUDIO_MAX_TOKENS` (default `16000`) caps the
response length.
