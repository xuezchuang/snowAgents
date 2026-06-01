use std::time::Instant;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::project_registry::ProjectSession;
use crate::tool_trace::{self, MockAgentRun, ToolTraceEvent, TraceEventType, TraceStatus};
use crate::vs_registry::{AppSettings, ProviderConfig};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunInput {
    pub project_id: String,
    pub user_prompt: String,
    pub messages: Option<Vec<AgentConversationMessage>>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone)]
struct SelectedModel {
    provider: ProviderConfig,
    model_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Debug)]
struct ProviderCompletion {
    message: String,
    duration_ms: u64,
    token_usage: TokenUsage,
    request_body: Value,
    response_body: Value,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaMessage>,
    response: Option<String>,
    prompt_eval_count: Option<u64>,
    eval_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeMessagesResponse {
    content: Vec<ClaudeContentBlock>,
    usage: Option<ClaudeUsage>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

pub async fn run_agent(
    project: &ProjectSession,
    settings: &AppSettings,
    input: AgentRunInput,
) -> Result<MockAgentRun, String> {
    let task_id = Uuid::new_v4().to_string();
    let conversation_messages =
        normalize_conversation_messages(input.messages.as_deref(), &input.user_prompt);
    let mut traces = Vec::new();
    traces.push(trace(
        &task_id,
        1,
        TraceEventType::SystemEvent,
        None,
        "Start task",
        Some(json!({
            "projectId": project.id,
            "projectName": project.name,
            "prompt": input.user_prompt,
        })),
        None,
        Some("Task accepted".to_string()),
        TraceStatus::Success,
        0,
    ));

    let selected = match select_model(
        settings,
        input.provider_id.as_deref(),
        input.model_id.as_deref(),
    ) {
        Ok(selected) => selected,
        Err(error) => {
            traces.push(error_trace(
                &task_id,
                2,
                "select_model failed",
                Some(json!({
                    "providerId": input.provider_id,
                    "modelId": input.model_id,
                })),
                &error,
            ));
            return Ok(MockAgentRun { task_id, traces });
        }
    };

    traces.push(trace(
        &task_id,
        2,
        TraceEventType::SystemEvent,
        None,
        "select_model",
        Some(json!({
            "providerId": selected.provider.id,
            "modelId": selected.model_id,
        })),
        Some(json!({
            "provider": selected.provider.name,
            "type": selected.provider.provider_type,
            "baseUrl": selected.provider.base_url,
            "model": selected.model_id,
        })),
        Some(format!(
            "{} / {}",
            selected.provider.name, selected.model_id
        )),
        TraceStatus::Success,
        0,
    ));

    match call_provider(project, &selected, &conversation_messages).await {
        Ok(completion) => {
            let message = completion.message;
            let message_chars = message.chars().count();
            traces.push(trace(
                &task_id,
                3,
                TraceEventType::ToolResult,
                Some("chat_completion"),
                "chat_completion",
                Some(json!({
                    "provider": selected.provider.name,
                    "type": selected.provider.provider_type,
                    "baseUrl": selected.provider.base_url,
                    "request": completion.request_body,
                })),
                Some(json!({
                    "provider": selected.provider.name,
                    "type": selected.provider.provider_type,
                    "baseUrl": selected.provider.base_url,
                    "response": completion.response_body,
                    "message": message.clone(),
                    "messageChars": message_chars,
                    "model": selected.model_id,
                    "inputTokens": completion.token_usage.input_tokens,
                    "outputTokens": completion.token_usage.output_tokens,
                    "totalTokens": completion.token_usage.total_tokens,
                })),
                Some(format!("Received {message_chars} chars")),
                TraceStatus::Success,
                completion.duration_ms,
            ));
            traces.push(trace(
                &task_id,
                4,
                TraceEventType::ModelMessage,
                None,
                "model_message",
                None,
                Some(json!({ "message": message.clone() })),
                Some(message),
                TraceStatus::Success,
                0,
            ));
        }
        Err(error) => {
            traces.push(error_trace(
                &task_id,
                3,
                "chat_completion failed",
                Some(json!({
                    "provider": selected.provider.name,
                    "type": selected.provider.provider_type,
                    "baseUrl": selected.provider.base_url,
                    "model": selected.model_id,
                    "messages": &conversation_messages,
                    "apiKey": mask_secret(&selected.provider.api_key),
                })),
                &error,
            ));
        }
    }

    Ok(MockAgentRun { task_id, traces })
}

fn select_model(
    settings: &AppSettings,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<SelectedModel, String> {
    let provider = if let Some(provider_id) = provider_id.filter(|value| !value.trim().is_empty()) {
        let requested_provider = settings
            .providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .ok_or_else(|| format!("Provider not found: {provider_id}"))?;

        if is_provider_usable(requested_provider) {
            requested_provider.clone()
        } else {
            settings
                .providers
                .iter()
                .find(|provider| is_provider_usable(provider))
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "Provider is disabled: {}. Enable a provider or model in Settings first.",
                        requested_provider.name
                    )
                })?
        }
    } else {
        settings
            .providers
            .iter()
            .find(|provider| is_provider_usable(provider))
            .cloned()
            .ok_or_else(|| {
                "No enabled provider. Enable a provider or model in Settings first.".to_string()
            })?
    };

