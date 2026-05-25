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
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State as TauriState, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::sync::oneshot;
use tower_http::cors::CorsLayer;

const CLIENT_ID: &str = "1506289512207093890";
const DEFAULT_PORT: u16 = 17654;
const LEGACY_PORT: u16 = 3000;
const RPC_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const RELEASES_URL: &str = "https://github.com/GSUS2K/discord-status/releases/latest";
const DEFAULT_SELECTOR_SHORTCUT: &str = "CommandOrControl+Shift+Y";

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
    last_extension_seen: Option<String>,
    system_activity: Option<SystemActivity>,
    system_apps: Vec<SystemActivity>,
    last_log: String,
    started_at: Instant,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default = "default_true")]
    auto_start_backend: bool,
    #[serde(default)]
    launch_at_login: bool,
    #[serde(default = "default_true")]
    hide_popover_on_blur: bool,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default)]
    system_activity_enabled: bool,
    #[serde(default)]
    system_activity_allowed_apps: Vec<String>,
    #[serde(default = "default_selector_shortcut")]
    selector_shortcut: String,
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
    extension_connected: bool,
    last_extension_seen: Option<String>,
    system_activity: Option<SystemActivity>,
    system_apps: Vec<SystemActivity>,
    update: UpdateStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemActivity {
    id: String,
    app_name: String,
    details: String,
    icon_key: String,
    is_foreground: bool,
    updated_at: String,
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
    extension_connected: bool,
    last_extension_seen: Option<String>,
    system_activity: Option<SystemActivity>,
    system_apps: Vec<SystemActivity>,
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
            last_extension_seen: None,
            system_activity: None,
            system_apps: Vec::new(),
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            set_settings,
            start_backend,
            stop_backend,
            restart_backend,
            fix_connection,
            reconnect_rpc,
            select_activity_id,
            show_selector,
            hide_selector,
            open_chrome_extensions,
            copy_text,
            check_for_updates,
            install_update,
            show_settings,
            hide_main_if_configured,
            quit_app,
            refresh_system_apps,
            set_system_app_allowed
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            setup_tray(app.handle())?;
            if let Err(error) =
                register_selector_shortcut(app.handle(), &settings.selector_shortcut)
            {
                set_log(&state, format!("Status selector shortcut failed: {error}"));
            }
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
            spawn_system_activity_monitor(app.handle().clone(), state.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Activity Status Companion");
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
    let open = MenuItem::with_id(app, "open", "Open Activity Status", true, None::<&str>)?;
    let selector = MenuItem::with_id(app, "selector", "Select Discord Status", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let chrome = MenuItem::with_id(app, "chrome", "Open Chrome Extensions", true, None::<&str>)?;
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
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &selector,
            &settings,
            &chrome,
            &separator_one,
            &start,
            &stop,
            &reconnect,
            &separator_two,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("activity-status")
        .tooltip("Activity Status Companion")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app, "main"),
            "selector" => show_selector_window(app),
            "settings" => show_window(app, "settings"),
            "chrome" => {
                let _ = open_chrome_url("chrome://extensions/");
            }
            "start" => {
                let app = app.clone();
                let state = app.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = start_server(state.clone()).await {
                        set_log(&state, format!("Backend start failed: {error}"));
                    }
                    emit_status(&app, &state);
                });
            }
            "stop" => {
                let app = app.clone();
                let state = app.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = stop_server(state.clone()).await {
                        set_log(&state, format!("Backend stop failed: {error}"));
                    }
                    emit_status(&app, &state);
                });
            }
            "reconnect" => {
                let app = app.clone();
                let state = app.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = reconnect_discord(state.clone()).await {
                        set_log(&state, format!("Discord RPC reconnect failed: {error}"));
                    }
                    emit_status(&app, &state);
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
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

fn toggle_selector_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("selector") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_selector_window(app);
        }
    }
}

