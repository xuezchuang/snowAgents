use std::fs;
use std::io::{self, IsTerminal, Read, Write};

use crossterm::cursor;
use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyEvent, KeyEventKind,
    KeyModifiers,
};
use crossterm::execute;
use crossterm::queue;
use crossterm::style::ResetColor;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType};
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::json;

use crate::agent_runner::{self, AgentConversationMessage, AgentRunInput};
use crate::app_state::{current_settings, AppState};
use crate::project_registry::{ProjectInput, ProjectSession};
use crate::tool_trace::{MockAgentRun, ToolTraceEvent, TraceEventType};
use crate::vs_registry::{AppSettings, ProviderConfig, ProviderCredential};

const CHAT_PROMPT: &str = "› ";
const CLI_TRANSCRIPT_MAX_MESSAGES: usize = 20;

#[derive(Debug)]
pub struct Cli {
    pub project: Option<String>,
    pub provider: Option<String>,
    pub credential: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub no_shell: bool,
    pub yes: bool,
    pub json: bool,
    pub verbose: bool,
    pub command: Command,
}

#[derive(Clone, Debug)]
struct CliSession {
    provider_id: Option<String>,
    provider_name: Option<String>,
    credential_id: Option<String>,
    credential_name: Option<String>,
    model_id: Option<String>,
    reasoning_effort: Option<String>,
    workspace_label: Option<String>,
    shell_allowed: bool,
}

#[derive(Clone, Debug)]
struct CliModelChoice {
    provider_id: String,
    provider_name: String,
    credential_id: Option<String>,
    credential_name: Option<String>,
    model_id: String,
    model_name: String,
    reasoning_mode: String,
    default_reasoning: String,
}

#[derive(Clone, Debug)]
struct CliPickerItem {
    label: String,
    description: String,
}

#[derive(Debug)]
pub enum Command {
    Help,
    Version,
    Chat,
    Status,
    Run { task: String },
    Projects { command: ProjectsCommand },
    Models { command: ModelsCommand },
}

#[derive(Debug)]
pub enum ProjectsCommand {
    List,
    Add(ProjectAddArgs),
}

#[derive(Debug, Default)]
pub struct ProjectAddArgs {
    pub name: Option<String>,
    pub path: Option<String>,
    pub solution: Option<String>,
}

#[derive(Debug)]
pub enum ModelsCommand {
    List,
}

pub async fn main_entry() -> Result<(), String> {
    let cli = parse_cli(std::env::args().skip(1).collect())?;
    run(cli).await
}

fn parse_cli(args: Vec<String>) -> Result<Cli, String> {
    let first_positional = first_positional_arg(&args);
    let help_requested = has_global_flag_before_terminator(&args, &["--help", "-h"])
        || first_positional == Some("help");
    let version_requested = has_global_flag_before_terminator(&args, &["--version", "-V"])
        || first_positional == Some("version");
    let mut cli = Cli {
        project: None,
        provider: None,
        credential: None,
        model: None,
        reasoning: None,
        no_shell: true,
        yes: false,
        json: false,
        verbose: false,
        command: Command::Chat,
    };
    if help_requested || version_requested {
        cli.json = args.iter().any(|arg| arg == "--json");
        cli.verbose = args.iter().any(|arg| arg == "--verbose");
        cli.command = if help_requested {
            Command::Help
        } else {
            Command::Version
        };
        return Ok(cli);
    }
    let mut positionals = Vec::new();
    let mut force_task = false;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "--project" | "-C" => {
                let option = args[i].clone();
                i += 1;
                cli.project = Some(take_arg(&args, i, &option)?);
            }
            "--provider" => {
                i += 1;
                cli.provider = Some(take_arg(&args, i, "--provider")?);
            }
            "--credential" => {
                i += 1;
                cli.credential = Some(take_arg(&args, i, "--credential")?);
            }
            "--model" | "-m" => {
                let option = args[i].clone();
                i += 1;
                cli.model = Some(take_arg(&args, i, &option)?);
            }
            "--reasoning" | "--reason" | "--reasion" => {
                let option = args[i].clone();
                i += 1;
                cli.reasoning = Some(take_arg(&args, i, &option)?);
            }
            "--allow-shell" | "--shell" => {
                if !help_requested && !version_requested {
                    return Err(
                        "Generic shell execution is disabled by CodeForge safety policy."
                            .to_string(),
                    );
                }
            }
            "--no-shell" => cli.no_shell = true,
            "--yes" => cli.yes = true,
            "--json" => cli.json = true,
            "--verbose" => cli.verbose = true,
            "--help" | "-h" => {
                cli.command = Command::Help;
            }
            "--version" | "-V" => {
                cli.command = Command::Version;
            }
            "--" => {
                force_task = true;
                positionals.extend(args.iter().skip(i + 1).cloned());
                break;
            }
            "-" => positionals.push("-".to_string()),
            value if value.starts_with('-') && positionals.is_empty() => {
                return Err(format!("Unknown option: {value}"));
            }
            value => positionals.push(value.to_string()),
        }
        i += 1;
    }
    if matches!(cli.command, Command::Help | Command::Version) {
        return Ok(cli);
    }
    if force_task && !positionals.is_empty() {
        cli.command = Command::Run {
            task: positionals.join(" "),
        };
        return Ok(cli);
    }
    cli.command = parse_command(&positionals)?;
    Ok(cli)
}

fn has_global_flag_before_terminator(args: &[String], flags: &[&str]) -> bool {
    args.iter()
        .take_while(|arg| arg.as_str() != "--")
        .any(|arg| flags.contains(&arg.as_str()))
}

fn first_positional_arg(args: &[String]) -> Option<&str> {
    let mut index = 0usize;
    while index < args.len() {
        match args[index].as_str() {
            "--project" | "-C" | "--provider" | "--credential" | "--model" | "-m" | "--reasoning"
            | "--reason" | "--reasion" => {
                index += 2;
            }
            "--no-shell" | "--allow-shell" | "--shell" | "--yes" | "--json" | "--verbose"
            | "--help" | "-h" | "--version" | "-V" => {
                index += 1;
            }
            value => return Some(value),
        }
    }
    None
}

fn take_arg(args: &[String], index: usize, flag: &str) -> Result<String, String> {
    let value = args
        .get(index)
        .ok_or_else(|| format!("{flag} requires a value"))?;
    if value.starts_with('-') {
        return Err(format!("{flag} requires a value"));
    }
    Ok(value.clone())
}

fn parse_command(args: &[String]) -> Result<Command, String> {
    match args {
        [] => Ok(Command::Chat),
        [cmd] if cmd == "help" => Ok(Command::Help),
        [cmd] if cmd == "version" => Ok(Command::Version),
        [cmd] if cmd == "chat" => Ok(Command::Chat),
        [cmd] if cmd == "status" => Ok(Command::Status),
        [dash] if dash == "-" => Ok(Command::Run {
            task: String::new(),
        }),
        [cmd] if cmd == "projects" => Ok(Command::Projects {
            command: ProjectsCommand::List,
        }),
        [cmd] if cmd == "models" => Ok(Command::Models {
            command: ModelsCommand::List,
        }),
        [cmd, task] if cmd == "run" || cmd == "exec" => Ok(Command::Run { task: task.clone() }),
        [cmd, rest @ ..] if cmd == "run" || cmd == "exec" => Ok(Command::Run {
            task: rest.join(" "),
        }),
        [cmd, sub] if cmd == "projects" && sub == "list" => Ok(Command::Projects {
            command: ProjectsCommand::List,
        }),
        [cmd, sub, rest @ ..] if cmd == "projects" && sub == "add" => Ok(Command::Projects {
            command: ProjectsCommand::Add(parse_project_add(rest)?),
        }),
        [cmd, sub] if cmd == "models" && sub == "list" => Ok(Command::Models {
            command: ModelsCommand::List,
        }),
        [cmd, sub, ..] if cmd == "projects" => Err(format!(
            "Unknown projects command: {sub}. Usage: codeforge projects, codeforge projects list, or codeforge projects add."
        )),
        [cmd, sub, ..] if cmd == "models" => Err(format!(
            "Unknown models command: {sub}. Usage: codeforge models or codeforge models list."
        )),
        [cmd, sub, ..] if cmd == "status" => Err(format!(
            "Unknown status argument: {sub}. Usage: codeforge status."
        )),
        [cmd, sub, ..] if cmd == "chat" => Err(format!(
            "Unknown chat argument: {sub}. Usage: codeforge chat."
        )),
        rest if !rest.is_empty() => Ok(Command::Run {
            task: rest.join(" "),
        }),
        _ => Err(help_text()),
    }
}

fn parse_project_add(args: &[String]) -> Result<ProjectAddArgs, String> {
    let mut parsed = ProjectAddArgs::default();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "--name" => {
                i += 1;
                parsed.name = Some(take_arg(args, i, "--name")?);
            }
            "--path" => {
                i += 1;
                parsed.path = Some(take_arg(args, i, "--path")?);
            }
            "--solution" => {
                i += 1;
                parsed.solution = Some(take_arg(args, i, "--solution")?);
            }
            other if parsed.path.is_none() => {
                parsed.path = Some(other.to_string());
            }
            other => return Err(format!("Unknown projects add argument: {other}")),
        }
        i += 1;
    }
    Ok(parsed)
}

fn help_text() -> String {
    "Usage: codeforge [-C, --project <name-or-path>] [--provider <provider>] [--credential <credential>] [-m, --model <model>] [--reasoning <effort|off|on>] [--yes] [--json] [--verbose] [command]\n\nOptions:\n  -C, --project <name-or-path>  use a registered project or workspace path\n  --provider <provider>         select provider id\n  --credential <credential>     select credential id\n  -m, --model <model>           select model id\n  --reasoning <effort>          select reasoning/thinking mode\n  --no-shell                    shell execution remains disabled by policy\n  --yes                         assume yes for supported confirmations\n  --json                        print machine-readable JSON where supported\n  --verbose                     print extra trace events\n  --                            stop parsing options; treat following tokens as task text\n  --help, -h                    show help\n  --version, -V                 show version\n\nCommands:\n  codeforge\n  codeforge chat\n  codeforge \"<task>\"\n  codeforge -\n  codeforge status\n  codeforge run \"<task>\"\n  codeforge exec \"<task>\"\n  echo \"<task>\" | codeforge run\n  echo \"<task>\" | codeforge exec\n  codeforge projects\n  codeforge projects list\n  codeforge projects add [path] [--name <name>] [--path <path>] [--solution <solution.sln>]\n  codeforge models\n  codeforge models list\n  codeforge help\n  codeforge version\n\nInteractive commands:\n  /           show commands\n  /new        start a new chat and clear conversation context\n  /model      choose model and reasoning/thinking\n  /reason     choose reasoning/thinking\n  /status     show current model selection\n  /clear      clear the terminal\n  /help       show commands\n  /exit       quit\n  /quit       quit".to_string()
}

pub async fn run(cli: Cli) -> Result<(), String> {
    if matches!(cli.command, Command::Help) {
        print_cli_help(cli.json)?;
        return Ok(());
    }
    if matches!(cli.command, Command::Version) {
        print_cli_version(cli.json)?;
        return Ok(());
    }
    if cli.json && matches!(cli.command, Command::Chat) {
        return Err(
            "--json is not supported for interactive chat. Use status, projects, models, run, or exec."
                .to_string(),
        );
    }

    let state = AppState::load()?;
    let mut session = CliSession::from_cli(&cli);
    match &cli.command {
        Command::Help => Ok(()),
        Command::Version => Ok(()),
        Command::Status => {
            hydrate_cli_session_defaults(&state, &mut session)?;
            let project = select_project(&state, cli.project.as_deref())?;
            if cli.json {
                print_cli_session_json(&session, Some(&project))?;
            } else {
                print_cli_session(&session, Some(&project));
            }
            Ok(())
        }
        Command::Projects { command } => run_projects(&state, command, cli.json),
        Command::Models { command } => run_models(&state, command, cli.json),
        Command::Run { task } => {
            let task = cli_run_task_text(task)?;
            hydrate_cli_session_defaults(&state, &mut session)?;
            run_task(&state, &cli, &session, &task, None)
                .await
                .map(|_| ())
        }
        Command::Chat => {
            hydrate_cli_session_defaults(&state, &mut session)?;
            run_chat(&state, &cli, session).await
        }
    }
}