    let model_id = model_id
        .filter(|value| {
            !value.trim().is_empty()
                && ((provider.models.is_empty())
                    || provider
                        .models
                        .iter()
                        .any(|model| model.enabled && model.id == *value))
        })
        .map(str::to_string)
        .or_else(|| {
            provider
                .models
                .iter()
                .find(|model| model.enabled)
                .map(|model| model.id.clone())
        })
        .unwrap_or_else(|| provider.default_model.clone());

    if model_id.trim().is_empty() {
        return Err(format!("Model is empty for provider {}", provider.name));
    }

    Ok(SelectedModel { provider, model_id })
}

fn is_provider_usable(provider: &ProviderConfig) -> bool {
    provider.enabled || provider.models.iter().any(|model| model.enabled)
}

async fn call_provider(
    project: &ProjectSession,
    selected: &SelectedModel,
    conversation_messages: &[ChatMessage],
) -> Result<ProviderCompletion, String> {
    let provider_type = selected.provider.provider_type.as_str();
    if provider_type == "claude" {
        return call_claude(project, selected, conversation_messages).await;
    }
    if provider_type == "ollama" {
        return call_ollama(project, selected, conversation_messages).await;
    }
    call_openai_compatible(project, selected, conversation_messages).await
}

async fn call_openai_compatible(
    project: &ProjectSession,
    selected: &SelectedModel,
    conversation_messages: &[ChatMessage],
) -> Result<ProviderCompletion, String> {
    let base_url = selected.provider.base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err(format!(
            "Base URL is empty for provider {}",
            selected.provider.name
        ));
    }
    if selected.provider.api_key.trim().is_empty() {
        return Err(format!(
            "API key is empty for provider {}",
            selected.provider.name
        ));
    }

    let url = format!("{base_url}/chat/completions");
    let messages = build_messages(project, conversation_messages);
    let request_body = json!({
        "model": selected.model_id,
        "messages": messages,
        "temperature": selected.provider.temperature,
        "stream": false,
    });

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let auth = format!("Bearer {}", selected.provider.api_key.trim());
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth).map_err(|error| format!("Invalid API key header: {error}"))?,
    );

    let started = Instant::now();
    let response = reqwest::Client::new()
        .post(&url)
        .headers(headers)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| format!("Model request failed: {error}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Model request failed. status={}; body={}",
            status.as_u16(),
            body
        ));
    }

    let response_body = serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "Model response parse failed: {error}; body={}",
            body
        )
    })?;
    let parsed = serde_json::from_value::<OpenAiChatResponse>(response_body.clone())
        .map_err(|error| format!("Model response parse failed: {error}; body={body}"))?;
    let message = parsed
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_deref())
        .unwrap_or("")
        .trim()
        .to_string();
    if message.is_empty() {
        return Err("Model response was empty.".to_string());
    }

    let token_usage = parsed
        .usage
        .map(|usage| TokenUsage {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        })
        .unwrap_or_default();

    Ok(ProviderCompletion {
        message,
        duration_ms,
        token_usage,
        request_body,
        response_body,
    })
}

async fn call_claude(
    project: &ProjectSession,
    selected: &SelectedModel,
    conversation_messages: &[ChatMessage],
) -> Result<ProviderCompletion, String> {
    let base_url = selected
        .provider
        .base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    let base_url = if base_url.is_empty() {
        "https://api.anthropic.com/v1".to_string()
    } else {
        base_url
    };
    if selected.provider.api_key.trim().is_empty() {
        return Err(format!(
            "API key is empty for provider {}",
            selected.provider.name
        ));
    }

    let url = format!("{base_url}/messages");
    let request_body = json!({
        "model": selected.model_id,
        "max_tokens": 4096,
        "temperature": selected.provider.temperature,
        "system": system_prompt(project),
        "messages": conversation_messages,
    });

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        HeaderName::from_static("x-api-key"),
        HeaderValue::from_str(selected.provider.api_key.trim())
            .map_err(|error| format!("Invalid Claude API key header: {error}"))?,
    );
    headers.insert(
        HeaderName::from_static("anthropic-version"),
        HeaderValue::from_static("2023-06-01"),
    );

    let started = Instant::now();
    let response = reqwest::Client::new()
        .post(&url)
        .headers(headers)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| format!("Claude request failed: {error}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Claude request failed. status={}; body={}",
            status.as_u16(),
            body
        ));
    }

    let response_body = serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "Claude response parse failed: {error}; body={}",
            body
        )
    })?;
    let parsed = serde_json::from_value::<ClaudeMessagesResponse>(response_body.clone())
        .map_err(|error| format!("Claude response parse failed: {error}; body={body}"))?;
    let message = parsed
        .content
        .into_iter()
        .filter(|block| block.block_type == "text")
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if message.is_empty() {
        return Err("Claude response was empty.".to_string());
    }

    let token_usage = parsed
        .usage
        .map(|usage| TokenUsage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage
                .input_tokens
                .zip(usage.output_tokens)
                .map(|(input_tokens, output_tokens)| input_tokens + output_tokens),
        })
        .unwrap_or_default();

    Ok(ProviderCompletion {
        message,
        duration_ms,
        token_usage,
        request_body,
        response_body,
    })
}

