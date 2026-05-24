#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use discord_rich_presence::{
    activity::{Activity, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::SocketAddr,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State as TauriState, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::oneshot;
use tower_http::cors::CorsLayer;

const CLIENT_ID: &str = "1506289512207093890";
const DEFAULT_PORT: u16 = 17654;
const LEGACY_PORT: u16 = 3000;
const RPC_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const RELEASES_URL: &str = "https://github.com/GSUS2K/discord-status/releases/latest";

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<InnerState>>,
}

struct InnerState {
    settings: Settings,
    rpc: Option<DiscordIpcClient>,
    rpc_connected: bool,
    rpc_connecting: bool,
    last_rpc_error: Option<String>,
    last_activity: Option<ActivitySnapshot>,
    activity_inbox: Vec<ActivityEntry>,
    selected_activity_id: Option<String>,
    last_log: String,
    started_at: Instant,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    auto_start_backend: bool,
    launch_at_login: bool,
    hide_popover_on_blur: bool,
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivitySnapshot {
    id: Option<String>,
    tab_id: Option<i64>,
    tab_title: Option<String>,
    platform: String,
    details: String,
    state: String,
    url: Option<String>,
    is_active_tab: bool,
    large_image_key: Option<String>,
    small_image_key: Option<String>,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEntry {
    id: String,
    tab_id: Option<i64>,
    tab_title: Option<String>,
    platform: String,
    details: String,
    state: String,
    url: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    thumbnail_url: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    is_playing: Option<bool>,
    media_current_time: Option<f64>,
    media_duration: Option<f64>,
    is_active_tab: bool,
    last_seen: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionStatus {
    backend: String,
    discord: String,
    last_activity: String,
    last_rpc_error: Option<String>,
    log: String,
    url: String,
    activities: Vec<ActivityEntry>,
    selected_activity_id: Option<String>,
    current_activity_id: Option<String>,
    update: UpdateStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    state: String,
    message: String,
    version: String,
    available_version: Option<String>,
    progress: Option<u8>,
}

#[derive(Debug, Serialize)]
struct ApiStatus {
    discord_rpc: String,
    last_rpc_error: Option<String>,
    last_activity: Option<ActivitySnapshot>,
    activities: Vec<ActivityEntry>,
    selected_activity_id: Option<String>,
    uptime_seconds: u64,
    timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomingActivity {
    id: Option<String>,
    tab_id: Option<i64>,
    tab_title: Option<String>,
    details: Option<String>,
    state: Option<String>,
    platform: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    thumbnail_url: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    is_playing: Option<bool>,
    media_current_time: Option<f64>,
    media_duration: Option<f64>,
    url: Option<String>,
    source_url: Option<String>,
    is_active_tab: Option<bool>,
    last_seen: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityReport {
    activities: Vec<IncomingActivity>,
    selected_activity_id: Option<String>,
    auto_pick_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectActivityRequest {
    selected_activity_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ApiMessage {
    success: bool,
    message: String,
    timestamp: String,
}

#[tokio::main]
async fn main() {
    let settings = read_settings();
    let state = AppState {
        inner: Arc::new(Mutex::new(InnerState {
            settings: settings.clone(),
            rpc: None,
            rpc_connected: false,
            rpc_connecting: false,
            last_rpc_error: None,
            last_activity: None,
            activity_inbox: Vec::new(),
            selected_activity_id: None,
            last_log: "Companion ready.".to_string(),
            started_at: Instant::now(),
            shutdown: None,
        })),
    };

    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Activity Status Companion")
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            set_settings,
            start_backend,
            stop_backend,
            restart_backend,
            reconnect_rpc,
            select_activity_id,
            open_chrome_extensions,
            copy_text,
            check_for_updates,
            install_update,
            show_settings,
            hide_main_if_configured,
            quit_app
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            setup_tray(app.handle())?;
            if let Err(error) = apply_launch_at_login(app.handle(), settings.launch_at_login) {
                set_log(&state, format!("Launch at login setup failed: {error}"));
            }
            if settings.auto_start_backend {
                let app_handle = app.handle().clone();
                let state = state.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = start_server(state.clone()).await {
                        set_log(&state, format!("Backend failed: {error}"));
                    }
                    emit_status(&app_handle, &state);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Activity Status Companion");
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    TrayIconBuilder::with_id("activity-status")
        .tooltip("Activity Status Companion")
        .icon(icon)
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                position,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window_near(tray.app_handle(), "main", position);
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_window_near<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    position: PhysicalPosition<f64>,
) {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            place_popover(&window, position);
            show_existing_window(&window);
        }
    }
}

fn show_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        show_existing_window(&window);
    }
}

fn show_existing_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn place_popover<R: Runtime>(window: &WebviewWindow<R>, position: PhysicalPosition<f64>) {
    let size = window.outer_size().ok();
    let width = size.map(|value| value.width as f64).unwrap_or(382.0);
    let height = size.map(|value| value.height as f64).unwrap_or(560.0);
    let x = (position.x - width / 2.0).max(8.0);
    let y = if position.y < 120.0 {
        position.y + 12.0
    } else {
        (position.y - height - 12.0).max(8.0)
    };
    let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
}

#[tauri::command]
async fn get_status(state: TauriState<'_, AppState>) -> Result<CompanionStatus, String> {
    Ok(companion_status(&state))
}

#[tauri::command]
async fn get_settings(state: TauriState<'_, AppState>) -> Result<Settings, String> {
    Ok(state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .settings
        .clone())
}

#[tauri::command]
async fn set_settings(
    app: AppHandle,
    settings: Settings,
    state: TauriState<'_, AppState>,
) -> Result<Settings, String> {
    let settings = normalize_settings(settings);
    apply_launch_at_login(&app, settings.launch_at_login)?;
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.settings = settings.clone();
    }
    write_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
async fn start_backend(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    start_server(state.inner().clone()).await?;
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn stop_backend(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    stop_server(state.inner().clone()).await?;
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn restart_backend(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    stop_server(state.inner().clone()).await?;
    start_server(state.inner().clone()).await?;
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn reconnect_rpc(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    reconnect_discord(state.inner().clone()).await?;
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn select_activity_id(
    app: AppHandle,
    activity_id: Option<String>,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    let selected = select_activity_from_inbox(&state, activity_id);
    if let Some(activity) = selected {
        let (status, message) =
            apply_activity_payload(&state, payload_from_activity_entry(&activity));
        if !status.is_success() {
            return Err(message.0.message);
        }
    } else {
        set_log(
            &state,
            "Companion returned to auto activity selection.".to_string(),
        );
    }
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn open_chrome_extensions() -> Result<(), String> {
    open_chrome_url("chrome://extensions/")
}

#[tauri::command]
async fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_for_updates(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    set_log(
        &state,
        "Opening the latest GitHub release in your browser.".to_string(),
    );
    let _ = open::that(RELEASES_URL);
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn install_update() -> Result<bool, String> {
    open::that(RELEASES_URL).map_err(|error| error.to_string())?;
    Ok(false)
}

#[tauri::command]
async fn show_settings(app: AppHandle) -> Result<(), String> {
    show_window(&app, "settings");
    Ok(())
}

#[tauri::command]
async fn hide_main_if_configured(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<(), String> {
    let should_hide = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .settings
        .hide_popover_on_blur;
    if should_hide {
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn quit_app(app: AppHandle) {
    app.exit(0);
}

async fn start_server(state: AppState) -> Result<(), String> {
    let (port, already_running, rpc_connected) = {
        let inner = state.inner.lock().map_err(|error| error.to_string())?;
        (
            inner.settings.port,
            inner.shutdown.is_some(),
            inner.rpc_connected,
        )
    };
    if already_running {
        if rpc_connected {
            set_log(&state, "Backend already running.".to_string());
        } else {
            connect_rpc(&state).await?;
        }
        return Ok(());
    }

    if let Err(error) = connect_rpc(&state).await {
        set_log(
            &state,
            format!("Backend started. Discord RPC needs reconnect: {error}"),
        );
    }
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.shutdown = Some(shutdown_tx);
        inner.started_at = Instant::now();
        if inner.last_log.starts_with("Backend started.") {
            inner.last_log = format!(
                "Backend listening on http://localhost:{port}. Discord RPC needs reconnect."
            );
        } else {
            inner.last_log = format!("Backend listening on http://localhost:{port}");
        }
    }

    let router = Router::new()
        .route("/health", get(health))
        .route("/api/status", get(api_status))
        .route("/api/update-activity", post(update_activity))
        .route("/api/report-activities", post(report_activities))
        .route("/api/select-activity", post(select_activity))
        .route("/api/clear-activity", post(clear_activity))
        .route("/api/reconnect-rpc", post(reconnect_activity_rpc))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let (listener, bound_port) = bind_listener_with_fallback(&state, port).await?;
    if bound_port != port {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.settings.port = bound_port;
        let _ = write_settings(&inner.settings);
        inner.last_log =
            format!("Port {port} was busy, so the backend moved to http://localhost:{bound_port}");
    }

    tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
        if let Err(error) = result {
            set_log(&state, format!("Backend server error: {error}"));
        }
        let mut inner = state.inner.lock().expect("state poisoned");
        inner.shutdown = None;
        inner.rpc_connected = false;
        inner.rpc_connecting = false;
        inner.rpc = None;
    });

    Ok(())
}

async fn bind_listener_with_fallback(
    state: &AppState,
    port: u16,
) -> Result<(tokio::net::TcpListener, u16), String> {
    match bind_listener(port).await {
        Ok(listener) => Ok((listener, port)),
        Err(first_error) => {
            if port != DEFAULT_PORT {
                if let Ok(listener) = bind_listener(DEFAULT_PORT).await {
                    set_log(
                        state,
                        format!(
                            "Port {port} was busy ({first_error}). Using http://localhost:{DEFAULT_PORT}"
                        ),
                    );
                    return Ok((listener, DEFAULT_PORT));
                }
            }

            if port == LEGACY_PORT {
                Err(format!(
                    "Could not bind port {port}: {first_error}. Another local app is using the old Activity Status port."
                ))
            } else {
                Err(format!("Could not bind port {port}: {first_error}"))
            }
        }
    }
}

async fn bind_listener(port: u16) -> std::io::Result<tokio::net::TcpListener> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tokio::net::TcpListener::bind(addr).await
}

async fn stop_server(state: AppState) -> Result<(), String> {
    let shutdown = {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.last_log = "Stopping backend...".to_string();
        close_rpc_client(inner.rpc.take());
        inner.rpc_connected = false;
        inner.rpc_connecting = false;
        inner.shutdown.take()
    };

    if let Some(shutdown) = shutdown {
        let _ = shutdown.send(());
    }
    set_log(&state, "Backend stopped.".to_string());
    Ok(())
}

async fn reconnect_discord(state: AppState) -> Result<(), String> {
    disconnect_rpc(&state, "Reconnecting Discord RPC...")?;
    connect_rpc(&state).await
}

async fn connect_rpc(state: &AppState) -> Result<(), String> {
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        if inner.rpc_connecting {
            return Err("Discord RPC is already reconnecting.".to_string());
        }
        close_rpc_client(inner.rpc.take());
        inner.rpc_connected = false;
        inner.rpc_connecting = true;
        inner.last_rpc_error = None;
        inner.last_log = "Connecting Discord RPC...".to_string();
    }

    let result = connect_rpc_with_retry().await;

    match result {
        Ok(client) => {
            let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
            inner.rpc = Some(client);
            inner.rpc_connected = true;
            inner.rpc_connecting = false;
            inner.last_rpc_error = None;
            inner.last_log = "Discord RPC connected.".to_string();
            Ok(())
        }
        Err(message) => {
            let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
            inner.rpc = None;
            inner.rpc_connected = false;
            inner.rpc_connecting = false;
            inner.last_rpc_error = Some(message.clone());
            inner.last_log = format!("Discord RPC failed: {message}");
            Err(message)
        }
    }
}

async fn connect_rpc_with_retry() -> Result<DiscordIpcClient, String> {
    let mut last_error = String::new();
    for attempt in 1..=2 {
        match connect_rpc_once().await {
            Ok(client) => return Ok(client),
            Err(error) => {
                last_error = error;
                if attempt == 1 {
                    tokio::time::sleep(Duration::from_millis(550)).await;
                }
            }
        }
    }
    Err(last_error)
}

async fn connect_rpc_once() -> Result<DiscordIpcClient, String> {
    match tokio::time::timeout(
        RPC_CONNECT_TIMEOUT,
        tokio::task::spawn_blocking(|| {
            let mut client = DiscordIpcClient::new(CLIENT_ID);
            client
                .connect()
                .map(|()| client)
                .map_err(|error| error.to_string())
        }),
    )
    .await
    {
        Ok(join_result) => join_result.map_err(|error| error.to_string())?,
        Err(_) => {
            Err("Discord RPC connection timed out. Make sure Discord desktop is open.".to_string())
        }
    }
}

fn disconnect_rpc(state: &AppState, log: &str) -> Result<(), String> {
    let rpc = {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.rpc_connected = false;
        inner.rpc_connecting = false;
        inner.last_log = log.to_string();
        inner.rpc.take()
    };
    close_rpc_client(rpc);
    Ok(())
}

fn close_rpc_client(client: Option<DiscordIpcClient>) {
    if let Some(mut rpc) = client {
        let _ = rpc.close();
    }
}

fn apply_launch_at_login<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let is_enabled = autolaunch.is_enabled().map_err(|error| error.to_string())?;
    match (enabled, is_enabled) {
        (true, false) => autolaunch.enable().map_err(|error| error.to_string())?,
        (false, true) => autolaunch.disable().map_err(|error| error.to_string())?,
        _ => {}
    }
    Ok(())
}

fn open_chrome_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Google Chrome", url])
            .status()
            .map_err(|error| error.to_string())
            .and_then(status_result)
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .map_err(|error| error.to_string())
            .and_then(status_result)
    }

    #[cfg(target_os = "linux")]
    {
        let browsers = [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
        ];
        for browser in browsers {
            if let Ok(status) = Command::new(browser).arg(url).status() {
                if status.success() {
                    return Ok(());
                }
            }
        }
        open::that("https://support.google.com/chrome_webstore/answer/2664769")
            .map_err(|error| error.to_string())
    }
}

fn status_result(status: std::process::ExitStatus) -> Result<(), String> {
    if status.success() {
        Ok(())
    } else {
        Err(format!("Chrome command exited with status {status}"))
    }
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(api_status_payload(&state))
}

async fn api_status(State(state): State<AppState>) -> impl IntoResponse {
    Json(api_status_payload(&state))
}

async fn reconnect_activity_rpc(State(state): State<AppState>) -> impl IntoResponse {
    match reconnect_discord(state.clone()).await {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiMessage::success("Discord RPC reconnected")),
        ),
        Err(error) => {
            set_log(&state, format!("Discord RPC reconnect failed: {error}"));
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiMessage::error(error)),
            )
        }
    }
}

async fn clear_activity(State(state): State<AppState>) -> impl IntoResponse {
    clear_activity_response(&state)
}

fn clear_activity_response(state: &AppState) -> (StatusCode, Json<ApiMessage>) {
    let mut inner = state.inner.lock().expect("state poisoned");
    if let Some(mut rpc) = inner.rpc.take() {
        match rpc.clear_activity() {
            Ok(()) => {
                inner.rpc = Some(rpc);
                inner.rpc_connected = true;
                inner.last_activity = None;
                inner.activity_inbox.clear();
                inner.selected_activity_id = None;
                inner.last_log = "Discord activity cleared.".to_string();
                return (
                    StatusCode::OK,
                    Json(ApiMessage::success("Activity cleared")),
                );
            }
            Err(error) => {
                let message = error.to_string();
                close_rpc_client(Some(rpc));
                inner.last_rpc_error = Some(message.clone());
                inner.rpc_connected = false;
                inner.rpc_connecting = false;
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiMessage::error(message)),
                );
            }
        }
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ApiMessage::error("Discord RPC not connected")),
    )
}

