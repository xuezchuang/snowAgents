# SnowAgent.VSBridge

Minimal Visual Studio 2026 VSIX bridge for SnowAgent Desktop.

## Behavior

- Loads when a solution exists.
- Starts a loopback HTTP server on a dynamic port.
- Registers the current Visual Studio process with SnowAgent Desktop at `http://127.0.0.1:39000/register_vs_instance`.
- Exposes `POST /openFile` on the VSIX endpoint.

## Build

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" vsix\SnowAgent.VSBridge\SnowAgent.VSBridge.csproj /restore /p:Configuration=Debug
```

The Debug VSIX is written to:

```text
vsix\SnowAgent.VSBridge\bin\Debug\net472\SnowAgent.VSBridge.vsix
```

## Debug

Open `SnowAgent.VSBridge.sln` in Visual Studio 2026, set `SnowAgent.VSBridge` as the startup project, then start debugging. It launches:

```text
C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\devenv.exe /rootsuffix Exp
```

Start SnowAgent Desktop before opening a solution in the experimental Visual Studio instance.

## Registration Flow

1. Start SnowAgent Desktop with `npm run tauri dev`.
2. Add or select a SnowAgent project whose `solutionPath` matches the solution that will be opened in Visual Studio.
3. Start debugging this VSIX in Visual Studio 2026.
4. In the experimental Visual Studio instance, open that solution.
5. SnowAgent Desktop should update the matching project from `Process Started` to `Bridge Connected`.

## Verify openFile

After registration, read the project's `vsBridgeEndpoint` from SnowAgent Desktop and call:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:<dynamicPort>/openFile" `
  -ContentType "application/json" `
  -Body '{"path":"D:/Work/Game/Source/Game/Foo.cpp","line":128,"column":5}'
```

Expected response:

```json
{ "ok": true, "message": "opened" }
```