fn print_cli_help(json_output: bool) -> Result<(), String> {
    if json_output {
        let payload = json!({
            "usage": "codeforge [-C, --project <name-or-path>] [--provider <provider>] [--credential <credential>] [-m, --model <model>] [--reasoning <effort|off|on>] [--yes] [--json] [--verbose] [command]",
            "options": [
                { "name": "-C, --project <name-or-path>", "description": "use a registered project or workspace path" },
                { "name": "--provider <provider>", "description": "select provider id" },
                { "name": "--credential <credential>", "description": "select credential id" },
                { "name": "-m, --model <model>", "description": "select model id" },
                { "name": "--reasoning <effort>", "description": "select reasoning/thinking mode" },
                { "name": "--no-shell", "description": "shell execution remains disabled by policy" },
                { "name": "--yes", "description": "assume yes for supported confirmations" },
                { "name": "--json", "description": "print machine-readable JSON where supported" },
                { "name": "--verbose", "description": "print extra trace events" },
                { "name": "--", "description": "stop parsing options; treat following tokens as task text" },
                { "name": "--help, -h", "description": "show help" },
                { "name": "--version, -V", "description": "show version" },
            ],
            "commands": [
                { "name": "codeforge", "description": "start interactive chat" },
                { "name": "codeforge chat", "description": "start interactive chat" },
                { "name": "codeforge \"<task>\"", "description": "run one task and exit" },
                { "name": "codeforge -", "description": "read one task from stdin and exit" },
                { "name": "codeforge status", "description": "show current model, provider, directory, and workspace" },
                { "name": "codeforge run \"<task>\"", "description": "run one task and exit" },
                { "name": "codeforge exec \"<task>\"", "description": "alias for codeforge run" },
                { "name": "echo \"<task>\" | codeforge run", "description": "read one task from stdin and exit" },
                { "name": "echo \"<task>\" | codeforge exec", "description": "read one task from stdin and exit" },
                { "name": "codeforge projects", "description": "list registered projects" },
                { "name": "codeforge projects list", "description": "list registered projects" },
                { "name": "codeforge projects add", "description": "register a project" },
                { "name": "codeforge models", "description": "list configured providers and models" },
                { "name": "codeforge models list", "description": "list configured providers and models" },
                { "name": "codeforge help", "description": "show help" },
                { "name": "codeforge version", "description": "show version" },
            ],
            "interactiveCommands": slash_commands()
                .iter()
                .map(|(name, description)| {
                    json!({
                        "name": name,
                        "description": description,
                    })
                })
                .collect::<Vec<_>>(),
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?
        );
    } else {
        println!("{}", help_text());
    }
    Ok(())
}

fn cli_run_task_text(task: &str) -> Result<String, String> {
    let trimmed = task.trim();
    if !trimmed.is_empty() && trimmed != "-" {
        return Ok(trimmed.to_string());
    }

    let stdin = io::stdin();
    if stdin.is_terminal() {
        return Err(
            "codeforge run/exec requires a task. Usage: codeforge run \"<task>\", codeforge exec \"<task>\", or pipe a task into codeforge run/exec."
                .to_string(),
        );
    }

    let mut input = String::new();
    stdin
        .lock()
        .read_to_string(&mut input)
        .map_err(|error| format!("Failed to read task from stdin: {error}"))?;
    let input = input.trim();
    if input.is_empty() {
        return Err(
            "codeforge run/exec received an empty task from stdin. Usage: codeforge run \"<task>\", codeforge exec \"<task>\", or pipe a task into codeforge run/exec."
                .to_string(),
        );
    }
    Ok(input.to_string())
}

fn print_cli_version(json_output: bool) -> Result<(), String> {
    if json_output {
        let payload = json!({
            "app": "codeforge",
            "name": "codeforge",
            "surface": "cli",
            "version": env!("CARGO_PKG_VERSION"),
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?
        );
    } else {
        println!("codeforge {}", env!("CARGO_PKG_VERSION"));
    }
    Ok(())
}

impl CliSession {
    fn from_cli(cli: &Cli) -> Self {
        Self {
            provider_id: cli.provider.clone(),
            provider_name: None,
            credential_id: cli.credential.clone(),
            credential_name: None,
            model_id: cli.model.clone(),
            reasoning_effort: normalize_cli_reasoning(cli.reasoning.as_deref()),
            workspace_label: None,
            shell_allowed: !cli.no_shell,
        }
    }
}

fn run_projects(
    state: &AppState,
    command: &ProjectsCommand,
    json_output: bool,
) -> Result<(), String> {
    match command {
        ProjectsCommand::List => {
            let projects = state
                .projects
                .lock()
                .map_err(|_| "project registry lock failed".to_string())?
                .list();
            if json_output {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&cli_projects_json(&projects))
                        .map_err(|e| e.to_string())?
                );
            } else if projects.is_empty() {
                println!("No projects registered.");
            } else {
                for project in projects {
                    println!("{}\t{}\t{}", project.name, project.id, project.repo_root);
                }
            }
            Ok(())
        }
        ProjectsCommand::Add(args) => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            let root = args
                .path
                .clone()
                .unwrap_or_else(|| cwd.to_string_lossy().to_string());
            let name = args.name.clone().unwrap_or_else(|| {
                Path::new(&root)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("workspace")
                    .to_string()
            });
            let input = ProjectInput {
                name,
                repo_root: root,
                solution_path: args.solution.clone(),
                uproject_path: None,
                build_command: None,
            };
            let project = state
                .projects
                .lock()
                .map_err(|_| "project registry lock failed".to_string())?
                .add(input)?;
            if json_output {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&project).map_err(|e| e.to_string())?
                );
            } else {
                println!("Added project {} ({})", project.name, project.repo_root);
            }
            Ok(())
        }
    }
}

fn cli_projects_json(projects: &[ProjectSession]) -> serde_json::Value {
    json!(
        projects
            .iter()
            .map(|project| {
                json!({
                    "id": project.id,
                    "name": project.name,
                    "root": project.repo_root,
                    "repoRoot": project.repo_root,
                    "solutionPath": project.solution_path,
                    "uprojectPath": project.uproject_path,
                    "buildCommand": project.build_command,
                    "vsBridgeEndpoint": project.vs_bridge_endpoint,
                    "vsProcessId": project.vs_process_id,
                    "createdAt": project.created_at,
                    "updatedAt": project.updated_at,
                })
            })
            .collect::<Vec<_>>()
    )
}

fn run_models(state: &AppState, command: &ModelsCommand, json_output: bool) -> Result<(), String> {
    match command {
        ModelsCommand::List => {
            let settings_guard = state
                .settings
                .lock()
                .map_err(|_| "settings lock failed".to_string())?;
            let settings = current_settings(&settings_guard);
            if json_output {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&cli_models_json(&settings))
                        .map_err(|e| e.to_string())?
                );
            } else {
                for provider in settings.providers {
                    println!(
                        "{}\t{}\tenabled={}",
                        provider.id, provider.name, provider.enabled
                    );
                    for model in provider.models {
                        println!("  {}\tenabled={}", model.id, model.enabled);
                    }
                }
            }
            Ok(())
        }
    }
}

fn cli_models_json(settings: &AppSettings) -> serde_json::Value {
    json!(
        settings
            .providers
            .iter()
            .map(|provider| {
                json!({
                    "id": provider.id,
                    "type": provider.provider_type,
                    "name": provider.name,
                    "enabled": provider.enabled,
                    "baseUrl": provider.base_url,
                    "baseUrlLocked": provider.base_url_locked,
                    "supportsToolCall": provider.supports_tool_call,
                    "defaultCredentialId": provider.default_credential_id,
                    "defaultModel": provider.default_model,
                    "temperature": provider.temperature,
                    "credentials": provider
                        .credentials
                        .iter()
                        .map(|credential| {
                            json!({
                                "id": credential.id,
                                "name": credential.name,
                                "enabled": credential.enabled,
                            })
                        })
                        .collect::<Vec<_>>(),
                    "models": provider
                        .models
                        .iter()
                        .map(|model| {
                            json!({
                                "id": model.id,
                                "name": model.name,
                                "enabled": model.enabled,
                                "credentialId": model.credential_id,
                                "reasoningMode": model.reasoning_mode,
                                "defaultReasoning": model.default_reasoning,
                                "ownedBy": model.owned_by,
                                "created": model.created,
                            })
                        })
                        .collect::<Vec<_>>(),
                })
            })
            .collect::<Vec<_>>()
    )
}

async fn run_chat(state: &AppState, cli: &Cli, mut session: CliSession) -> Result<(), String> {
    let stdin = io::stdin();
    let stdin_is_terminal = stdin.is_terminal();
    let mut handled_input = false;
    let mut history = Vec::new();
    let mut transcript: Vec<AgentConversationMessage> = Vec::new();
    let mut show_header = true;
    let project = select_project(state, cli.project.as_deref())?;
    session.workspace_label = Some(cli_project_label(&project));
    loop {
        let Some((line, input_header_visible)) =
            read_chat_input(&stdin, CHAT_PROMPT, &session, &mut history, show_header)?
        else {
            break;
        };
        show_header = input_header_visible;
        let task = line.trim();
        if task.is_empty() {
            continue;
        }
        handled_input = true;
        show_header = false;
        match handle_chat_command(state, &stdin, &mut session, cli.project.as_deref(), task)? {
            ChatCommandResult::Exit => break,
            ChatCommandResult::NewSession => {
                transcript.clear();
                if stdin_is_terminal {
                    clear_terminal()?;
                } else {
                    println!("Started a new chat.");
                }
                show_header = true;
                continue;
            }
            ChatCommandResult::Handled => {
                show_header = true;
                continue;
            }
            ChatCommandResult::NotCommand => {}
        }
        let mut run_messages = transcript.clone();
        run_messages.push(cli_conversation_message("user", task));
        let run = run_task(state, cli, &session, task, Some(run_messages)).await?;
        transcript.push(cli_conversation_message("user", task));
        if let Some(final_text) = final_response(&run) {
            let visible_text = cli_display_final_response(&session, &final_text);
            if !visible_text.trim().is_empty() {
                transcript.push(cli_conversation_message("assistant", visible_text.trim()));
            }
        }
        if transcript.len() > CLI_TRANSCRIPT_MAX_MESSAGES {
            let remove_count = transcript.len().saturating_sub(CLI_TRANSCRIPT_MAX_MESSAGES);
            transcript.drain(0..remove_count);
        }
    }
    if !stdin_is_terminal && !handled_input {
        return Err(
            "codeforge received an empty task from stdin. Use codeforge \"<task>\", codeforge run \"<task>\", or pipe a non-empty task."
                .to_string(),
        );
    }
    Ok(())
}

fn cli_conversation_message(role: &str, content: &str) -> AgentConversationMessage {
    AgentConversationMessage {
        role: role.to_string(),
        content: content.to_string(),
        attachments: Vec::new(),
    }
}

struct RawModeGuard;

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let mut stdout = io::stdout();
        let _ = execute!(stdout, DisableBracketedPaste);
        let _ = disable_raw_mode();
    }
}

struct InlineScreenGuard {
    start_row: u16,
}

impl InlineScreenGuard {
    fn enter(header_visible: bool) -> Result<Self, String> {
        let mut stdout = io::stdout();
        let (_, cursor_row) = cursor::position().unwrap_or((0, 0));
        let (_, terminal_rows) = crossterm::terminal::size().unwrap_or((80, 24));
        let reserved_rows = codex_inline_reserved_height(header_visible).min(terminal_rows.max(1));
        let start_row = cursor_row.min(terminal_rows.saturating_sub(reserved_rows));
        execute!(stdout, cursor::Hide).map_err(|e| e.to_string())?;
        Ok(Self { start_row })
    }

    fn start_row(&self) -> u16 {
        self.start_row
    }

    fn set_start_row(&mut self, start_row: u16) {
        self.start_row = start_row;
    }

    fn clear(&self) -> Result<(), String> {
        self.clear_interaction(false)
    }