async fn update_activity(
    State(state): State<AppState>,
    Json(payload): Json<IncomingActivity>,
) -> impl IntoResponse {
    {
        let mut inner = state.inner.lock().expect("state poisoned");
        inner.activity_inbox = vec![activity_entry_from_payload(&payload)];
        inner.selected_activity_id = None;
    }
    apply_activity_payload(&state, payload)
}

async fn report_activities(
    State(state): State<AppState>,
    Json(report): Json<ActivityReport>,
) -> impl IntoResponse {
    let activities = normalize_activity_report(report.activities);
    let previous_selected_id = state
        .inner
        .lock()
        .expect("state poisoned")
        .selected_activity_id
        .clone();
    let selected_id = report
        .selected_activity_id
        .or(previous_selected_id)
        .filter(|id| {
            activities
                .iter()
                .any(|activity| activity_id(activity).as_str() == id.as_str())
        });
    let auto_pick_mode = report.auto_pick_mode.unwrap_or_else(|| "smart".to_string());
    let chosen = choose_report_activity(&activities, selected_id.as_deref(), &auto_pick_mode);

    {
        let mut inner = state.inner.lock().expect("state poisoned");
        inner.activity_inbox = activities.iter().map(activity_entry_from_payload).collect();
        inner.selected_activity_id = selected_id.clone();
    }

    if let Some(activity) = chosen {
        apply_activity_payload(&state, activity)
    } else {
        clear_activity_response(&state)
    }
}

