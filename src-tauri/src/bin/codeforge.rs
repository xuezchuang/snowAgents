fn main() {
    if let Err(error) = tauri::async_runtime::block_on(codeforge_desktop::cli::main_entry()) {
        if wants_json_output() {
            let payload = serde_json::json!({ "error": error });
            match serde_json::to_string_pretty(&payload) {
                Ok(text) => eprintln!("{text}"),
                Err(_) => eprintln!("{{\"error\":\"failed to serialize error\"}}"),
            }
        } else {
            eprintln!("codeforge: {error}");
        }
        std::process::exit(1);
    }
}

fn wants_json_output() -> bool {
    std::env::args().skip(1).any(|arg| arg == "--json")
}