    fn clear_interaction(&self, header_visible: bool) -> Result<(), String> {
        let mut stdout = io::stdout();
        let start_row = self
            .start_row
            .saturating_add(if header_visible {
                codex_chat_header_height()
            } else {
                0
            });
        queue!(
            stdout,
            ResetColor,
            cursor::MoveTo(0, start_row),
            Clear(ClearType::FromCursorDown)
        )
        .map_err(|e| e.to_string())?;
        stdout.flush().map_err(|e| e.to_string())
    }
}

impl Drop for InlineScreenGuard {
    fn drop(&mut self) {
        let mut stdout = io::stdout();
        let _ = execute!(stdout, cursor::Show);
    }
}

fn read_chat_input(
    stdin: &io::Stdin,
    prompt: &str,
    session: &CliSession,
    history: &mut Vec<String>,
    header_visible: bool,
) -> Result<Option<(String, bool)>, String> {
    if !stdin.is_terminal() {
        return read_stdin_line(stdin).map(|line| line.map(|line| (line, header_visible)));
    }

    read_interactive_chat_input(prompt, session, history, header_visible)
}

fn read_interactive_chat_input(
    prompt: &str,
    session: &CliSession,
    history: &mut Vec<String>,
    mut active_header_visible: bool,
) -> Result<Option<(String, bool)>, String> {
    enable_raw_mode().map_err(|e| e.to_string())?;
    let raw_mode = RawModeGuard;
    execute!(io::stdout(), EnableBracketedPaste).map_err(|e| e.to_string())?;
    let mut inline_screen = InlineScreenGuard::enter(active_header_visible)?;
    let mut line = String::new();
    let mut cursor_index = 0usize;
    let mut selected_command_index = 0usize;
    let mut history_index: Option<usize> = None;
    let mut history_draft = String::new();
    render_chat_input(
        prompt,
        &line,
        cursor_index,
        selected_command_index,
        session,
        inline_screen.start_row(),
        active_header_visible,
        active_header_visible,
    )?;

    loop {
        match event::read().map_err(|e| e.to_string())? {
            Event::Key(KeyEvent {
                code,
                modifiers,
                kind,
                ..
            }) if matches!(kind, KeyEventKind::Press | KeyEventKind::Repeat) => match code {
                KeyCode::Enter => {
                    let submitted = if line.trim() == "/" {
                        line.clone()
                    } else {
                        selected_slash_command(&line, selected_command_index)
                            .map(str::to_string)
                            .unwrap_or_else(|| line.clone())
                    };
                    let should_echo =
                        !submitted.trim().is_empty() && !submitted.trim_start().starts_with('/');
                    inline_screen.clear_interaction(active_header_visible)?;
                    drop(inline_screen);
                    drop(raw_mode);
                    if should_echo {
                        println!("{prompt}{submitted}");
                    }
                    io::stdout().flush().map_err(|e| e.to_string())?;
                    record_chat_history(history, &submitted);
                    return Ok(Some((submitted, active_header_visible)));
                }
                KeyCode::Backspace => {
                    history_index = None;
                    if modifiers.contains(KeyModifiers::CONTROL)
                        || modifiers.contains(KeyModifiers::ALT)
                    {
                        let word_start = previous_word_start(&line, cursor_index);
                        remove_char_range(&mut line, word_start, cursor_index);
                        cursor_index = word_start;
                    } else if cursor_index > 0 {
                        remove_char_at(&mut line, cursor_index - 1);
                        cursor_index = cursor_index.saturating_sub(1);
                    }
                    selected_command_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Up | KeyCode::Char('p') | KeyCode::Char('P')
                    if matches!(code, KeyCode::Up)
                        || modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    if let Some(count) = slash_command_match_count(&line) {
                        selected_command_index = if selected_command_index == 0 {
                            count.saturating_sub(1)
                        } else {
                            selected_command_index.saturating_sub(1)
                        };
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    } else if !history.is_empty() {
                        let next_index = match history_index {
                            Some(index) => index.saturating_sub(1),
                            None => {
                                history_draft = line.clone();
                                history.len().saturating_sub(1)
                            }
                        };
                        history_index = Some(next_index);
                        line = history[next_index].clone();
                        cursor_index = line.chars().count();
                        selected_command_index = 0;
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    }
                }
                KeyCode::Down | KeyCode::Char('n') | KeyCode::Char('N')
                    if matches!(code, KeyCode::Down)
                        || modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    if let Some(count) = slash_command_match_count(&line) {
                        selected_command_index = (selected_command_index + 1) % count.max(1);
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    } else if let Some(index) = history_index {
                        if index + 1 < history.len() {
                            let next_index = index + 1;
                            history_index = Some(next_index);
                            line = history[next_index].clone();
                        } else {
                            history_index = None;
                            line = history_draft.clone();
                            history_draft.clear();
                        }
                        cursor_index = line.chars().count();
                        selected_command_index = 0;
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    }
                }
                KeyCode::PageUp => {
                    if let Some(count) = slash_command_match_count(&line) {
                        let page_size =
                            chat_popup_page_size(inline_screen.start_row(), active_header_visible);
                        selected_command_index = selected_command_index.saturating_sub(page_size);
                        selected_command_index = selected_command_index.min(count.saturating_sub(1));
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    }
                }
                KeyCode::PageDown => {
                    if let Some(count) = slash_command_match_count(&line) {
                        let page_size =
                            chat_popup_page_size(inline_screen.start_row(), active_header_visible);
                        selected_command_index = selected_command_index
                            .saturating_add(page_size)
                            .min(count.saturating_sub(1));
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    }
                }
                KeyCode::Tab => {
                    if let Some(command) = selected_slash_command(&line, selected_command_index) {
                        history_index = None;
                        line.clear();
                        line.push_str(command);
                        cursor_index = line.chars().count();
                        selected_command_index = 0;
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                    }
                }
                KeyCode::Esc => {
                    if line.starts_with('/') {
                        line.clear();
                        cursor_index = 0;
                        selected_command_index = 0;
                        render_chat_input(
                            prompt,
                            &line,
                            cursor_index,
                            selected_command_index,
                            session,
                            inline_screen.start_row(),
                            active_header_visible,
                            false,
                        )?;
                        continue;
                    }
                    line.clear();
                    cursor_index = 0;
                    selected_command_index = 0;
                    history_index = None;
                    history_draft.clear();
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('c') | KeyCode::Char('C')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    inline_screen.clear_interaction(active_header_visible)?;
                    drop(inline_screen);
                    drop(raw_mode);
                    println!();
                    io::stdout().flush().map_err(|e| e.to_string())?;
                    return Ok(None);
                }
                KeyCode::Char('d') | KeyCode::Char('D')
                    if modifiers.contains(KeyModifiers::ALT) =>
                {
                    history_index = None;
                    let delete_end = next_word_delete_end(&line, cursor_index);
                    remove_char_range(&mut line, cursor_index, delete_end);
                    selected_command_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('d') | KeyCode::Char('D')
                    if modifiers.contains(KeyModifiers::CONTROL) && line.is_empty() =>
                {
                    inline_screen.clear_interaction(active_header_visible)?;
                    drop(inline_screen);
                    drop(raw_mode);
                    println!();
                    io::stdout().flush().map_err(|e| e.to_string())?;
                    return Ok(None);
                }
                KeyCode::Char('d') | KeyCode::Char('D')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    history_index = None;
                    if cursor_index < line.chars().count() {
                        remove_char_at(&mut line, cursor_index);
                        selected_command_index = 0;
                    }
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('a') | KeyCode::Char('A')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    cursor_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('e') | KeyCode::Char('E')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    cursor_index = line.chars().count();
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('u') | KeyCode::Char('U')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    history_index = None;
                    remove_char_range(&mut line, 0, cursor_index);
                    cursor_index = 0;
                    selected_command_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('k') | KeyCode::Char('K')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    history_index = None;
                    let end_index = line.chars().count();
                    remove_char_range(&mut line, cursor_index, end_index);
                    selected_command_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char('l') | KeyCode::Char('L')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    history_index = None;
                    history_draft.clear();
                    inline_screen.set_start_row(0);
                    active_header_visible = true;
                    let mut stdout = io::stdout();
                    queue!(
                        stdout,
                        ResetColor,
                        cursor::MoveTo(0, 0),
                        Clear(ClearType::All)
                    )
                    .map_err(|e| e.to_string())?;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        true,
                        true,
                    )?;
                }
                KeyCode::Char('w') | KeyCode::Char('W')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    history_index = None;
                    let word_start = previous_word_start(&line, cursor_index);
                    remove_char_range(&mut line, word_start, cursor_index);
                    cursor_index = word_start;
                    selected_command_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Left => {
                    cursor_index = if modifiers.contains(KeyModifiers::CONTROL)
                        || modifiers.contains(KeyModifiers::ALT)
                    {
                        previous_word_start(&line, cursor_index)
                    } else {
                        cursor_index.saturating_sub(1)
                    };
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Right => {
                    cursor_index = if modifiers.contains(KeyModifiers::CONTROL)
                        || modifiers.contains(KeyModifiers::ALT)
                    {
                        next_word_start(&line, cursor_index)
                    } else {
                        (cursor_index + 1).min(line.chars().count())
                    };
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Home => {
                    if slash_command_match_count(&line).is_some() {
                        selected_command_index = 0;
                    } else {
                        cursor_index = 0;
                    }
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::End => {
                    if let Some(count) = slash_command_match_count(&line) {
                        selected_command_index = count.saturating_sub(1);
                    } else {
                        cursor_index = line.chars().count();
                    }
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Delete => {
                    history_index = None;
                    if modifiers.contains(KeyModifiers::CONTROL) {
                        let delete_end = next_word_delete_end(&line, cursor_index);
                        remove_char_range(&mut line, cursor_index, delete_end);
                        selected_command_index = 0;
                    } else if cursor_index < line.chars().count() {
                        remove_char_at(&mut line, cursor_index);
                        selected_command_index = 0;
                    }
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                KeyCode::Char(ch)
                    if !modifiers.contains(KeyModifiers::CONTROL)
                        && !modifiers.contains(KeyModifiers::ALT) =>
                {
                    if ch == '/' && line == "/" {
                        continue;
                    }
                    history_index = None;
                    let Some(ch) = normalize_typed_char(ch) else {
                        continue;
                    };
                    insert_char_at(&mut line, cursor_index, ch);
                    cursor_index += 1;
                    selected_command_index = 0;
                    render_chat_input(
                        prompt,
                        &line,
                        cursor_index,
                        selected_command_index,
                        session,
                        inline_screen.start_row(),
                        active_header_visible,
                        false,
                    )?;
                }
                _ => {}
            },
            Event::Paste(pasted) => {
                history_index = None;
                let pasted = normalize_pasted_input(&pasted);
                let pasted_len = pasted.chars().count();
                insert_str_at(&mut line, cursor_index, &pasted);
                cursor_index += pasted_len;
                selected_command_index = 0;
                render_chat_input(
                    prompt,
                    &line,
                    cursor_index,
                    selected_command_index,
                    session,
                    inline_screen.start_row(),
                    active_header_visible,
                    false,
                )?;
            }
            Event::Resize(_, _) => {
                render_chat_input(
                    prompt,
                    &line,
                    cursor_index,
                    selected_command_index,
                    session,
                    inline_screen.start_row(),
                    active_header_visible,
                    active_header_visible,
                )?;
            }
            Event::Key(_) => {}
            _ => {}
        }
    }
}

fn render_chat_input(
    prompt: &str,
    line: &str,
    cursor_index: usize,
    selected_command_index: usize,
    session: &CliSession,
    start_row: u16,
    header_visible: bool,
    redraw_header: bool,
) -> Result<(), String> {
    let mut stdout = io::stdout();
    let (cols, rows) = crossterm::terminal::size().map_err(|e| e.to_string())?;
    let rows = rows.saturating_sub(start_row).max(1);
    let header_rows = if header_visible {
        codex_chat_header_height()
    } else {
        0
    };
    let composer_height = codex_composer_height();
    let top_gap = 1u16;
    let popup_lines = if line.starts_with('/') {
        slash_command_popup_lines(line, selected_command_index)
    } else {
        Vec::new()
    };
    let max_popup_rows = rows
        .saturating_sub(header_rows + top_gap + composer_height)
        .max(1) as usize;
    let visible_popup_rows = popup_lines.len().min(max_popup_rows);
    let scroll_start = slash_popup_scroll_start(
        selected_command_index,
        popup_lines.len(),
        visible_popup_rows,
    );
    let visible_lines = popup_lines
        .iter()
        .skip(scroll_start)
        .take(visible_popup_rows)
        .cloned()
        .collect::<Vec<_>>();
    let required_rows = composer_height.saturating_add(visible_lines.len() as u16);
    let preferred_start = header_rows.saturating_add(top_gap);
    let highest_start = rows.saturating_sub(required_rows);
    let composer_start = preferred_start.min(highest_start);
    let prompt_row =
        start_row.saturating_add(composer_start.saturating_add(composer_height / 2));
    let popup_start = start_row.saturating_add(composer_start.saturating_add(composer_height));
    if redraw_header {
        queue!(
            stdout,
            ResetColor,
            cursor::MoveTo(0, start_row),
            Clear(ClearType::FromCursorDown)
        )
        .map_err(|e| e.to_string())?;
        render_codex_chat_header(&mut stdout, cols, session)?;
    } else {
        queue!(
            stdout,
            ResetColor,
            cursor::MoveTo(0, start_row.saturating_add(header_rows)),
            Clear(ClearType::FromCursorDown)
        )
        .map_err(|e| e.to_string())?;
    }

    let (cursor_col, cursor_row) = render_composer_band(
        &mut stdout,
        cols,
        start_row.saturating_add(composer_start),
        composer_height,
        prompt_row,
        prompt,
        line,
        cursor_index,
    )?;
    queue!(stdout, ResetColor, cursor::MoveTo(cursor_col, cursor_row))
        .map_err(|e| e.to_string())?;
    let popup_end = popup_start
        .saturating_add(max_popup_rows as u16)
        .min(start_row.saturating_add(rows));
    for row in popup_start..popup_end {
        queue!(
            stdout,
            ResetColor,
            cursor::MoveTo(0, row),
            Clear(ClearType::CurrentLine)
        )
        .map_err(|e| e.to_string())?;
    }
    let scrollbar_col = cols.saturating_sub(2);
    let scrollbar_thumb =
        popup_scrollbar_thumb(popup_lines.len(), visible_lines.len(), scroll_start);
    for (index, text) in visible_lines.iter().enumerate() {
        queue!(
            stdout,
            ResetColor,
            cursor::MoveTo(0, popup_start + index as u16),
            Clear(ClearType::CurrentLine)
        )
        .map_err(|e| e.to_string())?;
        write!(stdout, "{text}").map_err(|e| e.to_string())?;
        if popup_lines.len() > visible_lines.len() {
            let marker = if Some(index) == scrollbar_thumb {
                "█"
            } else {
                "│"
            };
            queue!(stdout, cursor::MoveTo(scrollbar_col, popup_start + index as u16))
                .map_err(|e| e.to_string())?;
            write!(stdout, "\x1b[2m{marker}\x1b[0m").map_err(|e| e.to_string())?;
        }
    }
    queue!(stdout, cursor::MoveTo(cursor_col, cursor_row)).map_err(|e| e.to_string())?;
    stdout.flush().map_err(|e| e.to_string())
}

fn insert_char_at(text: &mut String, char_index: usize, ch: char) {
    let byte_index = byte_index_for_char(text, char_index);
    text.insert(byte_index, ch);
}

fn insert_str_at(text: &mut String, char_index: usize, value: &str) {
    let byte_index = byte_index_for_char(text, char_index);
    text.insert_str(byte_index, value);
}

fn normalize_pasted_input(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\r' | '\n' | '\t' => ' ',
            _ => ch,
        })
        .collect()
}

fn normalize_typed_char(ch: char) -> Option<char> {
    match ch {
        '\r' | '\n' | '\t' => Some(' '),
        _ if ch.is_control() => None,
        _ => Some(ch),
    }
}

fn remove_char_at(text: &mut String, char_index: usize) {
    let start = byte_index_for_char(text, char_index);
    let end = byte_index_for_char(text, char_index.saturating_add(1));
    if start < end && end <= text.len() {
        text.replace_range(start..end, "");
    }
}

fn remove_char_range(text: &mut String, start_char: usize, end_char: usize) {
    let start = byte_index_for_char(text, start_char);
    let end = byte_index_for_char(text, end_char);
    if start < end && end <= text.len() {
        text.replace_range(start..end, "");
    }
}

fn byte_index_for_char(text: &str, char_index: usize) -> usize {
    text.char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

fn previous_word_start(text: &str, cursor_index: usize) -> usize {
    let chars = text.chars().collect::<Vec<_>>();
    let mut index = cursor_index.min(chars.len());
    while index > 0 && chars[index - 1].is_whitespace() {
        index -= 1;
    }
    while index > 0 && !chars[index - 1].is_whitespace() {
        index -= 1;
    }
    index
}

fn next_word_start(text: &str, cursor_index: usize) -> usize {
    let chars = text.chars().collect::<Vec<_>>();
    let mut index = cursor_index.min(chars.len());
    while index < chars.len() && !chars[index].is_whitespace() {
        index += 1;
    }
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    index
}

fn next_word_delete_end(text: &str, cursor_index: usize) -> usize {
    let chars = text.chars().collect::<Vec<_>>();
    let mut index = cursor_index.min(chars.len());
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    while index < chars.len() && !chars[index].is_whitespace() {
        index += 1;
    }
    index
}

fn record_chat_history(history: &mut Vec<String>, submitted: &str) {
    let submitted = submitted.trim();
    if submitted.is_empty() {
        return;
    }
    if history
        .last()
        .map(|last| last.trim() == submitted)
        .unwrap_or(false)
    {
        return;
    }
    history.push(submitted.to_string());
    if history.len() > 200 {
        history.remove(0);
    }
}

fn codex_chat_header_height() -> u16 {
    11
}

fn codex_composer_height() -> u16 {
    5
}

fn codex_inline_reserved_height(header_visible: bool) -> u16 {
    let header_rows = if header_visible {
        codex_chat_header_height()
    } else {
        0
    };
    let top_gap = 1u16;
    header_rows + top_gap + codex_composer_height()
}

fn render_codex_chat_header(
    stdout: &mut io::Stdout,
    cols: u16,
    session: &CliSession,
) -> Result<(), String> {
    let width = codex_header_width(cols);
    let border = "─".repeat(width.saturating_sub(2));
    writeln!(stdout, "╭{border}╮").map_err(|e| e.to_string())?;
    write_box_line(
        stdout,
        width,
        &format!(">_ CodeForge Codex (v{})", env!("CARGO_PKG_VERSION")),
    )?;
    write_box_line(stdout, width, "")?;
    write_box_line(
        stdout,
        width,
        &format!(
            "model:     {}    /model to change",
            cli_session_model_label(session)
        ),
    )?;
    write_box_line(
        stdout,
        width,
        &format!(
            "{}: {}    /reason to change",
            cli_session_reasoning_field_label(session),
            cli_session_reasoning_label(session)
        ),
    )?;
    write_box_line(
        stdout,
        width,
        &format!("directory: {}", cli_current_directory_label()),
    )?;
    write_box_line(
        stdout,
        width,
        &format!(
            "workspace: {}",
            session.workspace_label.as_deref().unwrap_or("auto")
        ),
    )?;
    writeln!(stdout, "╰{border}╯").map_err(|e| e.to_string())?;
    writeln!(stdout).map_err(|e| e.to_string())?;
    writeln!(stdout, "Tip: Type / to open commands. Type /exit to quit.")
        .map_err(|e| e.to_string())?;
    writeln!(
        stdout,
        "\x1b[33m! Heads up, CodeForge CLI does not track provider quota locally. Run /status for the current selection.\x1b[0m"
    )
    .map_err(|e| e.to_string())
}

fn render_composer_band(
    stdout: &mut io::Stdout,
    cols: u16,
    start_row: u16,
    height: u16,
    prompt_row: u16,
    prompt: &str,
    line: &str,
    cursor_index: usize,
) -> Result<(u16, u16), String> {
    let width = (cols as usize).max(3);
    let inner_width = width.saturating_sub(2).max(1);
    let input = format!("{prompt}{line}");
    let cursor_line_text = line
        .chars()
        .take(cursor_index.min(line.chars().count()))
        .collect::<String>();
    let cursor_prefix = format!("{prompt}{cursor_line_text}");
    let mut wrapped_lines = wrap_display_lines(&input, inner_width);
    let (cursor_line, cursor_width) = wrapped_cursor_position(&cursor_prefix, inner_width);
    while wrapped_lines.len() <= cursor_line {
        wrapped_lines.push(String::new());
    }
    let visible_rows = height.saturating_sub(2).max(1) as usize;
    let scroll_start = list_scroll_start(cursor_line, wrapped_lines.len(), visible_rows);
    let centered_single_line = wrapped_lines.len() == 1 && scroll_start == 0;
    let content_start_row = start_row.saturating_add(1);
    let prompt_row = prompt_row
        .max(content_start_row)
        .min(start_row.saturating_add(height.saturating_sub(2)));
    let display_start_row = if centered_single_line {
        prompt_row
    } else {
        content_start_row
    };
    let border = "─".repeat(width.saturating_sub(2));
    let blank = " ".repeat(inner_width);
    for row in start_row..start_row.saturating_add(height) {
        queue!(
            stdout,
            cursor::MoveTo(0, row),
            Clear(ClearType::CurrentLine)
        )
        .map_err(|e| e.to_string())?;
        if row == start_row {
            write!(stdout, "\x1b[48;5;236m╭{border}╮\x1b[0m").map_err(|e| e.to_string())?;
            continue;
        }
        if row == start_row.saturating_add(height.saturating_sub(1)) {
            write!(stdout, "\x1b[48;5;236m╰{border}╯\x1b[0m").map_err(|e| e.to_string())?;
            continue;
        }
        let row_content = if centered_single_line {
            (row == prompt_row).then(|| wrapped_lines[0].as_str())
        } else {
            let offset = row.saturating_sub(content_start_row) as usize;
            wrapped_lines
                .get(scroll_start.saturating_add(offset))
                .map(String::as_str)
        };
        if let Some(content) = row_content {
            let content = truncate_display_width(content, inner_width);
            let padding = " ".repeat(inner_width.saturating_sub(terminal_display_width(&content)));
            write!(stdout, "\x1b[48;5;236m│{content}{padding}│\x1b[0m")
                .map_err(|e| e.to_string())?;
        } else {
            write!(stdout, "\x1b[48;5;236m│{blank}│\x1b[0m").map_err(|e| e.to_string())?;
        }
    }
    let cursor_visible_offset = cursor_line.saturating_sub(scroll_start) as u16;
    let cursor_row = if centered_single_line {
        prompt_row
    } else {
        display_start_row
            .saturating_add(cursor_visible_offset)
            .min(start_row.saturating_add(height.saturating_sub(2)))
    };
    let cursor_col = cursor_width.saturating_add(1).min(inner_width) as u16;
    Ok((cursor_col, cursor_row))
}

fn write_box_line(stdout: &mut io::Stdout, width: usize, text: &str) -> Result<(), String> {
    let inner_width = width.saturating_sub(2);
    let clipped = truncate_display_width(text, inner_width);
    let padding = " ".repeat(inner_width.saturating_sub(terminal_display_width(&clipped)));
    writeln!(stdout, "│{clipped}{padding}│").map_err(|e| e.to_string())
}

fn codex_header_width(cols: u16) -> usize {
    (cols as usize).max(2).min(78)
}

fn cli_session_model_label(session: &CliSession) -> String {
    session.model_id.as_deref().unwrap_or("auto").to_string()
}

fn cli_session_reasoning_label(session: &CliSession) -> String {
    cli_effective_reasoning_effort(session).unwrap_or_else(|| "default".to_string())
}

fn cli_session_reasoning_field_label(session: &CliSession) -> &'static str {
    if session
        .model_id
        .as_deref()
        .map(|model| model.eq_ignore_ascii_case("MiniMax-M3"))
        .unwrap_or(false)
    {
        "thinking"
    } else {
        "reasoning"
    }
}

fn cli_current_directory_label() -> String {
    std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn truncate_display_width(text: &str, max_width: usize) -> String {
    let mut width = 0usize;
    let mut output = String::new();
    for ch in text.chars() {
        let char_width = terminal_char_width(ch);
        if width.saturating_add(char_width) > max_width {
            break;
        }
        output.push(ch);
        width += char_width;
    }
    output
}

fn wrap_display_lines(text: &str, max_width: usize) -> Vec<String> {
    let max_width = max_width.max(1);
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut width = 0usize;
    for ch in text.chars() {
        let char_width = terminal_char_width(ch).max(1);
        if width > 0 && width.saturating_add(char_width) > max_width {
            lines.push(current);
            current = String::new();
            width = 0;
        }
        current.push(ch);
        width = width.saturating_add(char_width);
    }
    lines.push(current);
    lines
}

fn wrapped_cursor_position(text_before_cursor: &str, max_width: usize) -> (usize, usize) {
    let max_width = max_width.max(1);
    let mut row = 0usize;
    let mut col = 0usize;
    for ch in text_before_cursor.chars() {
        let char_width = terminal_char_width(ch).max(1);
        if col > 0 && col.saturating_add(char_width) > max_width {
            row += 1;
            col = 0;
        }
        col = col.saturating_add(char_width);
        if col >= max_width {
            row += 1;
            col = 0;
        }
    }
    (row, col)
}

fn terminal_display_width(text: &str) -> usize {
    text.chars().map(terminal_char_width).sum()
}

fn pad_display_width(text: &str, width: usize) -> String {
    let clipped = truncate_display_width(text, width);
    let padding = " ".repeat(width.saturating_sub(terminal_display_width(&clipped)));
    format!("{clipped}{padding}")
}

fn terminal_char_width(ch: char) -> usize {
    if ch.is_control() {
        0
    } else if is_wide_terminal_char(ch) {
        2
    } else {
        1
    }
}

fn is_wide_terminal_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x1100..=0x115F
            | 0x2329..=0x232A
            | 0x2E80..=0xA4CF
            | 0xAC00..=0xD7A3
            | 0xF900..=0xFAFF
            | 0xFE10..=0xFE19
            | 0xFE30..=0xFE6F
            | 0xFF00..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x1F300..=0x1FAFF
            | 0x20000..=0x3FFFD
    )
}

