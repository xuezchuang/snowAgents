# VS Bridge Protocol

This document describes the SnowAgent Desktop and Visual Studio VSIX MVP bridge.

Desktop listens on:

```text
http://127.0.0.1:39000
```

The VSIX listens on a dynamic loopback port and reports that endpoint during registration.

## Desktop Registration

When the VSIX starts or a solution opens, it registers the active Visual Studio instance with SnowAgent Desktop.

```http
POST http://127.0.0.1:39000/register_vs_instance
Content-Type: application/json
```

```json
{
  "instanceId": "vs-xxxx",
  "processId": 12345,
  "solutionPath": "D:/Work/Game/Game.sln",
  "endpoint": "http://127.0.0.1:39001"
}
```

Desktop behavior:

- Match `solutionPath` to a `ProjectSession`.
- Update the project `vsProcessId`.
- Update the project `vsBridgeEndpoint`.
- Show `Bridge Connected` in the UI.
- Store paths in display-safe form without Windows `\\?\` prefixes.

## Heartbeat

The VSIX periodically heartbeats so Desktop can detect that the instance is still alive.

```http
POST http://127.0.0.1:39000/heartbeat_vs_instance
Content-Type: application/json
```

```json
{
  "instanceId": "vs-xxxx"
}
```

## Unregister

The VSIX unregisters on shutdown or when the package is disposed.

```http
POST http://127.0.0.1:39000/unregister_vs_instance
Content-Type: application/json
```

```json
{
  "instanceId": "vs-xxxx"
}
```

## VSIX Local Endpoints

The VSIX hosts a loopback HTTP endpoint. Desktop or a local test client can call the registered `endpoint` value.

```text
POST /openFile
```

## openFile

Request:

```json
{
  "path": "D:/Work/Game/Source/Game/Foo.cpp",
  "line": 128,
  "column": 5
}
```

Response:

```json
{
  "ok": true,
  "message": "opened"
}
```

Expected behavior:

- Activate the Visual Studio instance that owns the endpoint.
- Open the file path in that Visual Studio instance.
- Move caret to `line` and optional `column`.
- Return a clear failure message if the file cannot be opened.

## Not Implemented In MVP

These capabilities are intentionally excluded from the first VSIX bridge MVP:

- Build commands.
- Error list integration.
- Active document or selection reads.
- Complex authentication.
- Multi-user security model.