fn show_selector_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("selector") {
        let _ = window.center();
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
    register_selector_shortcut(&app, &settings.selector_shortcut)?;
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
async fn fix_connection(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    let state_clone = state.inner().clone();
    set_log(
        &state_clone,
        "Fixing connection: restarting backend and Discord RPC...".to_string(),
    );
    let _ = stop_server(state_clone.clone()).await;
    start_server(state_clone.clone()).await?;
    if let Err(error) = reconnect_discord(state_clone.clone()).await {
        set_log(
            &state_clone,
            format!("Backend fixed, but Discord RPC still needs attention: {error}"),
        );
    } else {
        set_log(
            &state_clone,
            "Connection fixed. Backend and Discord RPC are online.".to_string(),
        );
    }
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
async fn show_selector(app: AppHandle) -> Result<(), String> {
    show_selector_window(&app);
    Ok(())
}

#[tauri::command]
async fn hide_selector(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("selector") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
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

#[tauri::command]
async fn refresh_system_apps(
    app: AppHandle,
    state: TauriState<'_, AppState>,
) -> Result<Vec<SystemActivity>, String> {
    let apps = detect_running_apps();
    let now = Utc::now().to_rfc3339();
    let foreground = detect_foreground_app();
    let snapshots = apps
        .into_iter()
        .map(|app_name| system_activity_snapshot(&app_name, foreground.as_deref(), &now))
        .collect::<Vec<_>>();
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        for snapshot in snapshots {
            remember_system_app(&mut inner, snapshot);
        }
    }
    emit_status(&app, &state);
    Ok(state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .system_apps
        .clone())
}

#[tauri::command]
async fn set_system_app_allowed(
    app: AppHandle,
    app_name: String,
    allowed: bool,
    state: TauriState<'_, AppState>,
) -> Result<Settings, String> {
    let app_name = app_name.trim().to_string();
    if app_name.is_empty() {
        return Err("Choose an app first.".to_string());
    }
    let settings = {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        if allowed {
            if !inner
                .settings
                .system_activity_allowed_apps
                .iter()
                .any(|value| value.eq_ignore_ascii_case(&app_name))
            {
                inner
                    .settings
                    .system_activity_allowed_apps
                    .push(app_name.clone());
            }
            inner.settings.system_activity_enabled = true;
        } else {
            inner
                .settings
                .system_activity_allowed_apps
                .retain(|value| !value.eq_ignore_ascii_case(&app_name));
        }
        inner.settings.clone()
    };
    write_settings(&settings)?;
    set_log(
        &state,
        if allowed {
            format!("{app_name} can now become Discord status.")
        } else {
            format!("{app_name} will no longer become Discord status.")
        },
    );
    emit_status(&app, &state);
    Ok(settings)
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

fn mark_extension_seen(state: &AppState) {
    if let Ok(mut inner) = state.inner.lock() {
        inner.last_extension_seen = Some(Utc::now().to_rfc3339());
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

fn spawn_system_activity_monitor(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(8)).await;
            let settings = match state.inner.lock() {
                Ok(inner) => inner.settings.clone(),
                Err(_) => continue,
            };
            if !settings.system_activity_enabled {
                continue;
            }

            let Some(app_name) = detect_foreground_app() else {
                continue;
            };
            let now = Utc::now().to_rfc3339();
            let allowed = settings
                .system_activity_allowed_apps
                .iter()
                .map(|value| value.to_lowercase())
                .collect::<Vec<_>>();
            let is_allowed = !allowed.is_empty()
                && allowed
                    .iter()
                    .any(|value| app_name.to_lowercase().contains(value));

            let snapshot = system_activity_snapshot(&app_name, Some(&app_name), &now);
            let should_apply = {
                let mut inner = match state.inner.lock() {
                    Ok(inner) => inner,
                    Err(_) => continue,
                };
                inner.system_activity = Some(snapshot.clone());
                remember_system_app(&mut inner, snapshot.clone());
                is_allowed && inner.activity_inbox.is_empty() && inner.rpc_connected
            };

            if should_apply {
                let payload = IncomingActivity {
                    id: Some(format!("system:{}", app_name.to_lowercase())),
                    tab_id: None,
                    tab_title: None,
                    details: Some(snapshot.details.clone()),
                    state: Some("System app".to_string()),
                    platform: Some(snapshot.app_name.clone()),
                    large_image_key: Some(snapshot.icon_key.clone()),
                    large_image_text: Some(format!("Using {}", snapshot.app_name)),
                    thumbnail_url: None,
                    small_image_key: None,
                    small_image_text: None,
                    is_playing: None,
                    media_current_time: None,
                    media_duration: None,
                    url: None,
                    source_url: None,
                    is_active_tab: Some(false),
                    last_seen: Some(now_millis()),
                };
                let _ = apply_activity_payload(&state, payload);
            }
            emit_status(&app, &state);
        }
    });
}

fn system_activity_snapshot(app_name: &str, foreground: Option<&str>, now: &str) -> SystemActivity {
    let app_name = app_name.trim();
    SystemActivity {
        id: format!("system:{}", normalize_app_key(app_name)),
        app_name: app_name.to_string(),
        details: format!("Using {app_name}"),
        icon_key: system_icon_key(app_name).to_string(),
        is_foreground: foreground
            .map(|value| value.eq_ignore_ascii_case(app_name))
            .unwrap_or(false),
        updated_at: now.to_string(),
    }
}

fn remember_system_app(inner: &mut InnerState, snapshot: SystemActivity) {
    inner
        .system_apps
        .retain(|item| !item.app_name.eq_ignore_ascii_case(&snapshot.app_name));
    inner.system_apps.insert(0, snapshot);
    inner.system_apps.truncate(20);
}

fn normalize_app_key(value: &str) -> String {
    value
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .flat_map(|char| char.to_lowercase())
        .collect::<String>()
}

fn system_icon_key(app_name: &str) -> &'static str {
    let key = normalize_app_key(app_name);
    match key.as_str() {
        "discord" => "discord",
        "googlechrome" | "chrome" => "google",
        "safari" => "google",
        "spotify" => "spotify",
        "visualstudiocode" | "code" | "vscode" => "vscode",
        "githubdesktop" => "github",
        "steam" => "steam",
        "notion" => "notion",
        "figma" => "figma",
        "slack" => "discord",
        "terminal" | "iterm2" | "windowsterminal" | "powershell" | "cmd" => "terminal",
        "finder" | "explorer" => "files",
        _ => "manual",
    }
}