async fn run_task(
    state: &AppState,
    cli: &Cli,
    session: &CliSession,
    task: &str,
    messages: Option<Vec<AgentConversationMessage>>,
) -> Result<MockAgentRun, String> {
    let project = select_project(state, cli.project.as_deref())?;
    let settings_guard = state
        .settings
        .lock()
        .map_err(|_| "settings lock failed".to_string())?;
    let settings = current_settings(&settings_guard);
    let input = AgentRunInput {
        project_id: project.id.clone(),
        user_prompt: task.to_string(),
        messages,
        provider_id: session.provider_id.clone(),
        credential_id: session.credential_id.clone(),
        model_id: session.model_id.clone(),
        reasoning_effort: cli_effective_reasoning_effort(session),
        allow_shell: session.shell_allowed,
        assume_yes: cli.yes,
        cli_mode: true,
    };

    let mut terminal_events = Vec::new();
    let run = agent_runner::run_agent(&project, &settings, input, |event| {
        terminal_events.push(event.clone());
        if !cli.json {
            print_trace_event(event, cli.verbose);
        }
    })
    .await?;
    save_trace(&project.repo_root, &run)?;

    if cli.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&cli_json_run_payload(session, &run, &terminal_events)?)
                .map_err(|e| e.to_string())?
        );
    } else if let Some(final_text) = final_response(&run) {
        print_cli_visible_response(session, &final_text);
    } else if let Some(last) = terminal_events
        .last()
        .and_then(|event| event.output_summary.clone())
    {
        print_cli_visible_response(session, &last);
    }
    Ok(run)
}

