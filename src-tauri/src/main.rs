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
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State as TauriState, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::oneshot;
use tower_http::cors::CorsLayer;

const CLIENT_ID: &str = "1506289512207093890";
const DEFAULT_PORT: u16 = 3000;

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<InnerState>>,
}

struct InnerState {
    settings: Settings,
    rpc: Option<DiscordIpcClient>,
    rpc_connected: bool,
    last_rpc_error: Option<String>,
    last_activity: Option<ActivitySnapshot>,
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
struct ActivitySnapshot {
    platform: String,
    details: String,
    state: String,
    large_image_key: Option<String>,
    small_image_key: Option<String>,
    updated_at: String,
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
    uptime_seconds: u64,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomingActivity {
    details: Option<String>,
    state: Option<String>,
    platform: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    is_playing: Option<bool>,
    media_current_time: Option<f64>,
    media_duration: Option<f64>,
    url: Option<String>,
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
            last_rpc_error: None,
            last_activity: None,
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
            open_chrome_extensions,
            copy_text,
            check_for_updates,
            install_update,
            show_settings,
            hide_main_if_configured,
            quit_app
        ])
        .setup(move |app| {
            setup_tray(app.handle(), state.clone())?;
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

fn setup_tray<R: Runtime>(app: &AppHandle<R>, state: AppState) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Activity Status", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Start Backend", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Backend", true, None::<&str>)?;
    let reconnect = MenuItem::with_id(
        app,
        "reconnect",
        "Reconnect Discord RPC",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &start, &stop, &reconnect, &quit])?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    TrayIconBuilder::with_id("activity-status")
        .tooltip("Activity Status Companion")
        .icon(icon)
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let state = state.clone();
            match event.id.as_ref() {
                "open" => show_window(app, "main"),
                "settings" => show_window(app, "settings"),
                "start" => spawn_command(app, state, start_server),
                "stop" => spawn_command(app, state, stop_server),
                "reconnect" => spawn_command(app, state, reconnect_discord),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle(), "main");
            }
        })
        .build(app)?;
    Ok(())
}

fn spawn_command<F, Fut, R>(app: &AppHandle<R>, state: AppState, command: F)
where
    F: Fn(AppState) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<(), String>> + Send + 'static,
    R: Runtime,
{
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = command(state.clone()).await {
            set_log(&state, error);
        }
        emit_status(&app_handle, &state);
    });
}

fn toggle_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
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
async fn open_chrome_extensions() -> Result<(), String> {
    open_chrome_url("chrome://extensions/")
}

#[tauri::command]
async fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_for_updates(state: TauriState<'_, AppState>) -> Result<CompanionStatus, String> {
    Ok(companion_status(&state))
}

#[tauri::command]
async fn install_update() -> bool {
    false
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
    let (port, already_running) = {
        let inner = state.inner.lock().map_err(|error| error.to_string())?;
        (inner.settings.port, inner.shutdown.is_some())
    };
    if already_running {
        set_log(&state, "Backend already running.".to_string());
        return Ok(());
    }

    connect_rpc(&state)?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.shutdown = Some(shutdown_tx);
        inner.started_at = Instant::now();
        inner.last_log = format!("Backend listening on http://localhost:{port}");
    }

    let router = Router::new()
        .route("/health", get(health))
        .route("/api/status", get(api_status))
        .route("/api/update-activity", post(update_activity))
        .route("/api/clear-activity", post(clear_activity))
        .route("/api/reconnect-rpc", post(reconnect_activity_rpc))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|error| format!("Could not bind port {port}: {error}"))?;

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
        inner.rpc = None;
    });

    Ok(())
}

async fn stop_server(state: AppState) -> Result<(), String> {
    let shutdown = {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.last_log = "Stopping backend...".to_string();
        inner.rpc = None;
        inner.rpc_connected = false;
        inner.shutdown.take()
    };

    if let Some(shutdown) = shutdown {
        let _ = shutdown.send(());
    }
    set_log(&state, "Backend stopped.".to_string());
    Ok(())
}

async fn reconnect_discord(state: AppState) -> Result<(), String> {
    connect_rpc(&state)
}

fn connect_rpc(state: &AppState) -> Result<(), String> {
    let mut client = DiscordIpcClient::new(CLIENT_ID);
    match client.connect() {
        Ok(()) => {
            let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
            inner.rpc = Some(client);
            inner.rpc_connected = true;
            inner.last_rpc_error = None;
            inner.last_log = "Discord RPC connected.".to_string();
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
            inner.rpc = None;
            inner.rpc_connected = false;
            inner.last_rpc_error = Some(message.clone());
            inner.last_log = format!("Discord RPC failed: {message}");
            Err(message)
        }
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
    let mut inner = state.inner.lock().expect("state poisoned");
    if let Some(rpc) = inner.rpc.as_mut() {
        match rpc.clear_activity() {
            Ok(()) => {
                inner.last_activity = None;
                inner.last_log = "Discord activity cleared.".to_string();
                return (
                    StatusCode::OK,
                    Json(ApiMessage::success("Activity cleared")),
                );
            }
            Err(error) => {
                let message = error.to_string();
                inner.last_rpc_error = Some(message.clone());
                inner.rpc_connected = false;
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
    let details = truncate(
        payload.details.as_deref().unwrap_or("Browser Activity"),
        128,
    );
    let presence_state = truncate(
        payload.state.as_deref().unwrap_or("Doing something cool"),
        128,
    );
    let platform = truncate(payload.platform.as_deref().unwrap_or("Browser"), 64);
    let mut activity = Activity::new()
        .details(details.clone())
        .state(presence_state.clone());

    let mut assets = Assets::new().small_text(platform.clone());
    if let Some(key) = payload
        .large_image_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        assets = assets.large_image(key.to_string());
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

    if let Some(rpc) = inner.rpc.as_mut() {
        match rpc.set_activity(activity) {
            Ok(()) => {
                inner.last_activity = Some(ActivitySnapshot {
                    platform,
                    details,
                    state: presence_state,
                    large_image_key: payload.large_image_key,
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
                inner.rpc_connected = false;
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
