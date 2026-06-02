# AGENTS.md

This file provides guidance to Codex and other coding agents when working in this repository.

## Project Identity

SnowAgents is a Windows desktop coding-agent project focused on C++ / Visual Studio / Unreal Engine workflows.

The current repository is a Tauri desktop MVP with a Visual Studio VSIX bridge. It is not a pure web app and it is not intended to become a full IDE. The goal is to build a local CodeBuddy-style coding agent that can understand Visual Studio C++ projects through semantic tools, apply safe patches, build the project, inspect compiler errors, and show useful trace information.

Core product position:

```text
A local C++ / Visual Studio coding agent with VSIX semantic integration, workspace cache, build-error repair loop, and traceable tool execution.
```

## Existing Product Shape

The current MVP includes:

- A native Tauri desktop app.
- A project registry with repo root, solution path, optional uproject path, and optional build command.
- A local Desktop HTTP bridge on `http://127.0.0.1:39000`.
- A `SnowAgent.VSBridge` VSIX for Visual Studio.
- VS bridge registration and heartbeat.
- `POST /openFile` support.
- A project detail / task page.
- Mock agent traces with expandable JSON.
- Clickable code links that open Visual Studio at the requested file and line.

Do not treat this as a generic chat wrapper. The product advantage should be C++ / Visual Studio project understanding.

## Architecture Direction

Target architecture:

```text
LLM Provider
  -> Agent Host
  -> Tool Registry
     -> file tools
     -> git tools
     -> build tools
     -> Visual Studio semantic tools
     -> clangd fallback tools
     -> trace tools
  -> Visual Studio VSIX Semantic Bridge
```

## Component Responsibilities

### Tauri Desktop App / Agent Host

The desktop app and Agent Host are responsible for:

- Managing project sessions.
- Managing model/provider configuration.
- Calling LLM providers.
- Planning coding tasks.
- Calling tools.
- Building context packages.
- Applying patches.
- Running builds.
- Reading build errors.
- Recording trace.
- Recording token usage.
- Showing task and trace UI.

The Agent Host should remain provider-independent. Do not hard-code one model provider into the architecture.

Future providers may include:

- OpenAI / Codex / OpenAI-compatible APIs.
- DeepSeek.
- MiniMax.
- Claude-compatible APIs.
- Local models.

### Visual Studio VSIX Bridge

The VSIX is a Visual Studio semantic gateway, not the full agent.

The VSIX should be responsible for:

- Reading the current solution.
- Reading the current active document.
- Reading the current selection/cursor.
- Listing projects.
- Mapping files to projects.
- Querying Visual Studio C++ semantic information.
- Finding definitions.
- Finding references.
- Finding callers.
- Finding overrides.
- Finding derived classes.
- Reading current build configuration.
- Reading current error list.
- Maintaining hot in-memory workspace cache.
- Persisting rebuildable workspace cache to local SQLite.

The VSIX should not own:

- LLM provider calls.
- Chat history.
- Long-term task history.
- API keys.
- Token billing history.
- Full patch history.

Those belong to the desktop Agent Host.

## Workspace Cache Design

The VSIX should eventually keep two layers of cache:

```text
Persistent DB cache:
  Used for fast startup and workspace restoration.

In-memory cache:
  Used for actual high-frequency runtime queries after Visual Studio is open.
```

The persistent cache is not the source of truth. It is only a rebuildable acceleration layer.

The source of truth should be:

- Visual Studio semantic services.
- clangd, when available.
- Actual project files on disk.
- Current MSBuild configuration.

Recommended cache flow:

```text
VS opens solution
  -> VSIX detects solution path
  -> VSIX opens workspace cache DB
  -> VSIX loads workspace/project/file/query cache
  -> VSIX builds memory cache
  -> Agent queries VSIX
  -> VSIX checks memory cache first
  -> If miss, check SQLite cache
  -> If stale or missing, query Visual Studio
  -> Write result back to memory + SQLite
```

Default cache location:

```text
%LOCALAPPDATA%\SnowAgents\Workspaces\<workspace_hash>\index.db
```

Optional project-local cache:

```text
<ProjectRoot>\.vs\SnowAgents\index.db
```

The `.vs` cache is allowed only for rebuildable data. Do not store API keys, chat history, patch history, or important user data in `.vs`.

## First Real Tool Set

### VSIX Tools

Implement these before more ambitious features:

```text
vs.current_solution
vs.current_document
vs.current_selection
vs.list_projects
vs.list_project_files
vs.find_definition
vs.find_references
vs.get_error_list
```

### Agent Tools

Implement these in the desktop/agent side:

```text
file.read
file.write
file.apply_patch
file.search
git.status
git.diff
build.solution
build.project
build.errors
trace.record
```

Prefer patch-based edits over full-file rewrites.

### Higher-Level Context Tools

Do not expose only low-level tools to the model. Add higher-level tools that return ranked, compact context:

```text
context.for_symbol
context.for_error
context.for_file
context.for_task
context.for_call_chain
context.for_class
```

Example:

```text
context.for_symbol("APlayerCharacter::MoveForward")
```

should return:

- Definition.
- Declaration.
- References.
- Callers.
- Related files.
- Project name.
- Build configuration.
- Relevant snippets.
- Truncation status.

The model should receive compact, ranked context rather than raw unfiltered search output.

## Build-Fix Loop

The agent must eventually support this loop:

```text
1. Apply patch.
2. Run build.
3. Parse build errors.
4. Open error context.
5. Ask model to fix.
6. Apply smaller patch.
7. Build again.
8. Record trace.
```

Changes should be minimal and surgical. Do not introduce speculative abstractions.

## Trace Requirements

Trace should be useful for both debugging and product UI.

Each task should eventually record:

- User request.
- Selected model.
- Input token count.
- Output token count.
- Cached token count if available.
- Tool calls.
- Tool arguments summary.
- Tool results summary.
- Files read.
- Patches applied.
- Build command.
- Build result.
- Errors found.
- Final diff.
- Final answer.

Do not store unnecessary raw private data if a compact summary is enough.

## Coding Principles

When implementing this project:

- Keep the architecture modular.
- Avoid hard-coding one LLM provider.
- Keep tools provider-independent.
- Prefer patch-based edits.
- Keep VSIX focused on Visual Studio integration.
- Keep model orchestration outside VSIX.
- Treat SQLite cache as rebuildable.
- Treat Visual Studio / clangd / project files as the source of truth.
- Optimize for C++ and Visual Studio first.
- Add Unreal Engine-specific tools after the base system is stable.
- Avoid building a general IDE too early.
- Prefer small, verifiable changes over large rewrites.

## Near-Term Goal

The next milestone is:

```text
Open a Visual Studio C++ solution.
Start SnowAgent Desktop.
VSIX registers the Visual Studio instance.
Desktop can open files in VS.
Desktop can show task trace.
Then extend VSIX from open-file bridge to semantic query bridge.
```

If this works, the project has the foundation for a real local C++ coding agent.