fn detect_foreground_app() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        run_command_text(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to get name of first application process whose frontmost is true",
            ],
        )
    }

    #[cfg(target_os = "windows")]
    {
        run_command_text(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class W { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); }\n'@; $hwnd=[W]::GetForegroundWindow(); [uint32]$pid=0; [void][W]::GetWindowThreadProcessId($hwnd,[ref]$pid); (Get-Process -Id $pid).ProcessName",
            ],
        )
    }

    #[cfg(target_os = "linux")]
    {
        run_command_text(
            "sh",
            &[
                "-lc",
                "pid=$(xdotool getactivewindow getwindowpid 2>/dev/null) && ps -p \"$pid\" -o comm= 2>/dev/null",
            ],
        )
    }
}

fn detect_running_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        return run_command_text(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to get name of every application process whose background only is false",
            ],
        )
        .map(|value| split_app_names(&value))
        .unwrap_or_default();
    }

    #[cfg(target_os = "windows")]
    {
        return run_command_text(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty ProcessName -Unique | Sort-Object",
            ],
        )
        .map(|value| split_app_names(&value))
        .unwrap_or_default();
    }

    #[cfg(target_os = "linux")]
    {
        run_command_text(
            "sh",
            &[
                "-lc",
                "if command -v wmctrl >/dev/null 2>&1; then wmctrl -lx | awk '{print $3}' | sed 's/.*\\.//' | sort -u; else ps -e -o comm= | sort -u | head -80; fi",
            ],
        )
        .map(|value| split_app_names(&value))
        .unwrap_or_default()
    }
}

