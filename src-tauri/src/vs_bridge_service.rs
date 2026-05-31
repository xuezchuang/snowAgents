use crate::app_state::{lock_error, AppState};
use crate::vs_registry::{VSInstance, VSRegisterPayload};

pub fn register_vs_instance(
    state: &AppState,
    payload: VSRegisterPayload,
) -> Result<VSInstance, String> {
    let matched_project = {
        let mut projects = state.projects.lock().map_err(|_| lock_error())?;
        let matched = projects.find_by_solution_path(&payload.solution_path);
        if let Some(project) = matched.as_ref() {
            projects.bind_vs_bridge(&project.id, payload.process_id, payload.endpoint.clone())?;
        }
        matched
    };

    let mut registry = state.vs_registry.lock().map_err(|_| lock_error())?;
    registry.register(payload, matched_project.map(|project| project.id))
}

pub fn unregister_vs_instance(state: &AppState, instance_id: &str) -> Result<VSInstance, String> {
    let removed = {
        let mut registry = state.vs_registry.lock().map_err(|_| lock_error())?;
        registry.unregister(instance_id)?
    };

    if let Some(project_id) = removed.project_id.as_deref() {
        let mut projects = state.projects.lock().map_err(|_| lock_error())?;
        let _ = projects.clear_vs_bridge(project_id);
    }

    Ok(removed)
}

pub fn heartbeat_vs_instance(state: &AppState, instance_id: &str) -> Result<VSInstance, String> {
    let mut registry = state.vs_registry.lock().map_err(|_| lock_error())?;
    registry.heartbeat(instance_id)
}
