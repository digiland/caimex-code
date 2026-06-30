# EcoCode — Design & Build Plan

A Rust-pragmatic coding agent that reuses the proven OpenCode/Caimex engine as a
server, surfaces it through **two thin clients** (a Rust TUI and a VS Code
extension), routes all LLM traffic through the **Caimex gateway**, and
self-updates from **GitHub Releases**.

> **Core principle:** Don't rewrite the agent brain. Keep the TypeScript engine
> (so you keep cheap upstream merges from OpenCode/Kilo), and spend your Rust
> budget where it actually wins: a fast single static binary, a `ratatui` TUI,
> and clean self-update. Add the few Kilo-only features **once, in the engine**,
> so both clients get them for free.

---

## 1. Why this shape

The engine already ships everything a client needs to talk to:

- `eco serve` (today `caimex serve`) → HTTP + WebSocket server (`packages/opencode/src/server/server.ts`,
  routes under `server/routes/instance/httpapi/`)
- `packages/sdk/openapi.json` → an OpenAPI contract for that server
- `packages/sdk/js` → a generated JS client (the VS Code extension can reuse this)

So both surfaces are **thin clients over one typed API**, not new agents.

```
┌─────────────────────────────────────────────────────┐
│  ENGINE (TypeScript — the brain, unchanged-ish)      │
│  eco serve  →  sessions, tools, agents, MCP, LSP,    │
│  permissions, context compaction, gateway routing    │
│  exposes HTTP + WS  (described by openapi.json)       │
└───────────────┬───────────────────┬─────────────────┘
                │ HTTP/WS (OpenAPI)  │
        ┌───────▼────────┐  ┌────────▼─────────┐
        │ RUST TUI       │  │ VS CODE EXT      │
        │ (ratatui)      │  │ (thin TS client) │
        │ single binary  │  │ Copilot-style    │
        │ self-updates   │  │ inline + chat    │
        │ via GH Releases│  │ via marketplace  │
        └────────────────┘  └──────────────────┘
```

**Hard rule to protect upstream merges:** add features to the engine as
**plugins / tools / context-sources** (the engine has these extension points),
not by editing core. Heavy core edits = lost merges = the one thing that kills a
solo fork.

---

## 2. Repo layout (monorepo)

Keep the existing Bun/Turbo monorepo and add two new top-level pieces. The Rust
crate lives alongside the TS packages; Turbo orchestrates TS, Cargo orchestrates
Rust.

```
caimex-code/                      # (this repo, rebranded entry points → "eco")
├── packages/                     # EXISTING TS engine — leave as-is, extend via plugins
│   ├── opencode/                 #   runtime: `eco serve`, CLI, tools, agents
│   ├── core/                     #   app id, config, model catalog, system-context
│   ├── llm/                      #   provider abstraction (Caimex gateway lives here)
│   └── ...                       #   tui (TS), server, sdk, etc.
│
├── sdk/openapi.json              # EXISTING — source of truth for both clients
│
├── clients/                      # NEW — the two surfaces
│   ├── eco-tui/                  #   Rust TUI (ratatui) — single self-updating binary
│   │   ├── Cargo.toml
│   │   ├── build.rs              #   (optional) regenerate API client from openapi.json
│   │   └── src/
│   │       ├── main.rs           #   wiring: spawn/connect engine, run TUI loop
│   │       ├── api/              #   generated or hand-rolled OpenAPI client (reqwest)
│   │       │   ├── mod.rs
│   │       │   └── client.rs
│   │       ├── engine.rs         #   spawn `eco serve`, health-check, port mgmt
│   │       ├── update.rs         #   self_update against GitHub Releases
│   │       ├── app.rs            #   app state (sessions, messages, input)
│   │       └── ui/               #   ratatui widgets (transcript, input, diff, status)
│   │
│   └── eco-vscode/               #   VS Code extension (TS) — reuses packages/sdk/js
│       ├── package.json
│       ├── src/extension.ts      #   activate: connect to `eco serve`, register cmds
│       ├── src/chat.ts           #   chat/agent webview panel
│       └── src/complete.ts       #   inline (ghost-text) completion provider
│
├── plugins/                      # NEW — Kilo-delta features, added to the engine
│   ├── semantic-index/           #   Tree-sitter + embeddings + LanceDB → semantic_search tool
│   └── ...
│
├── Cargo.toml                    # NEW — workspace for the Rust crate(s)
└── ecocode.md                    # this file
```

Rebrand touch-points (same minimal set CLAUDE.md already documents — do these in
Phase 0, nothing more):

- `packages/core/src/global.ts` — app id → `ecocode`
- `packages/opencode/src/index.ts` — `scriptName("eco")`
- `packages/opencode/package.json` — bin key → `eco`
- `packages/tui/src/attention.ts` — default title → `eco`
- `packages/opencode/src/config/config.ts` — config names → `eco.json*`