fn split_app_names(value: &str) -> Vec<String> {
    let mut apps = value
        .split(|char| char == '\n' || char == '\r' || char == ',')
        .map(|item| item.trim().trim_matches('"').to_string())
        .filter(|item| item.len() > 1)
        .collect::<Vec<_>>();
    apps.sort_by_key(|item| item.to_lowercase());
    apps.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    apps
}

fn run_command_text(command: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(command);
    command.args(args);
    configure_background_command(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(target_os = "windows")]
fn configure_background_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_background_command(_command: &mut Command) {}

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
    mark_extension_seen(&state);
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
    mark_extension_seen(&state);
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
    mark_extension_seen(&state);
    let activities = normalize_activity_report(report.activities);
    let previous_selected_id = state
        .inner
        .lock()
        .expect("state poisoned")
        .selected_activity_id
        .clone();
    let selected_id = previous_selected_id
        .or(report.selected_activity_id)
        .filter(|id| {
            if activities
                .iter()
                .any(|activity| activity_id(activity).as_str() == id.as_str())
            {
                return true;
            }
            state
                .inner
                .lock()
                .map(|inner| inner.system_apps.iter().any(|app| app.id == *id))
                .unwrap_or(false)
        });
    let auto_pick_mode = report.auto_pick_mode.unwrap_or_else(|| "smart".to_string());
    let chosen = choose_report_activity(&activities, selected_id.as_deref(), &auto_pick_mode);

    {
        let mut inner = state.inner.lock().expect("state poisoned");
        inner.activity_inbox = activities.iter().map(activity_entry_from_payload).collect();
        inner.selected_activity_id = selected_id.clone();
    }

    if let Some(system_id) = selected_id
        .as_deref()
        .filter(|id| id.starts_with("system:"))
    {
        let selected = state
            .inner
            .lock()
            .expect("state poisoned")
            .system_apps
            .iter()
            .find(|app| app.id == system_id)
            .map(system_activity_entry);
        if let Some(activity) = selected {
            return apply_activity_payload(&state, payload_from_activity_entry(&activity));
        }
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
    let selected = activity_id.as_ref().and_then(|id| {
        combined_activities(&inner)
            .iter()
            .find(|activity| &activity.id == id)
            .cloned()
    });
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
        "youtubemusic" => "youtubemusic",
        "netflix" => "netflix",
        "primevideo" => "primevideo",
        "hulu" => "hulu",
        "disney+" | "disneyplus" => "disneyplus",
        "appletv" => "appletv",
        "spotify" => "spotify",
        "soundcloud" => "soundcloud",
        "applemusic" => "applemusic",
        "bandcamp" => "bandcamp",
        "twitch" => "twitch",
        "discord" => "discord",
        "googlemeet" | "meet" => "meet",
        "github" => "github",
        "vscodeweb" | "vscode" | "visualstudiocode" => "vscode",
        "linear" => "linear",
        "jira" => "jira",
        "notion" => "notion",
        "googledocs" => "googledocs",
        "figma" => "figma",
        "canva" => "canva",
        "chatgpt" => "chatgpt",
        "coursera" => "coursera",
        "udemy" => "udemy",
        "khanacademy" => "khanacademy",
        "leetcode" => "leetcode",
        "reddit" => "reddit",
        "x" | "twitter" => "twitter",
        "instagram" => "instagram",
        "linkedin" => "linkedin",
        "steam" => "steam",
        "chess.com" | "chess" => "chess",
        "lichess" => "lichess",
        "skribbl.io" | "skribbl" => "skribbl",
        "geoguessr" => "geoguessr",
        "hotstar" => "hotstar",
        "crunchyroll" => "crunchyroll",
        "wikipedia" => "wikipedia",
        "google" => "google",
        "manual" => "manual",
        _ => "manual",
    }
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
    let stable_large_image = payload
        .large_image_key
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| asset_key_for_platform(&platform).to_string());
    let mut activity = Activity::new()
        .details(details.clone())
        .state(presence_state.clone());

    let mut assets = Assets::new().small_text(platform.clone());
    assets = assets.large_image(stable_large_image.clone());
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
                    large_image_key: Some(stable_large_image),
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
        activities: combined_activities(&inner),
        selected_activity_id: inner.selected_activity_id.clone(),
        extension_connected: extension_seen_recent(inner.last_extension_seen.as_deref()),
        last_extension_seen: inner.last_extension_seen.clone(),
        system_activity: inner.system_activity.clone(),
        system_apps: inner.system_apps.clone(),
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
        activities: combined_activities(&inner),
        selected_activity_id: inner.selected_activity_id.clone(),
        current_activity_id: inner
            .last_activity
            .as_ref()
            .and_then(|activity| activity.id.clone()),
        extension_connected: extension_seen_recent(inner.last_extension_seen.as_deref()),
        last_extension_seen: inner.last_extension_seen.clone(),
        system_activity: inner.system_activity.clone(),
        system_apps: inner.system_apps.clone(),
        update: UpdateStatus {
            state: "manual".to_string(),
            message: "Tauri builds update through GitHub releases for now.".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            available_version: None,
            progress: None,
        },
    }
}