async fn select_activity(
    State(state): State<AppState>,
    Json(selection): Json<SelectActivityRequest>,
) -> impl IntoResponse {
    let selected = select_activity_from_inbox(&state, selection.selected_activity_id);

    if let Some(activity) = selected {
        apply_activity_payload(&state, payload_from_activity_entry(&activity))
    } else {
        (
            StatusCode::OK,
            Json(ApiMessage::success("Companion returned to auto selection")),
        )
    }
}

fn select_activity_from_inbox(
    state: &AppState,
    activity_id: Option<String>,
) -> Option<ActivityEntry> {
    let mut inner = state.inner.lock().expect("state poisoned");
    let selected = activity_id
        .as_ref()
        .and_then(|id| {
            inner
                .activity_inbox
                .iter()
                .find(|activity| &activity.id == id)
        })
        .cloned();
    inner.selected_activity_id = selected.as_ref().map(|activity| activity.id.clone());
    selected
}

fn normalize_activity_report(activities: Vec<IncomingActivity>) -> Vec<IncomingActivity> {
    let mut entries = activities
        .into_iter()
        .filter(|activity| {
            activity
                .details
                .as_deref()
                .map(|details| !details.trim().is_empty())
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| {
        let a_time = a.last_seen.unwrap_or(0);
        let b_time = b.last_seen.unwrap_or(0);
        b.is_active_tab
            .unwrap_or(false)
            .cmp(&a.is_active_tab.unwrap_or(false))
            .then_with(|| b_time.cmp(&a_time))
    });
    entries.truncate(20);
    entries
}

fn choose_report_activity(
    activities: &[IncomingActivity],
    selected_id: Option<&str>,
    auto_pick_mode: &str,
) -> Option<IncomingActivity> {
    if let Some(id) = selected_id {
        if let Some(activity) = activities
            .iter()
            .find(|activity| activity_id(activity) == id)
        {
            return Some(activity.clone());
        }
    }

    if let Some(activity) = activities
        .iter()
        .find(|activity| activity.is_active_tab == Some(true))
    {
        return Some(activity.clone());
    }

    if auto_pick_mode == "active" {
        None
    } else {
        activities.first().cloned()
    }
}

fn activity_entry_from_payload(payload: &IncomingActivity) -> ActivityEntry {
    ActivityEntry {
        id: activity_id(payload),
        tab_id: payload.tab_id,
        tab_title: payload.tab_title.clone(),
        platform: truncate(payload.platform.as_deref().unwrap_or("Browser"), 64),
        details: truncate(
            payload.details.as_deref().unwrap_or("Browser Activity"),
            128,
        ),
        state: truncate(payload.state.as_deref().unwrap_or("Active"), 128),
        url: payload.url.clone().or_else(|| payload.source_url.clone()),
        large_image_key: payload.large_image_key.clone(),
        large_image_text: payload.large_image_text.clone(),
        thumbnail_url: payload.thumbnail_url.clone(),
        small_image_key: payload.small_image_key.clone(),
        small_image_text: payload.small_image_text.clone(),
        is_playing: payload.is_playing,
        media_current_time: payload.media_current_time,
        media_duration: payload.media_duration,
        is_active_tab: payload.is_active_tab.unwrap_or(false),
        last_seen: payload.last_seen.unwrap_or_else(now_millis),
    }
}

fn payload_from_activity_entry(entry: &ActivityEntry) -> IncomingActivity {
    IncomingActivity {
        id: Some(entry.id.clone()),
        tab_id: entry.tab_id,
        tab_title: entry.tab_title.clone(),
        details: Some(entry.details.clone()),
        state: Some(entry.state.clone()),
        platform: Some(entry.platform.clone()),
        large_image_key: entry
            .large_image_key
            .clone()
            .or_else(|| Some(asset_key_for_platform(&entry.platform).to_string())),
        large_image_text: entry
            .large_image_text
            .clone()
            .or_else(|| Some(format!("Using {}", entry.platform))),
        thumbnail_url: entry.thumbnail_url.clone(),
        small_image_key: entry.small_image_key.clone(),
        small_image_text: entry.small_image_text.clone(),
        is_playing: entry.is_playing,
        media_current_time: entry.media_current_time,
        media_duration: entry.media_duration,
        url: entry.url.clone(),
        source_url: entry.url.clone(),
        is_active_tab: Some(entry.is_active_tab),
        last_seen: Some(entry.last_seen),
    }
}

fn activity_id(payload: &IncomingActivity) -> String {
    if let Some(id) = payload.id.as_deref().filter(|id| !id.trim().is_empty()) {
        return id.to_string();
    }
    if let Some(tab_id) = payload.tab_id {
        return format!("tab:{tab_id}");
    }
    let platform = payload.platform.as_deref().unwrap_or("browser");
    let details = payload.details.as_deref().unwrap_or("activity");
    format!("{platform}:{details}")
}

fn asset_key_for_platform(platform: &str) -> &'static str {
    match platform.to_lowercase().replace(' ', "").as_str() {
        "youtube" => "youtube",
        "netflix" => "netflix",
        "spotify" => "spotify",
        "twitch" => "twitch",
        "discord" => "discord",
        "googlemeet" | "meet" => "meet",
        "github" => "github",
        "chatgpt" => "chatgpt",
        "hotstar" => "hotstar",
        "crunchyroll" => "crunchyroll",
        "wikipedia" => "wikipedia",
        "google" => "google",
        "manual" => "manual",
        _ => "manual",
    }
}

