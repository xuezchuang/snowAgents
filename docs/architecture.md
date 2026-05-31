# SnowAgent Desktop MVP Architecture

## Boundary

React renders state and calls typed Tauri commands. Rust owns project registry, settings, Visual Studio launch, bridge instance registry, trace generation, and code-link resolution.

No real LLM, MCP, UE Editor operation, database, or VSIX implementation is included in the MVP.

## File Structure

```text
src-tauri/
  src/
    main.rs
    app_state.rs
    project_registry.rs
    process_manager.rs
    vs_registry.rs
    tool_trace.rs
    code_link.rs
    commands.rs

src/
  App.tsx
  api/
    tauriApi.ts
  components/
    ProjectList.tsx
    ProjectDetail.tsx
    TracePanel.tsx
    CodeLink.tsx
    Settings.tsx
  types/
    project.ts
    settings.ts
    trace.ts
    vs.ts
```

## Runtime Flow

1. `AppState::load` creates `%LOCALAPPDATA%\SnowAgentDesktop` and loads JSON files.
2. Project CRUD commands validate paths and persist `projects.json`.
3. Settings commands persist `settings.json`.
4. `open_visual_studio(projectId)` resolves `devenv.exe`, launches `solutionPath`, and records `vsProcessId`.
5. `register_vs_instance(payload)` matches `solutionPath` to a project and records `vsBridgeEndpoint`.
6. `run_mock_agent(projectId, userPrompt)` generates a task-scoped trace list.
7. `open_code_link(projectId, rawLink)` resolves the link against `repoRoot`, calls `{endpoint}/openFile` when bridge-connected, or starts VS as fallback.