fn combined_activities(inner: &InnerState) -> Vec<ActivityEntry> {
    let mut activities = inner.activity_inbox.clone();
    for system in &inner.system_apps {
        if activities.iter().any(|item| item.id == system.id) {
            continue;
        }
        activities.push(system_activity_entry(system));
    }
    activities
}

fn system_activity_entry(system: &SystemActivity) -> ActivityEntry {
    ActivityEntry {
        id: system.id.clone(),
        tab_id: None,
        tab_title: Some("System app".to_string()),
        platform: system.app_name.clone(),
        details: system.details.clone(),
        state: if system.is_foreground {
            "Foreground app".to_string()
        } else {
            "Running app".to_string()
        },
        url: None,
        large_image_key: Some(system.icon_key.clone()),
        large_image_text: Some(format!("Using {}", system.app_name)),
        thumbnail_url: None,
        small_image_key: None,
        small_image_text: None,
        is_playing: None,
        media_current_time: None,
        media_duration: None,
        is_active_tab: false,
        last_seen: chrono::DateTime::parse_from_rfc3339(&system.updated_at)
            .map(|value| value.timestamp_millis())
            .unwrap_or_else(|_| now_millis()),
    }
}

fn extension_seen_recent(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|seen| {
            Utc::now()
                .signed_duration_since(seen.with_timezone(&Utc))
                .num_seconds()
                < 45
        })
        .unwrap_or(false)
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, state: &AppState) {
    let _ = app.emit("status:update", companion_status(state));
}

fn register_selector_shortcut<R: Runtime>(
    app: &AppHandle<R>,
    shortcut: &str,
) -> Result<(), String> {
    let shortcut = normalize_shortcut(shortcut);
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())?;
    app.global_shortcut()
        .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_selector_window(app);
            }
        })
        .map_err(|error| {
            format!(
                "Could not register shortcut `{shortcut}`. Another app may already use it. ({error})"
            )
        })
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
        system_activity_enabled: settings.system_activity_enabled,
        system_activity_allowed_apps: settings
            .system_activity_allowed_apps
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect(),
        selector_shortcut: normalize_shortcut(&settings.selector_shortcut),
    }
}

fn normalize_shortcut(value: &str) -> String {
    let shortcut = value.trim();
    if shortcut.is_empty() {
        DEFAULT_SELECTOR_SHORTCUT.to_string()
    } else {
        shortcut.to_string()
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
            system_activity_enabled: false,
            system_activity_allowed_apps: Vec::new(),
            selector_shortcut: default_selector_shortcut(),
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

fn default_true() -> bool {
    true
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_selector_shortcut() -> String {
    DEFAULT_SELECTOR_SHORTCUT.to_string()
}