fn discord_image_ref(payload: &IncomingActivity, platform: &str) -> Option<String> {
    let thumbnail = payload.thumbnail_url.as_deref().unwrap_or_default();
    let url = payload
        .url
        .as_deref()
        .or(payload.source_url.as_deref())
        .unwrap_or_default();
    let platform_key = platform.to_lowercase().replace(' ', "");

    if platform_key == "youtube" {
        if let Some(video_id) = youtube_video_id(thumbnail).or_else(|| youtube_video_id(url)) {
            return Some(format!("youtube:{video_id}"));
        }
    }

    if platform_key == "spotify" {
        if let Some(image_id) = spotify_image_id(thumbnail) {
            return Some(format!("spotify:{image_id}"));
        }
    }

    if platform_key == "twitch" {
        if let Some(channel) = twitch_channel(url).or_else(|| twitch_channel(thumbnail)) {
            return Some(format!("twitch:{channel}"));
        }
    }

    discord_media_proxy_ref(thumbnail).or_else(|| {
        if thumbnail.starts_with("https://") {
            Some(thumbnail.to_string())
        } else {
            None
        }
    })
}

fn youtube_video_id(value: &str) -> Option<String> {
    if let Some(after) = value.split("/vi/").nth(1) {
        return after
            .split(['/', '?', '&'])
            .next()
            .filter(|id| !id.is_empty())
            .map(ToString::to_string);
    }

    if let Some(after) = value.split("youtu.be/").nth(1) {
        return after
            .split(['/', '?', '&'])
            .next()
            .filter(|id| !id.is_empty())
            .map(ToString::to_string);
    }

    value
        .split(['?', '&'])
        .find_map(|part| part.strip_prefix("v="))
        .filter(|id| !id.is_empty())
        .map(ToString::to_string)
}

