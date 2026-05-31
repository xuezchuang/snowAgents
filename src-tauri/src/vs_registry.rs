use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::path_utils::normalize_display_path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub devenv_path: Option<String>,
    pub data_dir: String,
    pub provider_notes: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            devenv_path: None,
            data_dir: String::new(),
            provider_notes:
                "Provider configuration placeholder. Real API calls are not enabled in the MVP."
                    .to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub devenv_path: Option<String>,
    pub provider_notes: Option<String>,
}

pub struct SettingsStore {
    path: PathBuf,
    settings: AppSettings,
}

impl SettingsStore {
    pub fn load(path: PathBuf, data_dir: String) -> Result<Self, String> {
        let mut settings = if path.exists() {
            let text = fs::read_to_string(&path)
                .map_err(|error| format!("JSON 设置读取失败 {}: {error}", path.display()))?;
            serde_json::from_str::<AppSettings>(&text)
                .map_err(|error| format!("JSON 设置解析失败 {}: {error}", path.display()))?
        } else {
            AppSettings::default()
        };
        settings.data_dir = normalize_display_path(&data_dir);
        let mut store = Self { path, settings };
        if let Some(devenv_path) = store.settings.devenv_path.as_mut() {
            let normalized = normalize_display_path(devenv_path);
            if normalized != *devenv_path {
                *devenv_path = normalized;
                store.save()?;
            }
        }
        Ok(store)
    }

    pub fn current(&self) -> AppSettings {
        self.settings.clone()
    }

    pub fn update(&mut self, input: SettingsInput) -> Result<AppSettings, String> {
        let devenv_path = match input.devenv_path {
            Some(path) if !path.trim().is_empty() => {
                let trimmed = path.trim();
                if !Path::new(trimmed).is_file() {
                    return Err(format!("devenv.exe 不存在: {trimmed}"));
                }
                Some(normalize_display_path(trimmed))
            }
            _ => None,
        };

        self.settings.devenv_path = devenv_path;
        if let Some(notes) = input.provider_notes {
            self.settings.provider_notes = notes;
        }
        self.save()?;
        Ok(self.current())
    }

    fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("JSON 设置目录创建失败 {}: {error}", parent.display()))?;
        }
        let text = serde_json::to_string_pretty(&self.settings)
            .map_err(|error| format!("JSON 设置序列化失败: {error}"))?;
        fs::write(&self.path, text)
            .map_err(|error| format!("JSON 设置写入失败 {}: {error}", self.path.display()))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VSInstance {
    pub instance_id: String,
    pub project_id: Option<String>,
    pub process_id: u32,
    pub solution_path: String,
    pub endpoint: String,
    pub connected_at: String,
    pub last_heartbeat_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VSRegisterPayload {
    pub instance_id: String,
    pub process_id: u32,
    pub solution_path: String,
    pub endpoint: String,
}

#[derive(Default)]
pub struct VsRegistry {
    instances: HashMap<String, VSInstance>,
}

impl VsRegistry {
    pub fn register(
        &mut self,
        payload: VSRegisterPayload,
        project_id: Option<String>,
    ) -> Result<VSInstance, String> {
        if payload.instance_id.trim().is_empty() {
            return Err("VS instanceId 不能为空".to_string());
        }
        if payload.endpoint.trim().is_empty() {
            return Err("VS endpoint 不能为空".to_string());
        }

        let now = Utc::now().to_rfc3339();
        let instance = VSInstance {
            instance_id: payload.instance_id,
            project_id,
            process_id: payload.process_id,
            solution_path: normalize_display_path(&payload.solution_path),
            endpoint: payload.endpoint,
            connected_at: now.clone(),
            last_heartbeat_at: now,
        };
        self.instances
            .insert(instance.instance_id.clone(), instance.clone());
        Ok(instance)
    }

    pub fn unregister(&mut self, instance_id: &str) -> Result<VSInstance, String> {
        self.instances
            .remove(instance_id)
            .ok_or_else(|| format!("VS instance 不存在: {instance_id}"))
    }

    pub fn heartbeat(&mut self, instance_id: &str) -> Result<VSInstance, String> {
        let instance = self
            .instances
            .get_mut(instance_id)
            .ok_or_else(|| format!("VS instance 不存在: {instance_id}"))?;
        instance.last_heartbeat_at = Utc::now().to_rfc3339();
        Ok(instance.clone())
    }

    pub fn list(&self) -> Vec<VSInstance> {
        let mut instances = self.instances.values().cloned().collect::<Vec<_>>();
        instances.sort_by(|left, right| left.connected_at.cmp(&right.connected_at));
        instances
    }
}