---

## 3. The Rust TUI: minimal starting point

### 3.0 Verified API surface (from `packages/sdk/openapi.json`)

The engine exposes **two** surfaces. Use the modern **V2** (`/api/*`) one — it's the
durable "V2 session core" with advisory wakeups. (The legacy V1 surface —
`/session`, `/event`, `POST /session/{id}/message` — still exists but returns
different shapes; don't mix them.)

| Purpose | Method + path | Body | Returns |
|---|---|---|---|
| Health | `GET /api/health` | — | `{ healthy: true }` (no auth) |
| List models | `GET /api/model` | — | `{ location, data: ModelV2Info[] }` |
| List agents | `GET /api/agent` | — | agent list |
| Create session | `POST /api/session` | `{ agent?, model?: {id, providerID, variant?}, location? }` (all optional) | `{ data: SessionV2Info }` |
| **Send prompt** | `POST /api/session/{id}/prompt` | `{ prompt: { text, files?, agents? }, delivery?: "steer"\|"queue", resume?: bool, id? }` | `{ data: SessionInputAdmitted }` — **async, not the reply** |
| **Wait until idle** | `POST /api/session/{id}/wait` | — | **`204`** when the session goes idle (blocks) |
| Read messages | `GET /api/session/{id}/message` | — | `{ data: SessionMessage[], cursor }` |
| Live stream | `GET /api/event` | — | **SSE** `text/event-stream` of JSON events |
| Switch model/agent | `POST /api/session/{id}/model` · `/agent` | — | — |
| Compact context | `POST /api/session/{id}/compact` | — | — |

**The key behavioral difference vs. a naive REST agent:** prompting is *admitted*,
not answered. `POST .../prompt` returns a `SessionInputAdmitted` receipt
(`admittedSeq`, message `id`). To get the assistant's reply you then either:

- **(simple)** `POST /api/session/{id}/wait` — blocks, returns `204` when the turn
  is done — then `GET /api/session/{id}/message` and read the last assistant
  message's `content` (an array of `{type:"text"|"reasoning"|"tool", ...}`); or
- **(live)** subscribe to `GET /api/event` (SSE) and consume
  `message.part.delta` events: `{ properties: { sessionID, messageID, partID,
  field, delta } }` — append each `delta` to render tokens as they arrive.

`SessionV2Info`: `{ id, title, projectID, cost, tokens, time, agent?, model?,
parentID?, location, subpath? }`. The local server declares **no auth** /
security schemes, so no token is needed for a localhost connection.

### 3.1 `Cargo.toml`

```toml
[package]
name = "eco-tui"
version = "0.1.0"
edition = "2021"

[dependencies]
ratatui = "0.28"               # TUI framework
crossterm = "0.28"             # terminal backend
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
futures-util = "0.3"           # streaming responses / SSE
anyhow = "1"
self_update = { version = "0.41", features = ["archive-tar", "compression-flate2"] }
```

> Tip: rather than hand-write the client, you can generate one from the contract:
> `openapi-generator-cli generate -i sdk/openapi.json -g rust -o clients/eco-tui/src/api`.
> For a first pass the hand-rolled client below is smaller and easier to debug.

### 3.2 `src/engine.rs` — spawn & connect to the engine

Solo-friendly approach: **spawn `eco serve` as a child process** on a local port,
wait for health, then talk HTTP. (Bundling Bun + engine into one artifact is a
later optimization — get spawn-and-connect working first.)

```rust
use anyhow::{Context, Result};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub struct Engine {
    child: Child,
    pub base_url: String,
}

impl Engine {
    /// Launch `eco serve` and wait until it answers.
    pub async fn spawn(port: u16) -> Result<Self> {
        let child = Command::new("eco")
            .args(["serve", "--port", &port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("failed to start `eco serve` — is the engine on PATH?")?;

        let base_url = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::new();

        // health poll (~10s budget) — `{ "healthy": true }` when ready
        for _ in 0..50 {
            if let Ok(resp) = client.get(format!("{base_url}/api/health")).send().await {
                if resp.status().is_success() {
                    return Ok(Self { child, base_url });
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        anyhow::bail!("engine did not become healthy in time");
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}
```

> Endpoints verified against `packages/sdk/openapi.json` (the V2 `/api/*`
> surface). Treat that file as the contract if routes change upstream.

### 3.3 `src/api/client.rs` — thin typed V2 client (hand-rolled, verified)

Matches the real `/api/*` contract: every JSON response is wrapped in `{ "data": ... }`,
create takes optional fields, and **prompt is async** (admit → wait → read).

```rust
use anyhow::Result;
use serde::{Deserialize, Serialize};

pub struct Api {
    http: reqwest::Client,
    base: String, // e.g. http://127.0.0.1:8765
}

/// Responses are wrapped: { "data": T }
#[derive(Debug, Deserialize)]
struct Envelope<T> { data: T }

#[derive(Debug, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub agent: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct CreateSession {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,           // e.g. "build" / "plan"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelRef>,
}

#[derive(Debug, Serialize)]
pub struct ModelRef {
    pub id: String,
    #[serde(rename = "providerID")]
    pub provider_id: String,             // e.g. "caimex"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PromptBody {
    pub prompt: PromptText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery: Option<String>,        // "steer" | "queue"
}

#[derive(Debug, Serialize)]
pub struct PromptText { pub text: String }

#[derive(Debug, Deserialize)]
pub struct Admitted {
    #[serde(rename = "admittedSeq")]
    pub admitted_seq: u64,
    pub id: String,                      // msg_...
}

/// One assistant content block: { "type": "text"|"reasoning"|"tool", ... }
#[derive(Debug, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,            // present when kind == "text"
}

/// A session message (the assistant variant carries `content`).
#[derive(Debug, Deserialize)]
pub struct SessionMessage {
    #[serde(rename = "type")]
    pub kind: String,                    // "assistant" | "user" | "tool" | ...
    #[serde(default)]
    pub content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct Messages { data: Vec<SessionMessage> }

impl Api {
    pub fn new(base: impl Into<String>) -> Self {
        Self { http: reqwest::Client::new(), base: base.into() }
    }

    pub async fn create_session(&self, req: CreateSession) -> Result<SessionInfo> {
        let env = self.http
            .post(format!("{}/api/session", self.base))
            .json(&req)
            .send().await?.error_for_status()?
            .json::<Envelope<SessionInfo>>().await?;
        Ok(env.data)
    }

    /// Admit a prompt. Returns immediately with a receipt — NOT the reply.
    pub async fn prompt(&self, session_id: &str, text: impl Into<String>) -> Result<Admitted> {
        let body = PromptBody { prompt: PromptText { text: text.into() }, delivery: None };
        let env = self.http
            .post(format!("{}/api/session/{}/prompt", self.base, session_id))
            .json(&body)
            .send().await?.error_for_status()?
            .json::<Envelope<Admitted>>().await?;
        Ok(env.data)
    }

    /// Block until the session goes idle (server returns 204).
    pub async fn wait(&self, session_id: &str) -> Result<()> {
        self.http
            .post(format!("{}/api/session/{}/wait", self.base, session_id))
            .send().await?.error_for_status()?;
        Ok(())
    }

    pub async fn messages(&self, session_id: &str) -> Result<Vec<SessionMessage>> {
        let m = self.http
            .get(format!("{}/api/session/{}/message", self.base, session_id))
            .send().await?.error_for_status()?
            .json::<Messages>().await?;
        Ok(m.data)
    }

    /// Convenience: admit → wait → return the last assistant text.
    pub async fn ask(&self, session_id: &str, text: impl Into<String>) -> Result<String> {
        self.prompt(session_id, text).await?;
        self.wait(session_id).await?;
        let reply = self.messages(session_id).await?
            .into_iter().rev()
            .find(|m| m.kind == "assistant")
            .map(|m| m.content.into_iter()
                .filter(|b| b.kind == "text")
                .filter_map(|b| b.text)
                .collect::<Vec<_>>().join(""))
            .unwrap_or_default();
        Ok(reply)
    }
}
```

> **Two ways to get the reply.** The `ask()` helper above uses the simple
> *admit → `wait` (204) → read messages* path — perfect to get end-to-end first.
> For **live token streaming**, instead subscribe to `GET /api/event` (SSE) with
> `reqwest` + `futures_util::StreamExt`, parse each event as JSON, and on
> `type == "message.part.delta"` append `properties.delta` to the matching
> `partID`. Keep a `wait()` in flight (or watch for the idle/finish event) to
> know when the turn ends.

### 3.4 `src/update.rs` — self-update from GitHub Releases

```rust
use anyhow::Result;

/// Check GitHub Releases and replace the running binary if a newer tag exists.
pub fn self_update() -> Result<()> {
    let status = self_update::backends::github::Update::configure()
        .repo_owner("YOUR_GH_ORG")
        .repo_name("ecocode")
        .bin_name("eco-tui")
        .current_version(env!("CARGO_PKG_VERSION"))
        .show_download_progress(true)
        .build()?
        .update()?;
    println!("eco-tui is at {}", status.version());
    Ok(())
}
```

Wire it to an `eco-tui --update` flag (and/or a background check on launch that
just *notifies* — don't swap the binary mid-session).

### 3.5 `src/main.rs` — wiring

```rust
mod engine; mod api; mod app; mod ui; mod update;
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().any(|a| a == "--update") {
        return update::self_update();
    }

    use api::client::{Api, CreateSession};

    let engine = engine::Engine::spawn(8765).await?;     // launch `eco serve`
    let api = Api::new(&engine.base_url);

    // Create a session bound to the default agent (model can be omitted to use
    // the configured default, or set ModelRef { provider_id: "caimex", .. }).
    let session = api.create_session(CreateSession {
        agent: Some("build".into()),
        model: None,
    }).await?;

    // ratatui event loop: render transcript + input box. On Enter, call
    // api.ask(&session.id, text) for the simple path, or kick off api.prompt(..)
    // + an /api/event SSE subscription for live token streaming.
    ui::run(api, session).await?;                        // owns the terminal loop

    Ok(()) // Engine::drop kills `eco serve`
}
```

That's a complete vertical slice: **spawn engine → create session → admit prompt
→ wait/stream → render → self-update**. Everything else (diff view, agent
switcher, MCP status, permission prompts via `GET /api/session/{id}/permission`)
is incremental UI on top of the same verified API.

---

## 4. The VS Code extension (Phase 2)

Thin TS extension; reuse `packages/sdk/js` so you get the API types for free.

- `extension.ts` — on activate, connect to a running `eco serve` (or spawn one),
  register a chat command + an `@file` mention command.
- `chat.ts` — a webview panel that streams from the same session API.
- `complete.ts` — register an `InlineCompletionItemProvider` that calls a
  fill-in-the-middle endpoint through the Caimex gateway (Phase 3 feature).

**Do NOT fork VS Code.** An extension gives Copilot-style reach without
maintaining a copy of Microsoft's editor (and keeps Marketplace access).

---

## 5. Kilo-only deltas — add once, in the engine, in ROI order

Both clients inherit these automatically because they live behind the API.

1. **Semantic codebase index** *(biggest capability gap vs Kilo).*
   Tree-sitter chunking → embeddings (via the gateway or a local model) →
   **LanceDB** (embedded, no external service) → exposed as a `semantic_search`
   tool. Ship as `plugins/semantic-index/`.
2. **Inline autocomplete** (fill-in-the-middle through the gateway) — surfaced in
   the VS Code extension's `complete.ts`.
3. **Agent-Manager-style worktrees** — parallel agents across git worktrees +
   multi-version bake-off. The engine already has worktree-scoped sessions, so
   this is orchestration UI over existing plumbing, not new core.
4. **Commit-message generation, browser tool, MCP marketplace** — as time allows.

---

## 6. Solo roadmap (realistic)

| Phase | Scope | Rough effort |
|-------|-------|--------------|
| **0** | Rebrand to EcoCode (5 touch-points), point at Caimex gateway. You now have a working agent. | days |
| **1** | Rust TUI client: `engine.rs` + hand-rolled API client + `ratatui` loop + `self_update`. Single self-updating binary. | 2–4 weeks |
| **2** | VS Code extension: chat panel + `@file`, reusing `packages/sdk/js`. | 2–3 weeks |
| **3a** | Semantic index plugin (`semantic_search`). | 1–2 weeks |
| **3b** | Inline autocomplete (extension). | 1 week |
| **3c** | Worktree Agent-Manager UI. | 2+ weeks |

If you must pick ONE surface to start: do the **Rust TUI** — it's your stated
preference and has the cleanest self-update story. Add the extension once the
engine-side features (esp. semantic index) are in.

---

## 7. Risks & guardrails (solo)

- **Engine drift kills merges.** Add features as plugins/tools/context-sources,
  not core edits. The whole reason to keep TS is upstream merges from
  OpenCode/Kilo — protect that.
- **Packaging Bun + engine into one binary is the fiddly part.** Ship
  "spawn `eco serve`" first; bundle later.
- **Two clients = two UIs to maintain.** Lead with the TUI; the extension reuses
  the same API and the JS SDK, so it's cheaper than it looks.
- **Marketplace publishing** is a small one-time chore (publisher account, VSIX).
- **Self-update channel = GitHub *Releases*, not Pages.** Pages serves the site;
  Releases serve the signed binaries `self_update` pulls.

---

## 8. One-line summary

EcoCode = **rebranded Caimex engine running as a server** + **a Rust `ratatui`
single-binary TUI** + **a VS Code extension**, both thin clients over the engine's
OpenAPI, with **Kilo's best features added once in the engine** and
**self-update from GitHub Releases**. Rust where it pays; TypeScript where the
brain already works; upstream merges preserved.
