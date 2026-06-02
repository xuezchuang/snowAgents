# SnowAgent Desktop

SnowAgent Desktop is a Windows Tauri desktop MVP for C++ / Unreal / Visual Studio workflows. It keeps project sessions in local JSON, binds a project to a running Visual Studio instance through a small VSIX bridge, and renders mock agent traces with clickable code links.

This is a native Tauri app. It is not Electron and it is not intended to run as a pure web app.

## Product Direction

SnowAgent Desktop is the foundation for SnowAgents: a local C++ / Visual Studio coding agent with VSIX semantic integration, workspace cache, build-error repair loop, and traceable tool execution.

The project should not become a generic chat wrapper. The long-term value is giving an LLM high-quality C++ / Visual Studio context:

- Current solution, project, active document, and selection.
- Symbol definitions and references.
- Caller/callee and override information.
- Project-to-file ownership.
- Active build configuration.
- Compiler error context.
- Clickable code links back into Visual Studio.
- Tool execution trace and token usage.

## Features

- Project registry with `repoRoot`, `solutionPath`, optional `uprojectPath`, and optional build command.
- Normal Windows display paths in the UI, while the backend can still use canonical paths internally.
- Local Desktop HTTP bridge on `http://127.0.0.1:39000` for VSIX registration.
- `SnowAgent.VSBridge` VSIX for Visual Studio 2026.
- VS Bridge registration, heartbeat, and `POST /openFile`.
- Project Detail / Task page with mock agent trace output.
- Expandable TracePanel input/output JSON, status, duration, and clickable code links.
- CodeLink resolution for relative and absolute Windows paths.

## Target Architecture

```text
SnowAgent Desktop / Agent Host
├─ project session registry
├─ model provider abstraction
├─ tool registry
├─ context builder
├─ patch manager
├─ build runner
├─ trace store
└─ UI

Visual Studio VSIX Bridge
├─ solution state service
├─ active document / selection service
├─ project-file mapping
├─ semantic query service
├─ error list service
├─ in-memory workspace cache
└─ optional SQLite workspace cache

Tool Layer
├─ file tools
├─ git tools
├─ build tools
├─ Visual Studio semantic tools
├─ clangd fallback tools
└─ trace tools
```

## Required Environment

Use Windows 10/11 with the MSVC toolchain available.

Required tools:

- Node.js 20+ and npm.
- Rust installed through rustup.
- Cargo from the same Rust toolchain.
- Visual Studio 2026.
- Visual Studio workload: Desktop development with C++.
- MSVC C++ build tools and Windows SDK.
- WebView2 Runtime.
- .NET Framework 4.7.2 targeting pack or developer pack for the VSIX project.
- Visual Studio SDK components for building VSIX extensions.

Useful checks:

```powershell
node --version
npm --version
rustc --version
cargo --version
rustup --version
npx tauri --version
cl.exe
```

If Rust is missing, install it with:

```powershell
winget install Rustlang.Rustup
```

After installing Rust, open a new terminal or make sure `%USERPROFILE%\.cargo\bin` is on `PATH`.

If `cl.exe` is missing, install Visual Studio 2026 or Visual Studio Build Tools with the C++ desktop workload. Tauri on Windows needs the MSVC Rust target and MSVC linker; do not use a GNU-only Rust toolchain for this project.

## Install Dependencies

```powershell
npm install
```

## Run The Desktop App

Run the full Tauri desktop app:

```powershell
npm run tauri dev
```

The Vite frontend alone can be started with:

```powershell
npm run dev
```

The browser-only Vite mode is only for frontend layout work. Tauri commands and the Rust backend are unavailable there.

## Build And Test

Frontend build:

```powershell
npm run build
```

Frontend lint:

```powershell
npm run lint
```

Rust tests:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

If `cargo` is not on `PATH` in the current terminal:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path src-tauri\Cargo.toml
```

## VSIX Bridge

The VSIX project is under:

```text
vsix\SnowAgent.VSBridge
```

Build it with MSBuild:

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" `
  vsix\SnowAgent.VSBridge\SnowAgent.VSBridge.csproj `
  /restore /p:Configuration=Debug /v:m
```

The debug VSIX is generated at:

```text
vsix\SnowAgent.VSBridge\bin\Debug\net472\SnowAgent.VSBridge.vsix
```

Install it to the normal Visual Studio 2026 instance with:

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\VSIXInstaller.exe" `
  /quiet /force /instanceIds:<instanceId> `
  vsix\SnowAgent.VSBridge\bin\Debug\net472\SnowAgent.VSBridge.vsix
```

Refresh Visual Studio configuration after installing:

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\devenv.exe" /updateconfiguration
```

To find the Visual Studio instance id:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -all -format json
```

On this workstation the Visual Studio 2026 Community instance has used the suffix `18.0_c13aba33`, so the VSIXInstaller instance id is `c13aba33`.

## Bridge Protocol

SnowAgent Desktop listens locally on:

```text
http://127.0.0.1:39000
```

The VSIX registers a Visual Studio instance with:

```http
POST /register_vs_instance
```

Example body:

```json
{
  "instanceId": "vs-12345",
  "processId": 12345,
  "solutionPath": "D:/Work/Game/Game.sln",
  "endpoint": "http://127.0.0.1:39001"
}
```

