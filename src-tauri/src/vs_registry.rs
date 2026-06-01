use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::path_utils::normalize_display_path;

pub const MINIMAX_OPENAI_BASE_URL: &str = "https://api.minimaxi.com/v1";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub devenv_path: Option<String>,
    pub data_dir: String,
    #[serde(default = "default_provider_notes")]
    pub provider_notes: String,
    #[serde(default = "default_ui_preferences")]
    pub ui_preferences: UiPreferences,
    #[serde(default = "default_providers")]
    pub providers: Vec<ProviderConfig>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            devenv_path: None,
            data_dir: String::new(),
            provider_notes: default_provider_notes(),
            ui_preferences: default_ui_preferences(),
            providers: default_providers(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub devenv_path: Option<String>,
    pub provider_notes: Option<String>,
    pub ui_preferences: Option<UiPreferences>,
    pub providers: Option<Vec<ProviderConfig>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    pub show_trace_button: bool,
    pub auto_open_trace_on_errors: bool,
    pub default_workspace_layout: String,
    #[serde(default = "default_visual_style")]
    pub visual_style: String,
    #[serde(default = "default_workspace_history_days")]
    pub workspace_history_days: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub enabled: bool,
    pub base_url: String,
    #[serde(default)]
    pub base_url_locked: bool,
    pub api_key: String,
    pub default_model: String,
    pub temperature: f64,
    #[serde(default)]
    pub models: Vec<ProviderModel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(default)]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub created: Option<i64>,
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
        if store.settings.providers.is_empty() {
            store.settings.providers = default_providers();
            store.save()?;
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
        if let Some(preferences) = input.ui_preferences {
            self.settings.ui_preferences = normalize_ui_preferences(preferences);
        }
        if let Some(providers) = input.providers {
            self.settings.providers = normalize_providers(providers);
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

fn default_provider_notes() -> String {
    "Configure provider Base URL, API key, and model selection for real chat calls.".to_string()
}

fn default_ui_preferences() -> UiPreferences {
    UiPreferences {
        show_trace_button: true,
        auto_open_trace_on_errors: true,
        default_workspace_layout: "chat-only".to_string(),
        visual_style: default_visual_style(),
        workspace_history_days: default_workspace_history_days(),
    }
}

fn default_visual_style() -> String {
    "codex".to_string()
}

fn default_workspace_history_days() -> u32 {
    7
}

fn default_providers() -> Vec<ProviderConfig> {
    vec![
        provider(
            "openai-compatible",
            "openai-compatible",
            "OpenAI-Compatible",
            "gpt-4.1",
        ),
        provider("claude", "claude", "Claude", "Claude 4.1 Sonnet"),
        provider("deepseek", "deepseek", "DeepSeek", "deepseek-chat"),
        provider("minimax", "minimax", "MiniMax", "MiniMax-M2.7"),
        ProviderConfig {
            id: "ollama".to_string(),
            provider_type: "ollama".to_string(),
            name: "Ollama".to_string(),
            enabled: false,
            base_url: "http://127.0.0.1:11434".to_string(),
            base_url_locked: false,
            api_key: String::new(),
            default_model: "llama3.1".to_string(),
            temperature: 0.2,
            models: Vec::new(),
        },
        provider(
            "local-gateway",
            "local-gateway",
            "Local Gateway",
            "local-default",
        ),
    ]
}

fn provider(id: &str, provider_type: &str, name: &str, default_model: &str) -> ProviderConfig {
    ProviderConfig {
        id: id.to_string(),
        provider_type: provider_type.to_string(),
        name: name.to_string(),
        enabled: false,
        base_url: if id == "minimax" {
            MINIMAX_OPENAI_BASE_URL.to_string()
        } else {
            String::new()
        },
        base_url_locked: id == "minimax",
        api_key: String::new(),
        default_model: default_model.to_string(),
        temperature: 0.2,
        models: Vec::new(),
    }
}

fn normalize_ui_preferences(preferences: UiPreferences) -> UiPreferences {
    let default_workspace_layout = match preferences.default_workspace_layout.as_str() {
        "split-chat-trace" => "split-chat-trace",
        _ => "chat-only",
    }
    .to_string();
    let visual_style = match preferences.visual_style.as_str() {
        "snowagent" => "snowagent",
        _ => "codex",
    }
    .to_string();

    UiPreferences {
        default_workspace_layout,
        visual_style,
        workspace_history_days: preferences.workspace_history_days.clamp(1, 365),
        ..preferences
    }
}

fn normalize_providers(providers: Vec<ProviderConfig>) -> Vec<ProviderConfig> {
    providers
        .into_iter()
        .map(|provider| ProviderConfig {
            id: provider.id.trim().to_string(),
            provider_type: provider.provider_type.trim().to_string(),
            name: provider.name.trim().to_string(),
            base_url: if provider.id == "minimax" || provider.provider_type == "minimax" {
                MINIMAX_OPENAI_BASE_URL.to_string()
            } else {
                provider.base_url.trim().to_string()
            },
            base_url_locked: provider.id == "minimax" || provider.provider_type == "minimax",
            default_model: provider.default_model.trim().to_string(),
            temperature: provider.temperature.clamp(0.0, 2.0),
            models: provider
                .models
                .into_iter()
                .map(|model| ProviderModel {
                    id: model.id.trim().to_string(),
                    name: if model.name.trim().is_empty() {
                        model.id.trim().to_string()
                    } else {
                        model.name.trim().to_string()
                    },
                    enabled: model.enabled,
                    owned_by: model.owned_by,
                    created: model.created,
                })
                .filter(|model| !model.id.is_empty())
                .collect(),
            ..provider
        })
        .filter(|provider| !provider.id.is_empty() && !provider.name.is_empty())
        .collect()
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