fn cli_json_run_payload(
    session: &CliSession,
    run: &MockAgentRun,
    terminal_events: &[ToolTraceEvent],
) -> Result<serde_json::Value, String> {
    let mut payload = serde_json::to_value(run).map_err(|error| error.to_string())?;
    let visible_response = final_response(run)
        .map(|text| cli_display_final_response(session, &text))
        .or_else(|| {
            terminal_events
                .last()
                .and_then(|event| event.output_summary.clone())
                .map(|text| cli_display_final_response(session, &text))
        });
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "visibleResponse".to_string(),
            visible_response
                .map(|text| serde_json::Value::String(text.trim().to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
    }
    Ok(payload)
}

fn print_cli_visible_response(session: &CliSession, text: &str) {
    let visible_text = cli_display_final_response(session, text);
    if !visible_text.trim().is_empty() {
        println!("{visible_text}");
        println!();
    } else if cli_should_hide_thinking(session) && find_ascii_case_insensitive(text, "<think>").is_some() {
        println!("\x1b[2mthinking hidden; no visible response\x1b[0m");
        println!();
    }
}

fn cli_display_final_response(session: &CliSession, text: &str) -> String {
    if cli_should_hide_thinking(session) {
        strip_think_blocks(text)
    } else {
        text.to_string()
    }
}

fn cli_effective_reasoning_effort(session: &CliSession) -> Option<String> {
    match session.reasoning_effort.as_deref() {
        Some(value) => Some(value.to_string()),
        None => session
            .model_id
            .as_deref()
            .filter(|model| model.eq_ignore_ascii_case("MiniMax-M3"))
            .map(|_| "off".to_string()),
    }
}

fn hydrate_cli_session_defaults(state: &AppState, session: &mut CliSession) -> Result<(), String> {
    let explicit_selection = session.provider_id.is_some()
        || session.credential_id.is_some()
        || session.model_id.is_some();
    let settings_guard = state
        .settings
        .lock()
        .map_err(|_| "settings lock failed".to_string())?;
    let settings = current_settings(&settings_guard);
    let choices = cli_model_choices(&settings);
    let Some(choice) = choices.into_iter().find(|choice| {
        session
            .provider_id
            .as_deref()
            .map(|provider| provider == choice.provider_id)
            .unwrap_or(true)
            && session
                .credential_id
                .as_deref()
                .map(|credential| choice.credential_id.as_deref() == Some(credential))
                .unwrap_or(true)
            && session
                .model_id
                .as_deref()
                .map(|model| model == choice.model_id)
                .unwrap_or(true)
    }) else {
        if explicit_selection {
            return Err(format!(
                "No enabled model matches provider={}, credential={}, model={}.",
                session.provider_id.as_deref().unwrap_or("auto"),
                session.credential_id.as_deref().unwrap_or("auto"),
                session.model_id.as_deref().unwrap_or("auto")
            ));
        }
        return Ok(());
    };
    apply_cli_choice_to_session(session, &choice);
    session.reasoning_effort =
        normalize_cli_reasoning_for_choice(session.reasoning_effort.as_deref(), &choice);
    if session.reasoning_effort.is_none() && cli_choice_reasoning_mode(&choice) == "toggle" {
        session.reasoning_effort = Some("off".to_string());
    }
    Ok(())
}

fn apply_cli_choice_to_session(session: &mut CliSession, choice: &CliModelChoice) {
    session.provider_id = Some(choice.provider_id.clone());
    session.provider_name = Some(choice.provider_name.clone());
    session.credential_id = choice.credential_id.clone();
    session.credential_name = choice.credential_name.clone();
    session.model_id = Some(choice.model_id.clone());
}

fn normalize_cli_reasoning_for_choice(
    value: Option<&str>,
    choice: &CliModelChoice,
) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("default") {
        return None;
    }
    let value = value.to_ascii_lowercase();
    match cli_choice_reasoning_mode(choice) {
        "toggle" => match value.as_str() {
            "off" | "none" => Some("off".to_string()),
            "on" | "minimal" | "low" | "medium" | "high" | "xhigh" => Some("on".to_string()),
            _ => None,
        },
        "effort" => match value.as_str() {
            "minimal" | "low" | "medium" | "high" | "xhigh" => Some(value),
            "on" => Some("medium".to_string()),
            _ => None,
        },
        _ => None,
    }
}

fn cli_should_hide_thinking(session: &CliSession) -> bool {
    match session.reasoning_effort.as_deref() {
        Some(value) => value.eq_ignore_ascii_case("off") || value.eq_ignore_ascii_case("none"),
        None => session
            .model_id
            .as_deref()
            .map(|model| model.eq_ignore_ascii_case("MiniMax-M3"))
            .unwrap_or(false),
    }
}

fn strip_think_blocks(text: &str) -> String {
    let mut output = String::new();
    let mut remaining = text;
    while let Some(start) = find_ascii_case_insensitive(remaining, "<think>") {
        output.push_str(&remaining[..start]);
        let content_start = start + "<think>".len();
        let after_start = &remaining[content_start..];
        let Some(end) = find_ascii_case_insensitive(after_start, "</think>") else {
            remaining = "";
            break;
        };
        remaining = &after_start[end + "</think>".len()..];
    }
    output.push_str(remaining);
    output
        .trim_start_matches(|ch| ch == '\r' || ch == '\n')
        .to_string()
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

enum ChatCommandResult {
    NotCommand,
    Handled,
    NewSession,
    Exit,
}

fn handle_chat_command(
    state: &AppState,
    stdin: &io::Stdin,
    session: &mut CliSession,
    requested_project: Option<&str>,
    task: &str,
) -> Result<ChatCommandResult, String> {
    match task.trim().to_ascii_lowercase().as_str() {
        "/" => {
            print_slash_commands();
            Ok(ChatCommandResult::Handled)
        }
        "/exit" | "/quit" => {
            Ok(ChatCommandResult::Exit)
        }
        "/new" => Ok(ChatCommandResult::NewSession),
        "/model" | "/models" => {
            choose_cli_model(state, stdin, session)?;
            Ok(ChatCommandResult::Handled)
        }
        "/reason" | "/reasoning" | "/reasion" => {
            choose_cli_reasoning_for_current_model(state, stdin, session)?;
            Ok(ChatCommandResult::Handled)
        }
        "/status" => {
            let project = select_project(state, requested_project)?;
            print_cli_session(session, Some(&project));
            Ok(ChatCommandResult::Handled)
        }
        "/clear" => {
            clear_terminal()?;
            Ok(ChatCommandResult::Handled)
        }
        "/fast"
        | "/ide"
        | "/permissions"
        | "/keymap"
        | "/vim"
        | "/sandbox-add-read-dir"
        | "/experimental" => {
            println!("{} is not implemented yet.", task.trim());
            Ok(ChatCommandResult::Handled)
        }
        "/help" => {
            print_slash_commands();
            Ok(ChatCommandResult::Handled)
        }
        value if value.starts_with('/') => {
            run_slash_command_prefix(state, stdin, session, requested_project, value)
        }
        _ => Ok(ChatCommandResult::NotCommand),
    }
}

fn run_slash_command_prefix(
    state: &AppState,
    stdin: &io::Stdin,
    session: &mut CliSession,
    requested_project: Option<&str>,
    prefix: &str,
) -> Result<ChatCommandResult, String> {
    let matches = slash_commands()
        .iter()
        .filter(|(name, _)| name.starts_with(prefix))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        print_slash_command_matches(prefix);
        return Ok(ChatCommandResult::Handled);
    }

    match matches[0].0 {
        "/model" => {
            choose_cli_model(state, stdin, session)?;
            Ok(ChatCommandResult::Handled)
        }
        "/new" => Ok(ChatCommandResult::NewSession),
        "/reason" => {
            choose_cli_reasoning_for_current_model(state, stdin, session)?;
            Ok(ChatCommandResult::Handled)
        }
        "/status" => {
            let project = select_project(state, requested_project)?;
            print_cli_session(session, Some(&project));
            Ok(ChatCommandResult::Handled)
        }
        "/help" => {
            print_slash_commands();
            Ok(ChatCommandResult::Handled)
        }
        "/clear" => {
            clear_terminal()?;
            Ok(ChatCommandResult::Handled)
        }
        "/exit" | "/quit" => Ok(ChatCommandResult::Exit),
        command => {
            println!("{command} is not implemented yet.");
            Ok(ChatCommandResult::Handled)
        }
    }
}

