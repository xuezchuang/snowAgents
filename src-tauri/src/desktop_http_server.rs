use std::net::{Ipv4Addr, SocketAddrV4};
use std::thread;

use serde::Deserialize;
use serde_json::json;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::app_state::AppState;
use crate::vs_bridge_service;
use crate::vs_registry::VSRegisterPayload;

pub const DESKTOP_HTTP_PORT: u16 = 39000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceIdPayload {
    instance_id: String,
}

pub fn start(state: AppState) -> Result<(), String> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, DESKTOP_HTTP_PORT);
    let server = Server::http(address)
        .map_err(|error| format!("SnowAgent Desktop HTTP server bind failed: {error}"))?;

    thread::Builder::new()
        .name("snowagent-desktop-http".to_string())
        .spawn(move || {
            for request in server.incoming_requests() {
                handle_request(&state, request);
            }
        })
        .map_err(|error| format!("SnowAgent Desktop HTTP server start failed: {error}"))?;

    Ok(())
}

fn handle_request(state: &AppState, mut request: Request) {
    let result = match (request.method(), request.url()) {
        (&Method::Get, "/health") => Ok(json!({
            "ok": true,
            "message": "SnowAgent Desktop bridge is listening"
        })),
        (&Method::Post, "/register_vs_instance") => parse_body::<VSRegisterPayload>(&mut request)
            .and_then(|payload| vs_bridge_service::register_vs_instance(state, payload))
            .map(|instance| json!({ "ok": true, "instance": instance })),
        (&Method::Post, "/heartbeat_vs_instance") => parse_body::<InstanceIdPayload>(&mut request)
            .and_then(|payload| {
                vs_bridge_service::heartbeat_vs_instance(state, &payload.instance_id)
            })
            .map(|instance| json!({ "ok": true, "instance": instance })),
        (&Method::Post, "/unregister_vs_instance") => parse_body::<InstanceIdPayload>(&mut request)
            .and_then(|payload| {
                vs_bridge_service::unregister_vs_instance(state, &payload.instance_id)
            })
            .map(|instance| json!({ "ok": true, "instance": instance })),
        _ => Err(format!(
            "Unsupported endpoint: {} {}",
            request.method(),
            request.url()
        )),
    };

    let (status, body) = match result {
        Ok(value) => (StatusCode(200), value),
        Err(message) => (
            StatusCode(400),
            json!({
                "ok": false,
                "message": message
            }),
        ),
    };

    let response_text = serde_json::to_string(&body)
        .unwrap_or_else(|_| "{\"ok\":false,\"message\":\"JSON serialization failed\"}".to_string());
    let response = Response::from_string(response_text)
        .with_status_code(status)
        .with_header(json_header());

    let _ = request.respond(response);
}

fn parse_body<T>(request: &mut Request) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let mut body = String::new();
    request
        .as_reader()
        .read_to_string(&mut body)
        .map_err(|error| format!("HTTP request body read failed: {error}"))?;
    serde_json::from_str::<T>(&body).map_err(|error| format!("HTTP JSON parse failed: {error}"))
}

fn json_header() -> Header {
    Header::from_bytes(
        &b"Content-Type"[..],
        &b"application/json; charset=utf-8"[..],
    )
    .expect("static JSON content-type header is valid")
}