fn spotify_image_id(value: &str) -> Option<String> {
    value
        .split("/image/")
        .nth(1)
        .and_then(|after| after.split(['?', '/', '&']).next())
        .filter(|id| !id.is_empty())
        .map(ToString::to_string)
}

fn twitch_channel(value: &str) -> Option<String> {
    if let Some(after) = value.split("twitch.tv/").nth(1) {
        return after
            .split(['/', '?', '&'])
            .next()
            .filter(|channel| !channel.is_empty())
            .map(|channel| channel.to_lowercase());
    }

    value
        .split("live_user_")
        .nth(1)
        .and_then(|after| after.split(['-', '.', '/', '?', '&']).next())
        .filter(|channel| !channel.is_empty())
        .map(|channel| channel.to_lowercase())
}

fn discord_media_proxy_ref(value: &str) -> Option<String> {
    value
        .split("media.discordapp.net/external/")
        .nth(1)
        .or_else(|| value.split("cdn.discordapp.com/external/").nth(1))
        .filter(|path| !path.is_empty())
        .map(|path| format!("mp:external/{path}"))
}

fn apply_activity_payload(
    state: &AppState,
    payload: IncomingActivity,
) -> (StatusCode, Json<ApiMessage>) {
    let details = truncate(
        payload.details.as_deref().unwrap_or("Browser Activity"),
        128,
    );
    let presence_state = truncate(
        payload.state.as_deref().unwrap_or("Doing something cool"),
        128,
    );
    let platform = truncate(payload.platform.as_deref().unwrap_or("Browser"), 64);
    let resolved_large_image = discord_image_ref(&payload, &platform);
    let mut activity = Activity::new()
        .details(details.clone())
        .state(presence_state.clone());

    let mut assets = Assets::new().small_text(platform.clone());
    let large_image = resolved_large_image.clone().or_else(|| {
        payload
            .large_image_key
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    });
    if let Some(key) = large_image {
        assets = assets.large_image(key);
    }
    if let Some(text) = payload
        .large_image_text
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        assets = assets.large_text(truncate(text, 128));
    }
    if let Some(key) = payload
        .small_image_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        assets = assets.small_image(key.to_string());
    }
    if let Some(text) = payload
        .small_image_text
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        assets = assets.small_text(truncate(text, 128));
    }
    activity = activity.assets(assets);

    if payload.is_playing == Some(true) {
        if let (Some(current), Some(duration)) =
            (payload.media_current_time, payload.media_duration)
        {
            let now_ms = now_millis();
            let start = now_ms - (current.max(0.0) * 1000.0) as i64;
            let end = now_ms + ((duration - current).max(0.0) * 1000.0) as i64;
            activity = activity.timestamps(Timestamps::new().start(start).end(end));
        }
    }

    if let Some(url) = payload
        .url
        .as_deref()
        .filter(|value| value.starts_with("https://"))
    {
        let label = truncate(&format!("Open {platform}"), 32);
        activity = activity.buttons(vec![Button::new(label, url.to_string())]);
    }

    let mut inner = state.inner.lock().expect("state poisoned");
    if !inner.rpc_connected {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiMessage::error("Discord RPC not connected")),
        );
    }

    if let Some(mut rpc) = inner.rpc.take() {
        match rpc.set_activity(activity) {
            Ok(()) => {
                inner.rpc = Some(rpc);
                inner.rpc_connected = true;
                inner.last_activity = Some(ActivitySnapshot {
                    id: Some(activity_id(&payload)),
                    tab_id: payload.tab_id,
                    tab_title: payload.tab_title,
                    platform,
                    details,
                    state: presence_state,
                    url: payload.url.or(payload.source_url),
                    is_active_tab: payload.is_active_tab.unwrap_or(false),
                    large_image_key: resolved_large_image
                        .or(payload.thumbnail_url)
                        .or(payload.large_image_key),
                    small_image_key: payload.small_image_key,
                    updated_at: Utc::now().to_rfc3339(),
                });
                inner.last_log = "Discord activity updated.".to_string();
                (
                    StatusCode::OK,
                    Json(ApiMessage::success("Activity updated")),
                )
            }
            Err(error) => {
                let message = error.to_string();
                close_rpc_client(Some(rpc));
                inner.rpc_connected = false;
                inner.rpc_connecting = false;
                inner.last_rpc_error = Some(message.clone());
                inner.last_log = format!("Discord activity failed: {message}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiMessage::error(message)),
                )
            }
        }
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiMessage::error("Discord RPC not connected")),
        )
    }
}