fn print_slash_commands() {
    println!();
    for (name, description) in slash_commands() {
        println!("{}", slash_command_list_line(name, description));
    }
}

fn print_slash_command_matches(prefix: &str) {
    let mut stdout = io::stdout();
    let _ = write_slash_command_matches(&mut stdout, prefix);
    let _ = stdout.flush();
}

fn clear_terminal() -> Result<(), String> {
    let mut stdout = io::stdout();
    execute!(
        stdout,
        ResetColor,
        cursor::MoveTo(0, 0),
        Clear(ClearType::All)
    )
    .map_err(|e| e.to_string())
}

fn write_slash_command_matches<W: Write>(stdout: &mut W, prefix: &str) -> io::Result<()> {
    for line in slash_command_match_lines(prefix) {
        writeln!(stdout, "{line}")?;
    }
    Ok(())
}

fn slash_command_match_lines(prefix: &str) -> Vec<String> {
    let matches = slash_command_matches(prefix);
    let mut lines = Vec::new();
    if matches.is_empty() {
        let content_width = crossterm::terminal::size()
            .map(|(cols, _)| cols.max(1) as usize)
            .unwrap_or(80);
        lines.push(truncate_display_width(
            &format!("  No command matches `{prefix}`."),
            content_width,
        ));
        lines.push(truncate_display_width(
            "  Type / to show all commands.",
            content_width,
        ));
        return lines;
    }
    for (name, description) in matches {
        lines.push(slash_command_list_line(name, description));
    }
    lines
}

fn slash_command_list_line(name: &str, description: &str) -> String {
    let content_width = crossterm::terminal::size()
        .map(|(cols, _)| cols.max(1) as usize)
        .unwrap_or(80);
    let prefix = format!("  {name:<22} ");
    truncate_display_width(&format!("{prefix}{description}"), content_width)
}

fn slash_command_popup_lines(prefix: &str, selected_index: usize) -> Vec<String> {
    let matches = slash_command_matches(prefix);
    let content_width = crossterm::terminal::size()
        .map(|(cols, _)| cols.saturating_sub(2).max(1) as usize)
        .unwrap_or(78);
    let mut lines = Vec::new();
    if matches.is_empty() {
        lines.push(truncate_display_width(
            &format!("  No command matches `{prefix}`."),
            content_width,
        ));
        lines.push(truncate_display_width(
            "  Type / to show all commands.",
            content_width,
        ));
        return lines;
    }
    for (index, (name, description)) in matches.into_iter().enumerate() {
        let prefix_text = if index == selected_index {
            format!("› {name:<22} ")
        } else {
            format!("  {name:<22} ")
        };
        if index == selected_index {
            let visible_line =
                truncate_display_width(&format!("{prefix_text}{description}"), content_width);
            lines.push(format!("\x1b[36;1m{visible_line}\x1b[0m"));
        } else {
            let prefix_width = terminal_display_width(&prefix_text);
            if prefix_width >= content_width {
                lines.push(truncate_display_width(&prefix_text, content_width));
            } else {
                let description =
                    truncate_display_width(description, content_width.saturating_sub(prefix_width));
                lines.push(format!("{prefix_text}\x1b[2m{description}\x1b[0m"));
            }
        }
    }
    lines
}

fn slash_popup_scroll_start(
    selected_index: usize,
    total_lines: usize,
    visible_rows: usize,
) -> usize {
    list_scroll_start(selected_index, total_lines, visible_rows)
}

fn popup_scrollbar_thumb(
    total_count: usize,
    visible_count: usize,
    scroll_start: usize,
) -> Option<usize> {
    if visible_count == 0 || total_count <= visible_count {
        return None;
    }
    let max_scroll = total_count.saturating_sub(visible_count).max(1);
    Some(scroll_start.saturating_mul(visible_count.saturating_sub(1)) / max_scroll)
}

fn chat_popup_page_size(start_row: u16, header_visible: bool) -> usize {
    let (_, rows) = crossterm::terminal::size().unwrap_or((80, 24));
    let rows = rows.saturating_sub(start_row).max(1);
    let header_rows = if header_visible {
        codex_chat_header_height()
    } else {
        0
    };
    rows.saturating_sub(header_rows + 1 + codex_composer_height())
        .max(1) as usize
}

fn cli_picker_page_size(start_row: u16) -> usize {
    let (_, rows) = crossterm::terminal::size().unwrap_or((80, 24));
    let panel_start = start_row
        .saturating_add(codex_chat_header_height())
        .saturating_add(1)
        .min(rows.saturating_sub(1));
    rows.saturating_sub(panel_start)
        .max(1)
        .saturating_sub(5)
        .max(1) as usize
}

fn list_scroll_start(selected_index: usize, total_count: usize, visible_count: usize) -> usize {
    if visible_count == 0 || total_count <= visible_count || selected_index < visible_count {
        return 0;
    }
    selected_index
        .saturating_add(1)
        .saturating_sub(visible_count)
        .min(total_count.saturating_sub(visible_count))
}

fn slash_command_matches(prefix: &str) -> Vec<(&'static str, &'static str)> {
    slash_commands()
        .iter()
        .copied()
        .filter(|(name, _)| name.starts_with(prefix))
        .collect()
}

fn slash_command_match_count(prefix: &str) -> Option<usize> {
    if !prefix.starts_with('/') {
        return None;
    }
    let count = slash_command_matches(prefix).len();
    (count > 0).then_some(count)
}

fn selected_slash_command(prefix: &str, selected_index: usize) -> Option<&'static str> {
    if !prefix.starts_with('/') {
        return None;
    }
    slash_command_matches(prefix)
        .get(selected_index)
        .map(|(name, _)| *name)
}

fn slash_commands() -> &'static [(&'static str, &'static str)] {
    &[
        ("/new", "start a new chat and clear conversation context"),
        ("/model", "choose what model and reasoning/thinking to use"),
        ("/reason", "choose reasoning/thinking"),
        ("/status", "show current model selection"),
        ("/clear", "clear the terminal"),
        ("/help", "show commands"),
        ("/exit", "quit"),
        ("/quit", "quit"),
    ]
}

fn choose_cli_model(
    state: &AppState,
    stdin: &io::Stdin,
    session: &mut CliSession,
) -> Result<(), String> {
    let settings = {
        let settings_guard = state
            .settings
            .lock()
            .map_err(|_| "settings lock failed".to_string())?;
        current_settings(&settings_guard)
    };
    let choices = cli_model_choices(&settings);
    if choices.is_empty() {
        println!("No enabled models. Configure providers and models in CodeForge settings first.");
        return Ok(());
    }

    if stdin.is_terminal() {
        let items = choices
            .iter()
            .map(|choice| CliPickerItem {
                label: cli_model_display_name(choice),
                description: cli_model_description(choice),
            })
            .collect::<Vec<_>>();
        let current_index = choices
            .iter()
            .enumerate()
            .find_map(|(index, choice)| {
                cli_choice_is_current(session, choice, index).then_some(index)
            })
            .unwrap_or(0);
        let Some(index) = run_cli_picker(
            session,
            "Select Model and Effort",
            "Models are loaded from the shared CodeForge settings.",
            &items,
            current_index,
        )? else {
            return Ok(());
        };
        let choice = &choices[index];
        apply_cli_choice_to_session(session, choice);
        return choose_cli_reasoning_for_choice(stdin, session, choice);
    }

    println!();
    println!("  Select Model and Effort");
    println!("  Models are loaded from the shared CodeForge settings.");
    println!();
    for (index, choice) in choices.iter().enumerate() {
        let marker = if cli_choice_is_current(session, choice, index) {
            "›"
        } else {
            " "
        };
        let current = if cli_choice_is_current(session, choice, index) {
            " (current)"
        } else {
            ""
        };
        println!(
            "{marker} {}. {}{}    {}",
            index + 1,
            cli_model_display_name(choice),
            current,
            cli_model_description(choice)
        );
    }
    println!();
    println!("  Press enter to keep current or type a number.");

    let Some(index) = read_number(stdin, "› ", choices.len())? else {
        return Ok(());
    };
    let choice = &choices[index];
    apply_cli_choice_to_session(session, choice);
    choose_cli_reasoning_for_choice(stdin, session, choice)
}

fn choose_cli_reasoning_for_choice(
    stdin: &io::Stdin,
    session: &mut CliSession,
    choice: &CliModelChoice,
) -> Result<(), String> {
    match cli_choice_reasoning_mode(choice) {
        "toggle" => choose_cli_thinking_toggle(stdin, session, choice.default_reasoning.as_str()),
        "effort" => choose_cli_reasoning(stdin, session),
        _ => {
            session.reasoning_effort = None;
            Ok(())
        }
    }
}

fn cli_choice_reasoning_mode(choice: &CliModelChoice) -> &str {
    if choice.model_id.eq_ignore_ascii_case("MiniMax-M3")
        || choice.model_name.eq_ignore_ascii_case("MiniMax-M3")
    {
        "toggle"
    } else {
        choice.reasoning_mode.trim()
    }
}

fn choose_cli_thinking_toggle(
    stdin: &io::Stdin,
    session: &mut CliSession,
    _default_reasoning: &str,
) -> Result<(), String> {
    let choices = [("off", "Off"), ("on", "On")];
    let current = session
        .reasoning_effort
        .as_deref()
        .unwrap_or("off")
        .trim();
    if stdin.is_terminal() {
        let items = choices
            .iter()
            .map(|(value, label)| CliPickerItem {
                label: (*label).to_string(),
                description: if *value == "on" {
                    "Enable MiniMax-M3 thinking output.".to_string()
                } else {
                    "Do not request thinking output.".to_string()
                },
            })
            .collect::<Vec<_>>();
        let current_index = choices
            .iter()
            .position(|(value, _)| *value == current)
            .unwrap_or(0);
        let Some(index) = run_cli_picker(session, "Select Thinking", "", &items, current_index)?
        else {
            return Ok(());
        };
        session.reasoning_effort = Some(choices[index].0.to_string());
        return Ok(());
    }

    println!();
    println!("  Select Thinking");
    println!();
    for (index, (value, label)) in choices.iter().enumerate() {
        let marker = if *value == current { "›" } else { " " };
        let current_label = if *value == current { " (current)" } else { "" };
        println!("{marker} {}. {}{}", index + 1, label, current_label);
    }
    println!();
    println!("  Press enter to keep current or type a number.");
    let Some(line) = read_prompt(stdin, "› ")? else {
        return Ok(());
    };
    if line.trim().is_empty() {
        return Ok(());
    }
    let selected = match line.trim() {
        "1" => "off",
        "2" => "on",
        value if value.eq_ignore_ascii_case("off") => "off",
        value if value.eq_ignore_ascii_case("on") => "on",
        value => return Err(format!("Unknown thinking option: {value}")),
    };
    session.reasoning_effort = Some(selected.to_string());
    Ok(())
}

fn choose_cli_reasoning_for_current_model(
    state: &AppState,
    stdin: &io::Stdin,
    session: &mut CliSession,
) -> Result<(), String> {
    let settings = {
        let settings_guard = state
            .settings
            .lock()
            .map_err(|_| "settings lock failed".to_string())?;
        current_settings(&settings_guard)
    };
    let current_choice = cli_model_choices(&settings)
        .into_iter()
        .find(|choice| {
            session.provider_id.as_deref() == Some(choice.provider_id.as_str())
                && session.credential_id.as_deref() == choice.credential_id.as_deref()
                && session.model_id.as_deref() == Some(choice.model_id.as_str())
        })
        .or_else(|| cli_model_choices(&settings).into_iter().next());
    if let Some(choice) = current_choice {
        choose_cli_reasoning_for_choice(stdin, session, &choice)
    } else {
        choose_cli_reasoning(stdin, session)
    }
}

