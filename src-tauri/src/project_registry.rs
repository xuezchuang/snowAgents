use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::path_utils::normalize_display_path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSession {
    pub id: String,
    pub name: String,
    pub repo_root: String,
    pub solution_path: Option<String>,
    pub uproject_path: Option<String>,
    pub build_command: Option<String>,
    pub vs_process_id: Option<u32>,
    pub vs_bridge_endpoint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    pub repo_root: String,
    pub solution_path: Option<String>,
    pub uproject_path: Option<String>,
    pub build_command: Option<String>,
}

pub struct ProjectRegistry {
    path: PathBuf,
    projects: Vec<ProjectSession>,
}

impl ProjectRegistry {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self {
                path,
                projects: Vec::new(),
            });
        }

        let text = fs::read_to_string(&path)
            .map_err(|error| format!("JSON 项目配置读取失败 {}: {error}", path.display()))?;
        let projects = serde_json::from_str::<Vec<ProjectSession>>(&text)
            .map_err(|error| format!("JSON 项目配置解析失败 {}: {error}", path.display()))?;
        let mut registry = Self { path, projects };
        if registry.normalize_stored_paths() | registry.clear_runtime_bindings() {
            registry.save()?;
        }
        Ok(registry)
    }

    pub fn list(&self) -> Vec<ProjectSession> {
        self.projects.clone()
    }

    pub fn get(&self, project_id: &str) -> Result<ProjectSession, String> {
        self.projects
            .iter()
            .find(|project| project.id == project_id)
            .cloned()
            .ok_or_else(|| format!("项目不存在: {project_id}"))
    }

    pub fn add(&mut self, input: ProjectInput) -> Result<ProjectSession, String> {
        let input = normalize_and_validate_input(input)?;
        let now = Utc::now().to_rfc3339();
        let project = ProjectSession {
            id: Uuid::new_v4().to_string(),
            name: input.name,
            repo_root: input.repo_root,
            solution_path: input.solution_path,
            uproject_path: input.uproject_path,
            build_command: input.build_command,
            vs_process_id: None,
            vs_bridge_endpoint: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.projects.push(project.clone());
        self.save()?;
        Ok(project)
    }

    pub fn update(
        &mut self,
        project_id: &str,
        input: ProjectInput,
    ) -> Result<ProjectSession, String> {
        let input = normalize_and_validate_input(input)?;
        let index = self
            .projects
            .iter()
            .position(|project| project.id == project_id)
            .ok_or_else(|| format!("项目不存在: {project_id}"))?;

        let existing = &self.projects[index];
        let updated = ProjectSession {
            id: existing.id.clone(),
            name: input.name,
            repo_root: input.repo_root,
            solution_path: input.solution_path,
            uproject_path: input.uproject_path,
            build_command: input.build_command,
            vs_process_id: existing.vs_process_id,
            vs_bridge_endpoint: existing.vs_bridge_endpoint.clone(),
            created_at: existing.created_at.clone(),
            updated_at: Utc::now().to_rfc3339(),
        };
        self.projects[index] = updated.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn delete(&mut self, project_id: &str) -> Result<(), String> {
        let original_len = self.projects.len();
        self.projects.retain(|project| project.id != project_id);
        if self.projects.len() == original_len {
            return Err(format!("项目不存在: {project_id}"));
        }
        self.save()
    }

    pub fn set_vs_process(
        &mut self,
        project_id: &str,
        process_id: u32,
    ) -> Result<ProjectSession, String> {
        let project = self.project_mut(project_id)?;
        project.vs_process_id = Some(process_id);
        project.updated_at = Utc::now().to_rfc3339();
        let updated = project.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn bind_vs_bridge(
        &mut self,
        project_id: &str,
        process_id: u32,
        endpoint: String,
    ) -> Result<ProjectSession, String> {
        let project = self.project_mut(project_id)?;
        project.vs_process_id = Some(process_id);
        project.vs_bridge_endpoint = Some(endpoint);
        project.updated_at = Utc::now().to_rfc3339();
        let updated = project.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn clear_vs_bridge(&mut self, project_id: &str) -> Result<ProjectSession, String> {
        let project = self.project_mut(project_id)?;
        project.vs_bridge_endpoint = None;
        project.updated_at = Utc::now().to_rfc3339();
        let updated = project.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn find_by_solution_path(&self, solution_path: &str) -> Option<ProjectSession> {
        let target = path_compare_key(solution_path);
        self.projects
            .iter()
            .find(|project| {
                project
                    .solution_path
                    .as_deref()
                    .is_some_and(|path| path_compare_key(path) == target)
            })
            .cloned()
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("JSON 项目配置目录创建失败 {}: {error}", parent.display())
            })?;
        }
        let text = serde_json::to_string_pretty(&self.projects)
            .map_err(|error| format!("JSON 项目配置序列化失败: {error}"))?;
        fs::write(&self.path, text)
            .map_err(|error| format!("JSON 项目配置写入失败 {}: {error}", self.path.display()))
    }

    fn project_mut(&mut self, project_id: &str) -> Result<&mut ProjectSession, String> {
        self.projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| format!("项目不存在: {project_id}"))
    }

    fn normalize_stored_paths(&mut self) -> bool {
        let mut changed = false;
        for project in &mut self.projects {
            changed |= normalize_field(&mut project.repo_root);
            if let Some(solution_path) = project.solution_path.as_mut() {
                changed |= normalize_field(solution_path);
            }
            if let Some(uproject_path) = project.uproject_path.as_mut() {
                changed |= normalize_field(uproject_path);
            }
        }
        changed
    }

    fn clear_runtime_bindings(&mut self) -> bool {
        let mut changed = false;
        for project in &mut self.projects {
            if project.vs_process_id.is_some() {
                project.vs_process_id = None;
                changed = true;
            }
            if project.vs_bridge_endpoint.is_some() {
                project.vs_bridge_endpoint = None;
                changed = true;
            }
        }
        changed
    }
}