The VSIX exposes:

```http
POST /openFile
```

Example body:

```json
{
  "path": "D:/Work/Game/Source/Game/Foo.cpp",
  "line": 128,
  "column": 5
}
```

## Planned Semantic VSIX Tools

The current bridge opens files. The next stage is to expose semantic C++ project tools from Visual Studio:

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

Later tools may include:

```text
vs.find_callers
vs.find_callees
vs.find_overrides
vs.find_derived_classes
vs.get_build_configuration
vs.prepare_context
```

The VSIX should remain a semantic bridge. Model orchestration, task planning, patching, trace storage, token accounting, and provider configuration belong in the Desktop / Agent Host side.

## CodeLink Formats

Supported examples:

```text
Source/Game/Foo.cpp:128
Source/Game/Foo.cpp:128:5
D:\Work\Game\Source\Game\Foo.cpp:128
D:/Work/Game/Source/Game/Foo.cpp:128:5
```

Relative paths are resolved against the current `ProjectSession.repoRoot`. If the VS Bridge is not connected, CodeLink fails with `VS Bridge not connected`. If the file does not exist, CodeLink fails before calling Visual Studio.

## Local Data

Runtime data is stored under:

```text
%LOCALAPPDATA%\SnowAgentDesktop
```

Files currently include:

```text
projects.json
settings.json
```

Runtime VS bridge bindings such as `vsProcessId` and `vsBridgeEndpoint` are cleared on Desktop startup so stale ports are not reused.

Future semantic workspace cache should be rebuildable and stored separately, for example:

```text
%LOCALAPPDATA%\SnowAgents\Workspaces\<workspace_hash>\index.db
```

Optional project-local cache may live under:

```text
<ProjectRoot>\.vs\SnowAgents\index.db
```

Do not store API keys, chat history, patch history, or important user data inside `.vs`.

## Manual Verification

1. Start the desktop app with `npm run tauri dev`.
2. Open Visual Studio 2026 with a registered project solution.
3. Wait for the project card status to show `Bridge Connected`.
4. Click `Open Task`.
5. Run `Run Mock Agent`.
6. Expand trace rows and inspect input/output JSON.
7. Click the generated code link, for example `Source/RPGMetanoiaCpp/Private/RPGMetanoiaCpp.cpp:10`.
8. Confirm Visual Studio opens the file and moves to the requested line.

## Roadmap / TODO

### Milestone 1: Stabilize Current MVP

- [ ] Keep project registry stable.
- [ ] Keep VSIX registration and heartbeat stable.
- [ ] Keep `POST /openFile` reliable.
- [ ] Keep CodeLink resolution reliable for relative and absolute Windows paths.
- [ ] Keep mock trace UI usable.

### Milestone 2: Agent Host Foundation

- [ ] Add model provider abstraction.
- [ ] Add OpenAI-compatible provider.
- [ ] Add basic tool registry.
- [ ] Add `file.read`.
- [ ] Add `file.search`.
- [ ] Add `file.apply_patch`.
- [ ] Add `git.diff`.
- [ ] Add trace data model.
- [ ] Save trace as JSON.

### Milestone 3: Build Integration

- [ ] Add MSBuild discovery.
- [ ] Add `build.solution`.
- [ ] Add `build.project`.
- [ ] Capture build stdout/stderr.
- [ ] Parse MSVC errors.
- [ ] Map errors to file/line/column.
- [ ] Add `context.for_error`.

### Milestone 4: VS Semantic Bridge

- [ ] Add `vs.current_solution`.
- [ ] Add `vs.current_document`.
- [ ] Add `vs.current_selection`.
- [ ] Add `vs.list_projects`.
- [ ] Add `vs.list_project_files`.
- [ ] Add `vs.find_definition`.
- [ ] Add `vs.find_references`.
- [ ] Add `vs.get_error_list`.
- [ ] Add result ranking and truncation.
- [ ] Filter generated/intermediate/third-party paths.
- [ ] Add compact code previews.

### Milestone 5: Workspace Cache

- [ ] Add SQLite workspace cache.
- [ ] Add Workspace table.
- [ ] Add Project table.
- [ ] Add File table.
- [ ] Add QueryCache table.
- [ ] Load cache when solution opens.
- [ ] Build in-memory cache from SQLite.
- [ ] Check file mtime/hash.
- [ ] Invalidate stale query cache.
- [ ] Save semantic query results back to cache.

### Milestone 6: Patch and Build Loop

- [ ] Let agent apply patch.
- [ ] Run build after patch.
- [ ] Parse errors.
- [ ] Ask model for fix.
- [ ] Apply smaller patch.
- [ ] Build again.
- [ ] Record full trace.
- [ ] Show final diff.

### Milestone 7: C++ / Unreal Enhancements

- [ ] Add clangd fallback.
- [ ] Add compile_commands support.
- [ ] Add UE module detection.
- [ ] Add `.Build.cs` / `.Target.cs` parsing.
- [ ] Add UCLASS/UFUNCTION/UPROPERTY search.
- [ ] Add generated code filtering.
- [ ] Add Unreal-specific context builder.

## Repository Hygiene

Generated output is intentionally ignored:

```text
node_modules/
dist/
src-tauri/target/
vsix/**/bin/
vsix/**/obj/
vsix/**/.vs/
*.log
```