async fn call_ollama(
    project: &ProjectSession,
    selected: &SelectedModel,
    conversation_messages: &[ChatMessage],
) -> Result<ProviderCompletion, String> {
    let base_url = selected.provider.base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("Ollama Base URL is empty.".to_string());
    }

    let url = format!("{base_url}/api/chat");
    let request_body = json!({
        "model": selected.model_id,
        "messages": build_messages(project, conversation_messages),
        "stream": false,
        "options": {
            "temperature": selected.provider.temperature,
        },
    });

    let started = Instant::now();
    let response = reqwest::Client::new()
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| format!("Ollama request failed: {error}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Ollama request failed. status={}; body={}",
            status.as_u16(),
            body
        ));
    }

    let response_body = serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "Ollama response parse failed: {error}; body={}",
            body
        )
    })?;
    let parsed = serde_json::from_value::<OllamaChatResponse>(response_body.clone())
        .map_err(|error| format!("Ollama response parse failed: {error}; body={body}"))?;
    let message = parsed
        .message
        .map(|message| message.content)
        .or(parsed.response)
        .unwrap_or_default()
        .trim()
        .to_string();
    if message.is_empty() {
        return Err("Ollama response was empty.".to_string());
    }

    let token_usage = TokenUsage {
        input_tokens: parsed.prompt_eval_count,
        output_tokens: parsed.eval_count,
        total_tokens: parsed
            .prompt_eval_count
            .zip(parsed.eval_count)
            .map(|(input_tokens, output_tokens)| input_tokens + output_tokens),
    };

    Ok(ProviderCompletion {
        message,
        duration_ms,
        token_usage,
        request_body,
        response_body,
    })
}

fn normalize_conversation_messages(
    messages: Option<&[AgentConversationMessage]>,
    user_prompt: &str,
) -> Vec<ChatMessage> {
    let normalized = messages
        .unwrap_or(&[])
        .iter()
        .filter_map(|message| {
            let role = match message.role.as_str() {
                "assistant" => "assistant",
                "user" => "user",
                _ => return None,
            };
            if message.content.trim().is_empty() {
                return None;
            }
            Some(ChatMessage {
                role: role.to_string(),
                content: message.content.clone(),
            })
        })
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        return vec![ChatMessage {
            role: "user".to_string(),
            content: user_prompt.to_string(),
        }];
    }

    normalized
}

fn build_messages(project: &ProjectSession, conversation_messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_prompt(project),
    }];
    messages.extend(conversation_messages.iter().cloned());
    messages
}

fn system_prompt(project: &ProjectSession) -> String {
    format!(
        "You are SnowAgent Desktop, a coding assistant for the project \"{}\". Repo root: {}. Answer concisely and use clickable file:line references when relevant.",
        project.name, project.repo_root
    )
}

fn trace(
    task_id: &str,
    step_index: u32,
    event_type: TraceEventType,
    tool_name: Option<&str>,
    title: &str,
    input: Option<serde_json::Value>,
    output: Option<serde_json::Value>,
    output_summary: Option<String>,
    status: TraceStatus,
    duration_ms: u64,
) -> ToolTraceEvent {
    tool_trace::tool_event(
        task_id,
        step_index,
        event_type,
        tool_name.map(str::to_string),
        title.to_string(),
        input,
        output,
        output_summary,
        status,
        duration_ms,
    )
}

fn error_trace(
    task_id: &str,
    step_index: u32,
    title: &str,
    input: Option<serde_json::Value>,
    error: &str,
) -> ToolTraceEvent {
    trace(
        task_id,
        step_index,
        TraceEventType::Error,
        None,
        title,
        input,
        Some(json!({ "error": error })),
        Some(error.to_string()),
        TraceStatus::Failed,
        0,
    )
}

fn mask_secret(secret: &str) -> String {
    if secret.trim().is_empty() {
        return "not_set".to_string();
    }
    "set".to_string()
}
