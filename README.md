# SnowAgent Desktop

SnowAgent Desktop is a Windows Tauri desktop MVP for C++ / Unreal / Visual Studio workflows. It keeps project sessions in local JSON, binds a project to a running Visual Studio instance through a small VSIX bridge, and renders mock agent traces with clickable code links.

This is a native Tauri app. It is not Electron and it is not intended to run as a pure web app.

## Features

- Project registry with `repoRoot`, `solutionPath`, optional `uprojectPath`, and optional build command.
- Normal Windows display paths in the UI, while the backend can still use canonical paths internally.
- Local Desktop HTTP bridge on `http://127.0.0.1:39000` for VSIX registration.
- `SnowAgent.VSBridge` VSIX for Visual Studio 2026.
- VS Bridge registration, heartbeat, and `POST /openFile`.
- Project Detail / Task page with mock agent trace output.
- Expandable TracePanel input/output JSON, status, duration, and clickable code links.
- CodeLink resolution for relative and absolute Windows paths.

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

## Manual Verification

1. Start the desktop app with `npm run tauri dev`.
2. Open Visual Studio 2026 with a registered project solution.
3. Wait for the project card status to show `Bridge Connected`.
4. Click `Open Task`.
5. Run `Run Mock Agent`.
6. Expand trace rows and inspect input/output JSON.
7. Click the generated code link, for example `Source/RPGMetanoiaCpp/Private/RPGMetanoiaCpp.cpp:10`.
8. Confirm Visual Studio opens the file and moves to the requested line.

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