pub fn validate_project_paths(project: &ProjectSession) -> Result<(), String> {
    if !Path::new(&project.repo_root).is_dir() {
        return Err(format!("repoRoot 不存在: {}", project.repo_root));
    }
    if let Some(solution_path) = project.solution_path.as_deref() {
        if !Path::new(solution_path).is_file() {
            return Err(format!("solutionPath 不存在: {solution_path}"));
        }
    }
    if let Some(uproject_path) = project.uproject_path.as_deref() {
        if !uproject_path.trim().is_empty() && !Path::new(uproject_path).is_file() {
            return Err(format!("uprojectPath 不存在: {uproject_path}"));
        }
    }
    Ok(())
}

pub fn path_compare_key(path: &str) -> String {
    normalize_display_path(path)
        .replace('\\', "/")
        .to_ascii_lowercase()
}

fn normalize_and_validate_input(input: ProjectInput) -> Result<ProjectInput, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }

    let repo_root = normalize_existing_dir(&input.repo_root, "repoRoot")?;
    let solution_path = match clean_optional(input.solution_path) {
        Some(path) => Some(normalize_existing_file(&path, "solutionPath")?),
        None => None,
    };
    let uproject_path = match clean_optional(input.uproject_path) {
        Some(path) => Some(normalize_existing_file(&path, "uprojectPath")?),
        None => None,
    };

    Ok(ProjectInput {
        name,
        repo_root,
        solution_path,
        uproject_path,
        build_command: clean_optional(input.build_command),
    })
}

fn normalize_existing_dir(raw: &str, label: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} 不能为空"));
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err(format!("{label} 不存在: {trimmed}"));
    }
    Ok(normalize_display_path(trimmed))
}

fn normalize_existing_file(raw: &str, label: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} 不能为空"));
    }
    let path = Path::new(trimmed);
    if !path.is_file() {
        return Err(format!("{label} 不存在: {trimmed}"));
    }
    Ok(normalize_display_path(trimmed))
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_field(value: &mut String) -> bool {
    let normalized = normalize_display_path(value);
    if normalized == *value {
        false
    } else {
        *value = normalized;
        true
    }
}