fn api_status_payload(state: &AppState) -> ApiStatus {
    let inner = state.inner.lock().expect("state poisoned");
    ApiStatus {
        discord_rpc: if inner.rpc_connected {
            "connected"
        } else {
            "disconnected"
        }
        .to_string(),
        last_rpc_error: inner.last_rpc_error.clone(),
        last_activity: inner.last_activity.clone(),
        activities: inner.activity_inbox.clone(),
        selected_activity_id: inner.selected_activity_id.clone(),
        uptime_seconds: inner.started_at.elapsed().as_secs(),
        timestamp: Utc::now().to_rfc3339(),
    }
}

fn companion_status(state: &AppState) -> CompanionStatus {
    let inner = state.inner.lock().expect("state poisoned");
    CompanionStatus {
        backend: if inner.shutdown.is_some() {
            "online"
        } else {
            "offline"
        }
        .to_string(),
        discord: if inner.rpc_connected {
            "connected"
        } else if inner.rpc_connecting {
            "connecting"
        } else {
            "disconnected"
        }
        .to_string(),
        last_activity: inner
            .last_activity
            .as_ref()
            .map(|activity| activity.details.clone())
            .unwrap_or_else(|| "None".to_string()),
        last_rpc_error: inner.last_rpc_error.clone(),
        log: inner.last_log.clone(),
        url: format!("http://localhost:{}", inner.settings.port),
        activities: inner.activity_inbox.clone(),
        selected_activity_id: inner.selected_activity_id.clone(),
        current_activity_id: inner
            .last_activity
            .as_ref()
            .and_then(|activity| activity.id.clone()),
        update: UpdateStatus {
            state: "manual".to_string(),
            message: "Tauri builds update through GitHub releases for now.".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            available_version: None,
            progress: None,
        },
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, state: &AppState) {
    let _ = app.emit("status:update", companion_status(state));
}

fn set_log(state: &AppState, log: String) {
    if let Ok(mut inner) = state.inner.lock() {
        inner.last_log = log;
    }
}

fn truncate(value: &str, max: usize) -> String {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() <= max {
        cleaned
    } else {
        let mut truncated = cleaned
            .chars()
            .take(max.saturating_sub(1))
            .collect::<String>();
        truncated.push('…');
        truncated
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as i64
}

impl ApiMessage {
    fn success(message: &str) -> Self {
        Self {
            success: true,
            message: message.to_string(),
            timestamp: Utc::now().to_rfc3339(),
        }
    }

    fn error<S: Into<String>>(message: S) -> Self {
        Self {
            success: false,
            message: message.into(),
            timestamp: Utc::now().to_rfc3339(),
        }
    }
}

fn normalize_settings(settings: Settings) -> Settings {
    Settings {
        auto_start_backend: settings.auto_start_backend,
        launch_at_login: settings.launch_at_login,
        hide_popover_on_blur: settings.hide_popover_on_blur,
        port: if (1024..=65535).contains(&settings.port) {
            settings.port
        } else {
            DEFAULT_PORT
        },
    }
}

fn read_settings() -> Settings {
    settings_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|value| serde_json::from_str::<Settings>(&value).ok())
        .map(normalize_settings)
        .unwrap_or(Settings {
            auto_start_backend: true,
            launch_at_login: false,
            hide_popover_on_blur: true,
            port: DEFAULT_PORT,
        })
}

fn write_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path().ok_or_else(|| "Could not resolve settings path".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("activity-status-companion").join("settings.json"))
}