fn choose_cli_reasoning(stdin: &io::Stdin, session: &mut CliSession) -> Result<(), String> {
    let choices = reasoning_choices();
    let current = session.reasoning_effort.as_deref().unwrap_or("default");
    if stdin.is_terminal() {
        let items = choices
            .iter()
            .map(|(value, label)| CliPickerItem {
                label: (*label).to_string(),
                description: reasoning_description(value).to_string(),
            })
            .collect::<Vec<_>>();
        let current_index = choices
            .iter()
            .position(|(value, _)| *value == current)
            .unwrap_or(0);
        let Some(index) =
            run_cli_picker(session, "Select Reasoning Effort", "", &items, current_index)?
        else {
            return Ok(());
        };
        session.reasoning_effort = normalize_cli_reasoning(Some(choices[index].0));
        return Ok(());
    }

    println!();
    println!("  Select Reasoning Effort");
    println!();
    for (index, (value, label)) in choices.iter().enumerate() {
        let marker = if *value == current { "›" } else { " " };
        let current_label = if *value == current { " (current)" } else { "" };
        println!(
            "{marker} {}. {}{}    {}",
            index + 1,
            label,
            current_label,
            reasoning_description(value)
        );
    }
    println!();
    println!("  Press enter to keep current or type a number.");
    let Some(line) = read_prompt(stdin, "› ")? else {
        return Ok(());
    };
    if line.trim().is_empty() {
        return Ok(());
    }
    let selected = parse_reasoning_choice(&line, choices)
        .ok_or_else(|| format!("Unknown reasoning effort: {}", line.trim()))?;
    session.reasoning_effort = normalize_cli_reasoning(Some(selected));
    Ok(())
}

fn run_cli_picker(
    session: &CliSession,
    title: &str,
    subtitle: &str,
    items: &[CliPickerItem],
    current_index: usize,
) -> Result<Option<usize>, String> {
    if items.is_empty() {
        return Ok(None);
    }

    enable_raw_mode().map_err(|e| e.to_string())?;
    let raw_mode = RawModeGuard;
    let inline_screen = InlineScreenGuard::enter(true)?;
    let mut selected_index = current_index.min(items.len().saturating_sub(1));
    render_cli_picker(
        session,
        title,
        subtitle,
        items,
        selected_index,
        current_index,
        inline_screen.start_row(),
    )?;

    loop {
        match event::read().map_err(|e| e.to_string())? {
            Event::Key(KeyEvent {
                code,
                kind,
                modifiers,
                ..
            }) if matches!(kind, KeyEventKind::Press | KeyEventKind::Repeat) => match code {
                KeyCode::Up | KeyCode::Char('p') | KeyCode::Char('P')
                    if matches!(code, KeyCode::Up)
                        || modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    selected_index = if selected_index == 0 {
                        items.len().saturating_sub(1)
                    } else {
                        selected_index.saturating_sub(1)
                    };
                    render_cli_picker(
                        session,
                        title,
                        subtitle,
                        items,
                        selected_index,
                        current_index,
                        inline_screen.start_row(),
                    )?;
                }
                KeyCode::Down | KeyCode::Char('n') | KeyCode::Char('N')
                    if matches!(code, KeyCode::Down)
                        || modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    selected_index = (selected_index + 1) % items.len();
                    render_cli_picker(
                        session,
                        title,
                        subtitle,
                        items,
                        selected_index,
                        current_index,
                        inline_screen.start_row(),
                    )?;
                }
                KeyCode::PageUp => {
                    let page_size = cli_picker_page_size(inline_screen.start_row());
                    selected_index = selected_index.saturating_sub(page_size);
                    render_cli_picker(
                        session,
                        title,
                        subtitle,
                        items,
                        selected_index,
                        current_index,
                        inline_screen.start_row(),
                    )?;
                }
                KeyCode::PageDown => {
                    let page_size = cli_picker_page_size(inline_screen.start_row());
                    selected_index = selected_index
                        .saturating_add(page_size)
                        .min(items.len().saturating_sub(1));
                    render_cli_picker(
                        session,
                        title,
                        subtitle,
                        items,
                        selected_index,
                        current_index,
                        inline_screen.start_row(),
                    )?;
                }
                KeyCode::Home => {
                    selected_index = 0;
                    render_cli_picker(
                        session,
                        title,
                        subtitle,
                        items,
                        selected_index,
                        current_index,
                        inline_screen.start_row(),
                    )?;
                }
                KeyCode::End => {
                    selected_index = items.len().saturating_sub(1);
                    render_cli_picker(
                        session,
                        title,
                        subtitle,
                        items,
                        selected_index,
                        current_index,
                        inline_screen.start_row(),
                    )?;
                }
                KeyCode::Char(ch)
                    if ch.is_ascii_digit()
                        && !modifiers.contains(KeyModifiers::CONTROL)
                        && !modifiers.contains(KeyModifiers::ALT) =>
                {
                    let Some(digit) = ch.to_digit(10) else {
                        continue;
                    };
                    let Some(index) = (digit as usize).checked_sub(1) else {
                        continue;
                    };
                    if index < items.len() {
                        inline_screen.clear()?;
                        drop(inline_screen);
                        drop(raw_mode);
                        return Ok(Some(index));
                    }
                }
                KeyCode::Enter => {
                    inline_screen.clear()?;
                    drop(inline_screen);
                    drop(raw_mode);
                    return Ok(Some(selected_index));
                }
                KeyCode::Esc => {
                    inline_screen.clear()?;
                    drop(inline_screen);
                    drop(raw_mode);
                    return Ok(None);
                }
                KeyCode::Char('c') | KeyCode::Char('C')
                    if modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    inline_screen.clear()?;
                    drop(inline_screen);
                    drop(raw_mode);
                    return Ok(None);
                }
                _ => {}
            },
            Event::Key(_) => {}
            _ => {}
        }
    }
}

fn render_cli_picker(
    session: &CliSession,
    title: &str,
    subtitle: &str,
    items: &[CliPickerItem],
    selected_index: usize,
    current_index: usize,
    start_row: u16,
) -> Result<(), String> {
    let mut stdout = io::stdout();
    let (cols, rows) = crossterm::terminal::size().map_err(|e| e.to_string())?;
    let width = cols.max(1) as usize;
    let panel_start = start_row
        .saturating_add(codex_chat_header_height())
        .saturating_add(1)
        .min(rows.saturating_sub(1));
    let available_panel_rows = rows.saturating_sub(panel_start).max(1);
    let max_items = available_panel_rows.saturating_sub(5).max(1) as usize;
    let visible_count = items.len().min(max_items);
    let scroll_start = list_scroll_start(selected_index, items.len(), visible_count);
    let scrollbar_col = cols.saturating_sub(2);
    let scrollbar_thumb = popup_scrollbar_thumb(items.len(), visible_count, scroll_start);
    let panel_height = (4 + visible_count as u16).min(available_panel_rows);
    queue!(
        stdout,
        cursor::MoveTo(0, start_row),
        Clear(ClearType::FromCursorDown)
    )
    .map_err(|e| e.to_string())?;
    render_codex_chat_header(&mut stdout, cols, session)?;
    render_panel_background(&mut stdout, cols, panel_start, panel_height)?;

    queue!(stdout, cursor::MoveTo(2, panel_start + 1)).map_err(|e| e.to_string())?;
    write!(
        stdout,
        "\x1b[48;5;236m\x1b[1m{}\x1b[0m",
        truncate_display_width(title, width.saturating_sub(4))
    )
    .map_err(|e| e.to_string())?;
    if !subtitle.trim().is_empty() && panel_height > 2 {
        queue!(stdout, cursor::MoveTo(2, panel_start + 2)).map_err(|e| e.to_string())?;
        write!(
            stdout,
            "\x1b[48;5;236m\x1b[2m{}\x1b[0m",
            truncate_display_width(subtitle, width.saturating_sub(4))
        )
        .map_err(|e| e.to_string())?;
    }

    for (index, item) in items
        .iter()
        .enumerate()
        .skip(scroll_start)
        .take(visible_count)
    {
        let row_offset = index.saturating_sub(scroll_start);
        let row = panel_start + 4 + row_offset as u16;
        if row >= rows {
            break;
        }
        let marker = if index == selected_index { "›" } else { " " };
        let current = if index == current_index {
            " (current)"
        } else {
            ""
        };
        let label = pad_display_width(
            &format!("{marker} {}. {}{}", index + 1, item.label, current),
            28,
        );
        let description = truncate_display_width(&item.description, width.saturating_sub(34));
        queue!(
            stdout,
            cursor::MoveTo(0, row),
            Clear(ClearType::CurrentLine)
        )
        .map_err(|e| e.to_string())?;
        if index == selected_index {
            write!(
                stdout,
                "\x1b[48;5;236m\x1b[36;1m{}  {}\x1b[0m",
                label, description
            )
            .map_err(|e| e.to_string())?;
        } else {
            write!(
                stdout,
                "\x1b[48;5;236m{}  \x1b[2m{}\x1b[0m",
                label, description
            )
            .map_err(|e| e.to_string())?;
        }
        if items.len() > visible_count {
            let marker = if Some(row_offset) == scrollbar_thumb {
                "█"
            } else {
                "│"
            };
            queue!(stdout, cursor::MoveTo(scrollbar_col, row)).map_err(|e| e.to_string())?;
            write!(stdout, "\x1b[48;5;236m\x1b[2m{marker}\x1b[0m")
                .map_err(|e| e.to_string())?;
        }
    }

    let footer_row = panel_start
        .saturating_add(panel_height)
        .min(rows.saturating_sub(1));
    queue!(
        stdout,
        cursor::MoveTo(0, footer_row),
        Clear(ClearType::CurrentLine)
    )
    .map_err(|e| e.to_string())?;
    write!(
        stdout,
        "  \x1b[2mPress enter to confirm or esc to go back\x1b[0m"
    )
    .map_err(|e| e.to_string())?;
    queue!(stdout, ResetColor, cursor::MoveTo(0, footer_row)).map_err(|e| e.to_string())?;
    stdout.flush().map_err(|e| e.to_string())
}

