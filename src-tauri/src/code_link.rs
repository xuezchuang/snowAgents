use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::path_utils::normalize_display_path;
use crate::project_registry::ProjectSession;
use crate::tool_trace::ToolTraceEvent;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub path: String,
    pub line: u32,
    pub column: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeLinkResult {
    pub resolved_path: String,
    pub line: u32,
    pub column: Option<u32>,
    pub bridge_called: bool,
    pub fallback_started_vs: bool,
    pub message: String,
    pub trace_event: Option<ToolTraceEvent>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VsBridgeOpenFileResponse {
    ok: Option<bool>,
    message: Option<String>,
}

pub fn parse_code_link(
    project: &ProjectSession,
    raw_link: &str,
) -> Result<OpenFilePayload, String> {
    let cleaned = raw_link
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .trim_matches('\'');
    let (path_part, line, column) = split_code_link(cleaned)?;
    let path = resolve_path(&project.repo_root, path_part)?;

    Ok(OpenFilePayload { path, line, column })
}

pub async fn call_vs_open_file(endpoint: &str, payload: &OpenFilePayload) -> Result<(), String> {
    let url = format!("{}/openFile", endpoint.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(&url)
        .json(payload)
        .send()
        .await
        .map_err(|error| {
            format!(
                "VS Bridge openFile failed. endpoint={endpoint}; status=network_error; error={error}"
            )
        })?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "VS Bridge openFile failed. endpoint={endpoint}; status={}; error={}",
            status.as_u16(),
            body
        ));
    }

    if let Ok(parsed) = serde_json::from_str::<VsBridgeOpenFileResponse>(&body) {
        if parsed.ok == Some(false) {
            return Err(format!(
                "VS Bridge openFile failed. endpoint={endpoint}; status={}; error={}",
                status.as_u16(),
                parsed
                    .message
                    .unwrap_or_else(|| "VS Bridge returned ok=false".to_string())
            ));
        }
    }

    Ok(())
}

fn split_code_link(raw_link: &str) -> Result<(&str, u32, Option<u32>), String> {
    let (without_last, last_value) = split_numeric_suffix(raw_link)
        .ok_or_else(|| format!("Code link path could not be parsed: {raw_link}"))?;

    if let Some((without_second, second_value)) = split_numeric_suffix(without_last) {
        if without_second.trim().is_empty() {
            return Err(format!("Code link path could not be parsed: {raw_link}"));
        }
        return Ok((without_second, second_value, Some(last_value)));
    }

    if without_last.trim().is_empty() {
        return Err(format!("Code link path could not be parsed: {raw_link}"));
    }
    Ok((without_last, last_value, None))
}

fn split_numeric_suffix(value: &str) -> Option<(&str, u32)> {
    let index = value.rfind(':')?;
    let suffix = &value[index + 1..];
    if suffix.is_empty() || !suffix.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    suffix
        .parse::<u32>()
        .ok()
        .map(|number| (&value[..index], number))
}

fn resolve_path(repo_root: &str, path_part: &str) -> Result<String, String> {
    let normalized = path_part.trim().replace('/', "\\");
    let path = Path::new(&normalized);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(repo_root).join(path)
    };

    if !candidate.exists() {
        return Err(format!(
            "File does not exist: {}",
            normalize_display_path(&candidate.to_string_lossy())
        ));
    }

    let canonical = candidate.canonicalize().map_err(|error| {
        format!(
            "Code link path canonicalization failed {}: {error}",
            candidate.display()
        )
    })?;
    Ok(normalize_display_path(&canonical.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn parses_relative_link_with_line() {
        let root = create_temp_project();
        let file = root.join("Source").join("Game").join("Foo.cpp");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "int main() {}\n").unwrap();

        let project = test_project(root.to_string_lossy().to_string());
        let payload = parse_code_link(&project, "Source/Game/Foo.cpp:128").unwrap();

        assert_eq!(payload.line, 128);
        assert_eq!(payload.column, None);
        assert!(payload.path.ends_with("Source\\Game\\Foo.cpp"));
    }

    #[test]
    fn parses_relative_link_with_line_and_column() {
        let root = create_temp_project();
        let file = root.join("Source").join("Game").join("Foo.cpp");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "int main() {}\n").unwrap();

        let project = test_project(root.to_string_lossy().to_string());
        let payload = parse_code_link(&project, "Source/Game/Foo.cpp:128:5").unwrap();

        assert_eq!(payload.line, 128);
        assert_eq!(payload.column, Some(5));
    }

    #[test]
    fn parses_absolute_windows_path_with_drive_colon() {
        let root = create_temp_project();
        let file = root.join("Source").join("Game").join("Foo.cpp");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "int main() {}\n").unwrap();

        let project = test_project(root.to_string_lossy().to_string());
        let raw_link = format!("{}:128", file.to_string_lossy());
        let payload = parse_code_link(&project, &raw_link).unwrap();

        assert_eq!(payload.line, 128);
        assert_eq!(payload.column, None);
        assert!(payload.path.ends_with("Source\\Game\\Foo.cpp"));
    }

    #[test]
    fn parses_absolute_forward_slash_path_with_column() {
        let root = create_temp_project();
        let file = root.join("Source").join("Game").join("Foo.cpp");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "int main() {}\n").unwrap();

        let project = test_project(root.to_string_lossy().to_string());
        let raw_link = format!("{}:128:5", file.to_string_lossy().replace('\\', "/"));
        let payload = parse_code_link(&project, &raw_link).unwrap();

        assert_eq!(payload.line, 128);
        assert_eq!(payload.column, Some(5));
        assert!(payload.path.ends_with("Source\\Game\\Foo.cpp"));
    }

    #[test]
    fn returns_file_does_not_exist_for_missing_file() {
        let root = create_temp_project();
        let project = test_project(root.to_string_lossy().to_string());
        let error = parse_code_link(&project, "Source/Game/Missing.cpp:1").unwrap_err();

        assert!(error.starts_with("File does not exist:"));
    }

    fn create_temp_project() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("snowagent-code-link-test-{unique}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn test_project(repo_root: String) -> ProjectSession {
        ProjectSession {
            id: "project".to_string(),
            name: "Project".to_string(),
            repo_root: repo_root.clone(),
            solution_path: Some(format!("{repo_root}\\Project.sln")),
            uproject_path: None,
            build_command: None,
            vs_process_id: None,
            vs_bridge_endpoint: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }
}