fn render_panel_background(
    stdout: &mut io::Stdout,
    cols: u16,
    start_row: u16,
    height: u16,
) -> Result<(), String> {
    let blank = " ".repeat(cols.max(1) as usize);
    for row in start_row..start_row.saturating_add(height) {
        queue!(
            stdout,
            cursor::MoveTo(0, row),
            Clear(ClearType::CurrentLine)
        )
        .map_err(|e| e.to_string())?;
        write!(stdout, "\x1b[48;5;236m{blank}\x1b[0m").map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn cli_choice_is_current(session: &CliSession, choice: &CliModelChoice, index: usize) -> bool {
    if session.provider_id.is_none() && session.model_id.is_none() {
        return index == 0;
    }
    session.provider_id.as_deref() == Some(choice.provider_id.as_str())
        && session.credential_id.as_deref() == choice.credential_id.as_deref()
        && session.model_id.as_deref() == Some(choice.model_id.as_str())
}

fn cli_model_display_name(choice: &CliModelChoice) -> String {
    choice.model_name.clone()
}

fn cli_model_description(choice: &CliModelChoice) -> String {
    let source = match choice.credential_name.as_deref() {
        Some(credential) if !credential.trim().is_empty() => {
            format!("{} / {}", choice.provider_name, credential)
        }
        _ => choice.provider_name.clone(),
    };
    match choice.model_id.as_str() {
        "gpt-5.5" => "Frontier model for complex coding, research, and real-world work.".to_string(),
        "gpt-5.4" => "Strong model for everyday coding.".to_string(),
        "gpt-5.4-mini" => {
            "Small, fast, and cost-efficient model for simpler coding tasks.".to_string()
        }
        "gpt-5.3-codex-spark" => "Ultra-fast coding model.".to_string(),
        "default" if choice.provider_id == "codex-cli" => {
            "Use the model configured by Codex CLI.".to_string()
        }
        _ if choice.provider_id == "codex-cli" => "Codex CLI model.".to_string(),
        _ => format!("Configured in {source}."),
    }
}

fn reasoning_description(value: &str) -> &'static str {
    match value {
        "default" => "Use the model/provider default.",
        "minimal" => "Fastest responses with minimal reasoning.",
        "low" => "Light reasoning for simple edits.",
        "medium" => "Balanced reasoning for normal coding work.",
        "high" => "More reasoning for harder bugs and design work.",
        "xhigh" => "Maximum reasoning for complex debugging and architecture.",
        _ => "",
    }
}

fn print_cli_session(session: &CliSession, project: Option<&ProjectSession>) {
    println!();
    println!("  Current selection");
    println!("  model:     {}", cli_session_model_label(session));
    println!("  directory: {}", cli_current_directory_label());
    if let Some(project) = project {
        println!("  workspace: {}", cli_project_label(project));
    }
    println!("  provider:  {}", cli_session_provider_label(session));
    if let Some(credential) = session.credential_id.as_deref() {
        println!(
            "  key:       {}",
            cli_session_credential_label(session, credential)
        );
    }
    println!(
        "  shell:     {}",
        if session.shell_allowed {
            "allowed"
        } else {
            "disabled"
        }
    );
    let reasoning = cli_effective_reasoning_effort(session);
    println!(
        "  {}: {}",
        cli_session_reasoning_field_label(session),
        reasoning.as_deref().unwrap_or("default")
    );
}

fn print_cli_session_json(
    session: &CliSession,
    project: Option<&ProjectSession>,
) -> Result<(), String> {
    let reasoning = cli_effective_reasoning_effort(session).unwrap_or_else(|| "default".to_string());
    let credential = session.credential_id.as_deref().map(|credential| {
        json!({
            "id": mask_cli_status_value(credential),
            "name": session.credential_name,
            "label": cli_session_credential_label(session, credential),
        })
    });
    let workspace = project.map(|project| {
        json!({
            "id": project.id,
            "name": project.name,
            "root": cli_display_path_text(&project.repo_root),
            "source": cli_project_source(project),
        })
    });
    let payload = json!({
        "app": "codeforge",
        "surface": "cli",
        "version": env!("CARGO_PKG_VERSION"),
        "model": cli_session_model_label(session),
        "directory": cli_current_directory_label(),
        "workspace": workspace,
        "shell": {
            "allowed": session.shell_allowed,
        },
        "provider": {
            "id": session.provider_id,
            "name": session.provider_name,
            "label": cli_session_provider_label(session),
        },
        "credential": credential,
        "reasoning": {
            "field": cli_session_reasoning_field_label(session),
            "value": reasoning,
        },
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn cli_project_label(project: &ProjectSession) -> String {
    let repo_root = cli_display_path_text(&project.repo_root);
    let label = if project.name.trim().is_empty() || project.name == project.repo_root {
        repo_root
    } else {
        format!("{} ({})", project.name, repo_root)
    };
    if project.id == "cli-current-directory" {
        format!("{label} [current directory]")
    } else if project.id == "cli-explicit-path" {
        format!("{label} [explicit path]")
    } else {
        label
    }
}

fn cli_project_source(project: &ProjectSession) -> &'static str {
    match project.id.as_str() {
        "cli-current-directory" => "currentDirectory",
        "cli-explicit-path" => "explicitPath",
        _ => "registered",
    }
}

fn cli_display_path_text(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

fn cli_session_provider_label(session: &CliSession) -> String {
    match (
        session.provider_name.as_deref(),
        session.provider_id.as_deref(),
    ) {
        (Some(name), Some(id)) if !name.trim().is_empty() && name != id => {
            format!("{name} ({id})")
        }
        (Some(name), _) if !name.trim().is_empty() => name.to_string(),
        (_, Some(id)) => id.to_string(),
        _ => "auto".to_string(),
    }
}

fn cli_session_credential_label(session: &CliSession, credential_id: &str) -> String {
    match session.credential_name.as_deref() {
        Some(name) if !name.trim().is_empty() && name != credential_id => {
            format!("{} ({})", name, mask_cli_status_value(credential_id))
        }
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => mask_cli_status_value(credential_id),
    }
}

fn mask_cli_status_value(value: &str) -> String {
    let value = value.trim();
    if value.len() <= 8 || value.starts_with("key-") {
        return value.to_string();
    }
    let prefix = value.chars().take(4).collect::<String>();
    let suffix = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{prefix}...{suffix}")
}

fn cli_model_choices(settings: &AppSettings) -> Vec<CliModelChoice> {
    settings
        .providers
        .iter()
        .filter(|provider| provider.enabled || provider.models.iter().any(|model| model.enabled))
        .flat_map(provider_model_choices)
        .filter(|choice| !(choice.provider_id == "codex-cli" && choice.model_id == "default"))
        .collect()
}

fn provider_model_choices(provider: &ProviderConfig) -> Vec<CliModelChoice> {
    if !provider_uses_credentials(provider) {
        let enabled_models = provider
            .models
            .iter()
            .filter(|model| model.enabled)
            .cloned()
            .collect::<Vec<_>>();
        if enabled_models.is_empty() {
            return (!provider.default_model.trim().is_empty())
                .then(|| CliModelChoice {
                    provider_id: provider.id.clone(),
                    provider_name: provider.name.clone(),
                    credential_id: None,
                    credential_name: None,
                    model_id: provider.default_model.clone(),
                    model_name: provider.default_model.clone(),
                    reasoning_mode: "effort".to_string(),
                    default_reasoning: "medium".to_string(),
                })
                .into_iter()
                .collect();
        }
        return enabled_models
            .into_iter()
            .map(|model| CliModelChoice {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                credential_id: None,
                credential_name: None,
                model_id: model.id,
                model_name: model.name,
                reasoning_mode: model.reasoning_mode,
                default_reasoning: model.default_reasoning,
            })
            .collect();
    }

    provider
        .credentials
        .iter()
        .filter(|credential| credential.enabled)
        .flat_map(|credential| credential_model_choices(provider, credential))
        .collect()
}

fn credential_model_choices(
    provider: &ProviderConfig,
    credential: &ProviderCredential,
) -> Vec<CliModelChoice> {
    provider
        .models
        .iter()
        .filter(|model| {
            model.enabled
                && (model.credential_id.trim().is_empty() || model.credential_id == credential.id)
        })
        .map(|model| CliModelChoice {
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            credential_id: Some(credential.id.clone()),
            credential_name: Some(credential.name.clone()),
            model_id: model.id.clone(),
            model_name: model.name.clone(),
            reasoning_mode: model.reasoning_mode.clone(),
            default_reasoning: model.default_reasoning.clone(),
        })
        .collect()
}

fn provider_uses_credentials(provider: &ProviderConfig) -> bool {
    provider.provider_type != "codex-cli" && provider.provider_type != "ollama"
}

fn reasoning_choices() -> &'static [(&'static str, &'static str)] {
    &[
        ("default", "Default"),
        ("minimal", "Minimal"),
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
        ("xhigh", "XHigh"),
    ]
}

fn parse_reasoning_choice<'a>(
    line: &str,
    choices: &'a [(&'static str, &'static str)],
) -> Option<&'a str> {
    let trimmed = line.trim();
    if let Ok(index) = trimmed.parse::<usize>() {
        return choices.get(index.checked_sub(1)?).map(|choice| choice.0);
    }
    choices
        .iter()
        .find(|(value, label)| {
            value.eq_ignore_ascii_case(trimmed) || label.eq_ignore_ascii_case(trimmed)
        })
        .map(|choice| choice.0)
}

fn normalize_cli_reasoning(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("default") {
        return None;
    }
    if value.eq_ignore_ascii_case("none") {
        return Some("off".to_string());
    }
    Some(value.to_ascii_lowercase())
}

fn read_number(stdin: &io::Stdin, prompt: &str, max: usize) -> Result<Option<usize>, String> {
    let Some(line) = read_prompt(stdin, prompt)? else {
        return Ok(None);
    };
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let number = trimmed
        .parse::<usize>()
        .map_err(|_| format!("Expected a number from 1 to {max}"))?;
    if number == 0 || number > max {
        return Err(format!("Expected a number from 1 to {max}"));
    }
    Ok(Some(number - 1))
}

fn read_prompt(stdin: &io::Stdin, prompt: &str) -> Result<Option<String>, String> {
    print!("{prompt}");
    io::stdout().flush().map_err(|e| e.to_string())?;
    read_stdin_line(stdin)
}

fn read_stdin_line(stdin: &io::Stdin) -> Result<Option<String>, String> {
    let mut line = String::new();
    let read = stdin.read_line(&mut line).map_err(|e| e.to_string())?;
    if read == 0 {
        return Ok(None);
    }
    Ok(Some(line.trim().to_string()))
}

fn print_trace_event(event: &ToolTraceEvent, verbose: bool) {
    match event.event_type {
        TraceEventType::ToolCall => {
            let name = event.tool_name.as_deref().unwrap_or("tool");
            let args = event.output_summary.as_deref().unwrap_or("");
            println!("[tool:start] {name} {args}");
        }
        TraceEventType::ToolResult | TraceEventType::Error => {
            let Some(name) = event.tool_name.as_deref() else {
                return;
            };
            let status = event
                .output
                .as_ref()
                .and_then(|value| value.get("status"))
                .and_then(|value| value.as_str())
                .unwrap_or("ok");
            let elapsed = event.duration_ms.unwrap_or(0);
            match status {
                "ok" => println!("[tool:ok] {name} {elapsed}"),
                "timeout" => println!("[tool:timeout] {name} {elapsed}"),
                _ => {
                    let message = event
                        .output
                        .as_ref()
                        .and_then(|value| value.get("error"))
                        .and_then(|value| value.as_str())
                        .or(event.output_summary.as_deref())
                        .unwrap_or("tool failed");
                    println!("[tool:error] {name} {message}");
                }
            }
        }
        _ if verbose => println!("[trace] {}", event.title),
        _ => {}
    }
}

fn select_project(state: &AppState, requested: Option<&str>) -> Result<ProjectSession, String> {
    let projects = state
        .projects
        .lock()
        .map_err(|_| "project registry lock failed".to_string())?
        .list();
    if let Some(value) = requested.filter(|value| !value.trim().is_empty()) {
        let normalized = PathBuf::from(value).canonicalize().ok();
        if let Some(project) = projects.into_iter().find(|project| {
                project.id == value
                    || project.name == value
                    || normalized
                        .as_ref()
                        .map(|path| {
                            Path::new(&project.repo_root).canonicalize().ok().as_ref() == Some(path)
                        })
                        .unwrap_or(false)
            }) {
            return Ok(project);
        }
        if let Some(path) = normalized.as_deref() {
            return Ok(cli_project_from_explicit_path(path));
        }
        return Err(format!("Project not found: {value}"));
    }
    let cwd = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if let Some(project) = projects
        .iter()
        .find(|project| Path::new(&project.repo_root).canonicalize().ok().as_ref() == Some(&cwd))
        .cloned()
    {
        return Ok(project);
    }
    Ok(cli_project_from_path(&cwd))
}

fn cli_project_from_path(root: &Path) -> ProjectSession {
    let repo_root = cli_display_path_text(&root.display().to_string());
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("workspace")
        .to_string();
    let now = Utc::now().to_rfc3339();
    ProjectSession {
        id: "cli-current-directory".to_string(),
        name,
        repo_root,
        solution_path: None,
        uproject_path: None,
        build_command: None,
        vs_process_id: None,
        vs_bridge_endpoint: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn cli_project_from_explicit_path(root: &Path) -> ProjectSession {
    let mut project = cli_project_from_path(root);
    project.id = "cli-explicit-path".to_string();
    project
}

fn final_response(run: &MockAgentRun) -> Option<String> {
    run.traces.iter().rev().find_map(|event| {
        if matches!(
            event.event_type,
            TraceEventType::FinalResponse | TraceEventType::ModelMessage
        ) {
            event.output_summary.clone().or_else(|| {
                event
                    .output
                    .as_ref()
                    .and_then(|value| value.get("message"))
                    .and_then(|value| value.as_str())
                    .map(ToString::to_string)
            })
        } else {
            None
        }
    })
}

fn save_trace(repo_root: &str, run: &MockAgentRun) -> Result<(), String> {
    let dir = Path::new(repo_root).join(".codeforge").join("traces");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("trace directory create failed {}: {e}", dir.display()))?;
    let file = dir.join(format!("{}.json", Utc::now().format("%Y%m%dT%H%M%S%.3fZ")));
    let payload = json!({ "savedAt": Utc::now(), "run": run });
    fs::write(
        &file,
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("trace write failed {}: {e}", file.display()))
}
