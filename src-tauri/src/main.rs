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
    activity::{Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps},
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
    WindowEvent,
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
const SETUP_GUIDE_URL: &str = "https://gsus2k.github.io/discord-status/";
const DISCORD_SERVER_URL: &str = "https://discord.gg/86mbTq2yZX";
const DEFAULT_SELECTOR_SHORTCUT: &str = "CommandOrControl+Shift+Y";
const DEFAULT_SETTINGS_SHORTCUT: &str = "CommandOrControl+Alt+Shift+S";
const OLD_SETTINGS_SHORTCUT: &str = "CommandOrControl+Shift+Comma";
const COMPANION_CUSTOM_ACTIVITY_ID: &str = "manual:companion";
const EXPECTED_EXTENSION_VERSION: &str = env!("CARGO_PKG_VERSION");

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
    #[serde(default = "default_settings_shortcut")]
    settings_shortcut: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivitySnapshot {
    id: Option<String>,
    tab_id: Option<i64>,
    tab_title: Option<String>,
    activity_name: Option<String>,
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
    activity_name: Option<String>,
    platform: String,
    details: String,
    state: String,
    series_title: Option<String>,
    season_number: Option<u32>,
    episode_number: Option<u32>,
    episode_title: Option<String>,
    episode_label: Option<String>,
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
    companion_version: String,
    expected_extension_version: String,
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
    window_title: Option<String>,
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
    companion_version: String,
    expected_extension_version: String,
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
    activity_name: Option<String>,
    details: Option<String>,
    state: Option<String>,
    series_title: Option<String>,
    season_number: Option<u32>,
    episode_number: Option<u32>,
    episode_title: Option<String>,
    episode_label: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomActivityRequest {
    title: String,
    message: String,
    #[serde(default)]
    submessage: String,
}

#[derive(Debug, Serialize)]
struct ApiMessage {
    success: bool,
    message: String,
    timestamp: String,
}

#[tokio::main]
async fn main() {
    configure_linux_webkit_workarounds();

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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app, "main");
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Discord Status Companion")
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
            set_custom_activity,
            show_selector,
            hide_selector,
            open_chrome_extensions,
            open_setup_guide,
            open_discord_server,
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
            if let Err(error) = register_global_shortcuts(app.handle(), &settings) {
                set_log(&state, format!("Global shortcut setup failed: {error}"));
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
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Discord Status Companion");
}

fn configure_linux_webkit_workarounds() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
    let open = MenuItem::with_id(app, "open", "Open Discord Status", true, None::<&str>)?;
    let selector = MenuItem::with_id(app, "selector", "Select Discord Status", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let chrome = MenuItem::with_id(app, "chrome", "Open Chrome Extensions", true, None::<&str>)?;
    let community = MenuItem::with_id(app, "community", "Discord Community", true, None::<&str>)?;
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
            &community,
            &separator_one,
            &start,
            &stop,
            &reconnect,
            &separator_two,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("discord-status")
        .tooltip("Discord Status Companion")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app, "main"),
            "selector" => show_selector_window(app),
            "settings" => show_settings_window(app),
            "chrome" => {
                let _ = open_chrome_url("chrome://extensions/");
            }
            "community" => {
                let _ = open::that(DISCORD_SERVER_URL);
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

fn show_settings_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.set_always_on_top(true);
        show_existing_window(&window);
        let settings_window = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(350)).await;
            let _ = settings_window.set_always_on_top(false);
        });
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
        let _ = window.set_always_on_top(true);
        show_existing_window(&window);
        let _ = app.emit("selector:opened", ());
    }
}

fn show_existing_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn place_popover<R: Runtime>(window: &WebviewWindow<R>, position: PhysicalPosition<f64>) {
    let size = window.outer_size().ok();
    let width = size.map(|value| value.width as f64).unwrap_or(420.0);
    let height = size.map(|value| value.height as f64).unwrap_or(620.0);
    let mut x = position.x - width / 2.0;
    let mut y = if position.y < 120.0 {
        position.y + 12.0
    } else {
        position.y - height - 12.0
    };

    if let Ok(Some(monitor)) = window.current_monitor() {
        let origin = monitor.position();
        let monitor_size = monitor.size();
        let min_x = origin.x as f64 + 8.0;
        let min_y = origin.y as f64 + 8.0;
        let max_x = (origin.x as f64 + monitor_size.width as f64 - width - 8.0).max(min_x);
        let max_y = (origin.y as f64 + monitor_size.height as f64 - height - 8.0).max(min_y);
        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);
    } else {
        x = x.max(8.0);
        y = y.max(8.0);
    }
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
    register_global_shortcuts(&app, &settings)?;
    apply_launch_at_login(&app, settings.launch_at_login)?;
    let mut browser_fallback = None;
    let mut should_clear_system_status = false;
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        if !settings.system_activity_enabled {
            let showing_system_activity = inner
                .last_activity
                .as_ref()
                .and_then(|activity| activity.id.as_deref())
                .is_some_and(|id| id.starts_with("system:"));
            if inner
                .selected_activity_id
                .as_deref()
                .is_some_and(|id| id.starts_with("system:"))
            {
                inner.selected_activity_id = None;
            }
            inner.system_activity = None;
            inner.system_apps.clear();
            if showing_system_activity {
                browser_fallback = inner
                    .activity_inbox
                    .iter()
                    .filter(|activity| !activity.id.starts_with("system:"))
                    .find(|activity| activity.is_active_tab)
                    .cloned()
                    .or_else(|| {
                        inner
                            .activity_inbox
                            .iter()
                            .find(|activity| !activity.id.starts_with("system:"))
                            .cloned()
                    });
                should_clear_system_status = browser_fallback.is_none();
            }
        }
        inner.settings = settings.clone();
    }
    write_settings(&settings)?;
    if let Some(activity) = browser_fallback {
        let _ = apply_activity_payload(&state, payload_from_activity_entry(&activity));
    } else if should_clear_system_status {
        let _ = clear_activity_response(&state);
    }
    emit_status(&app, &state);
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
    let selecting_auto = activity_id.is_none();
    let selected = select_activity_from_inbox(&state, activity_id);
    if let Some(activity) = selected {
        let (status, message) =
            apply_activity_payload(&state, payload_from_activity_entry(&activity));
        if !status.is_success() {
            return Err(message.0.message);
        }
    } else {
        if selecting_auto {
            let auto_activity = {
                let inner = state.inner.lock().map_err(|error| error.to_string())?;
                inner
                    .activity_inbox
                    .iter()
                    .filter(|activity| activity.id != COMPANION_CUSTOM_ACTIVITY_ID)
                    .find(|activity| activity.is_active_tab)
                    .cloned()
                    .or_else(|| {
                        inner
                            .activity_inbox
                            .iter()
                            .find(|activity| activity.id != COMPANION_CUSTOM_ACTIVITY_ID)
                            .cloned()
                    })
            };
            if let Some(activity) = auto_activity {
                let (status, message) =
                    apply_activity_payload(&state, payload_from_activity_entry(&activity));
                if !status.is_success() {
                    return Err(message.0.message);
                }
            } else if state
                .inner
                .lock()
                .map(|inner| inner.system_activity.is_none())
                .unwrap_or(true)
            {
                let _ = clear_activity_response(&state);
            }
        }
        set_log(
            &state,
            "Companion returned to auto activity selection.".to_string(),
        );
    }
    emit_status(&app, &state);
    Ok(companion_status(&state))
}

#[tauri::command]
async fn set_custom_activity(
    app: AppHandle,
    request: CustomActivityRequest,
    state: TauriState<'_, AppState>,
) -> Result<CompanionStatus, String> {
    let title = request.title.trim();
    let message = request.message.trim();
    let submessage = request.submessage.trim();
    if title.is_empty() {
        return Err("Add a title first.".to_string());
    }
    let activity = IncomingActivity {
        id: Some(COMPANION_CUSTOM_ACTIVITY_ID.to_string()),
        tab_id: None,
        tab_title: None,
        activity_name: Some(title.to_string()),
        details: Some(if message.is_empty() {
            "Custom status".to_string()
        } else {
            message.to_string()
        }),
        state: Some(submessage.to_string()),
        series_title: None,
        season_number: None,
        episode_number: None,
        episode_title: None,
        episode_label: None,
        platform: Some("Custom".to_string()),
        large_image_key: Some("manual".to_string()),
        large_image_text: Some("Custom Discord status".to_string()),
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
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        let entry = activity_entry_from_payload(&activity);
        inner.activity_inbox.retain(|item| item.id != entry.id);
        inner.activity_inbox.insert(0, entry);
        inner.selected_activity_id = Some(COMPANION_CUSTOM_ACTIVITY_ID.to_string());
    }
    let (status, message) = apply_activity_payload(&state, activity);
    if !status.is_success() {
        return Err(message.0.message);
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
async fn open_setup_guide() -> Result<(), String> {
    open::that(SETUP_GUIDE_URL).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_discord_server() -> Result<(), String> {
    open::that(DISCORD_SERVER_URL).map_err(|error| error.to_string())
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
    show_settings_window(&app);
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
    let enabled = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .settings
        .system_activity_enabled;
    if !enabled {
        {
            let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
            inner.system_activity = None;
            inner.system_apps.clear();
            if inner
                .selected_activity_id
                .as_deref()
                .is_some_and(|id| id.starts_with("system:"))
            {
                inner.selected_activity_id = None;
            }
        }
        emit_status(&app, &state);
        return Ok(Vec::new());
    }
    let snapshots = detect_running_apps();
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.system_apps = snapshots;
        inner.system_activity = inner
            .system_apps
            .iter()
            .find(|app| app.is_foreground)
            .cloned();
        if let Some(selected) = inner.selected_activity_id.as_deref() {
            if selected.starts_with("system:")
                && !inner.system_apps.iter().any(|app| app.id == selected)
            {
                inner.selected_activity_id = None;
            }
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
    let system_id = format!("system:{}", normalize_app_key(&app_name));
    let (settings, should_clear_selected) = {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        let should_clear =
            !allowed && inner.selected_activity_id.as_deref() == Some(system_id.as_str());
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
            if should_clear {
                inner.selected_activity_id = None;
            }
        }
        (inner.settings.clone(), should_clear)
    };
    write_settings(&settings)?;
    if should_clear_selected {
        let _ = clear_activity_response(&state);
    }
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
                    "Could not bind port {port}: {first_error}. Another app is using the companion port."
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

            let snapshots = detect_running_apps();
            let Some(foreground) = snapshots
                .iter()
                .find(|activity| activity.is_foreground)
                .cloned()
                .or_else(detect_foreground_app)
            else {
                continue;
            };
            let app_name = foreground.app_name.clone();
            let allowed = settings
                .system_activity_allowed_apps
                .iter()
                .map(|value| value.to_lowercase())
                .collect::<Vec<_>>();
            let is_allowed = !allowed.is_empty()
                && allowed
                    .iter()
                    .any(|value| app_name.to_lowercase().contains(value));

            let snapshot = foreground;
            let (selected_system, should_apply_auto_system, should_clear_removed_selection) = {
                let mut inner = match state.inner.lock() {
                    Ok(inner) => inner,
                    Err(_) => continue,
                };
                if !inner.settings.system_activity_enabled {
                    inner.system_activity = None;
                    inner.system_apps.clear();
                    continue;
                }
                inner.system_activity = Some(snapshot.clone());
                inner.system_apps = if snapshots.is_empty() {
                    vec![snapshot.clone()]
                } else {
                    snapshots.clone()
                };
                let mut selected_removed = false;
                let mut selected_system = None;
                if let Some(selected) = inner.selected_activity_id.as_deref() {
                    if selected.starts_with("system:") {
                        selected_system = inner
                            .system_apps
                            .iter()
                            .find(|app| app.id == selected)
                            .cloned();
                        if selected_system.is_none() {
                            selected_removed = inner
                                .last_activity
                                .as_ref()
                                .and_then(|activity| activity.id.as_deref())
                                == Some(selected);
                            inner.selected_activity_id = None;
                        }
                    }
                }
                (
                    selected_system.filter(|_| inner.rpc_connected),
                    is_allowed && inner.activity_inbox.is_empty() && inner.rpc_connected,
                    selected_removed && inner.activity_inbox.is_empty() && inner.rpc_connected,
                )
            };

            if let Some(system) = selected_system {
                let payload = payload_from_activity_entry(&system_activity_entry(&system));
                let _ = apply_activity_payload(&state, payload);
            } else if should_apply_auto_system {
                let payload = IncomingActivity {
                    id: Some(snapshot.id.clone()),
                    tab_id: None,
                    tab_title: snapshot.window_title.clone(),
                    activity_name: None,
                    details: Some(snapshot.details.clone()),
                    state: Some(system_activity_state(&snapshot)),
                    series_title: None,
                    season_number: None,
                    episode_number: None,
                    episode_title: None,
                    episode_label: None,
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
            } else if should_clear_removed_selection {
                let _ = clear_activity_response(&state);
            }
            emit_status(&app, &state);
        }
    });
}

fn system_activity_snapshot(
    app_name: &str,
    window_title: Option<String>,
    foreground: Option<&str>,
    now: &str,
) -> SystemActivity {
    let app_name = app_name.trim();
    let window_title = clean_system_window_title(app_name, window_title);
    SystemActivity {
        id: format!("system:{}", normalize_app_key(app_name)),
        app_name: app_name.to_string(),
        details: window_title
            .clone()
            .unwrap_or_else(|| format!("Using {app_name}")),
        window_title,
        icon_key: system_icon_key(app_name).to_string(),
        is_foreground: foreground
            .map(|value| value.eq_ignore_ascii_case(app_name))
            .unwrap_or(false),
        updated_at: now.to_string(),
    }
}

fn system_activity_state(system: &SystemActivity) -> String {
    if is_vlc_app(&system.app_name) {
        return if system.window_title.is_some() {
            "Watching in VLC".to_string()
        } else if system.is_foreground {
            "Watching VLC".to_string()
        } else {
            "VLC player".to_string()
        };
    }

    if system.window_title.is_some() {
        if system.is_foreground {
            "Current app window".to_string()
        } else {
            "Open app window".to_string()
        }
    } else if system.is_foreground {
        "Current foreground app".to_string()
    } else {
        "Running app".to_string()
    }
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
        "googlechrome" | "chrome" => "chrome",
        "safari" => "safari",
        "firefox" => "firefox",
        "microsoftedge" | "msedge" => "edge",
        "arc" => "arc",
        "spotify" => "spotify",
        "visualstudiocode" | "code" | "vscode" => "vscode",
        "githubdesktop" => "github",
        "steam" => "steam",
        "epicgameslauncher" | "epicgames" => "epicgames",
        "riotclient" | "riotgames" => "riotgames",
        "valorant" => "valorant",
        "leagueclient" | "leagueoflegends" | "leagueclientux" => "leagueoflegends",
        "roblox" | "robloxplayer" => "roblox",
        "osu" => "osu",
        "battlenet" | "battle.net" | "battle.netlauncher" => "battlenet",
        "notion" => "notion",
        "figma" => "figma",
        "slack" => "slack",
        "microsoftteams" | "teams" => "teams",
        "zoom" => "zoom",
        "telegram" => "telegram",
        "whatsapp" => "whatsapp",
        "obs" | "obsstudio" => "obs",
        "vlc" | "vlcmediaplayer" => "vlc",
        "blender" => "blender",
        "terminal" | "iterm2" => "terminal",
        "windowsterminal" => "windowsterminal",
        "powershell" => "powershell",
        "cmd" | "commandprompt" => "cmd",
        "finder" => "finder",
        "explorer" | "fileexplorer" => "files",
        _ => "manual",
    }
}

fn is_vlc_app(app_name: &str) -> bool {
    matches!(
        normalize_app_key(app_name).as_str(),
        "vlc" | "vlcmediaplayer"
    )
}

fn clean_system_window_title(app_name: &str, window_title: Option<String>) -> Option<String> {
    let value = window_title?.trim().to_string();
    if value.is_empty() {
        return None;
    }

    if value.eq_ignore_ascii_case(app_name) {
        return None;
    }

    let cleaned = if is_vlc_app(app_name) {
        let without_suffix = remove_case_insensitive_suffix(
            &remove_case_insensitive_suffix(&value, " - VLC media player"),
            " - VLC",
        );
        remove_case_insensitive_prefix(&without_suffix, "VLC media player - ")
            .trim()
            .to_string()
    } else {
        value
    };

    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case(app_name) {
        None
    } else {
        Some(cleaned)
    }
}

fn remove_case_insensitive_suffix(value: &str, suffix: &str) -> String {
    if value.len() >= suffix.len()
        && value[value.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    {
        value[..value.len() - suffix.len()].to_string()
    } else {
        value.to_string()
    }
}

fn remove_case_insensitive_prefix(value: &str, prefix: &str) -> String {
    if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix) {
        value[prefix.len()..].to_string()
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        activity_display_name, clean_system_window_title, normalize_app_key,
        system_apps_for_status, SystemActivity,
    };

    #[test]
    fn vlc_titles_show_the_movie_without_player_suffix() {
        assert_eq!(
            clean_system_window_title(
                "VLC media player",
                Some("Chainsmoker Cat - VLC media player".to_string())
            ),
            Some("Chainsmoker Cat".to_string())
        );
        assert_eq!(
            clean_system_window_title("VLC", Some("VLC media player - Episode 8".to_string())),
            Some("Episode 8".to_string())
        );
    }

    #[test]
    fn generic_window_titles_are_not_used_for_the_app_name() {
        assert_eq!(
            clean_system_window_title("VLC", Some("VLC".to_string())),
            None
        );
        assert_eq!(normalize_app_key("VLC media player"), "vlcmediaplayer");
    }

    #[test]
    fn manual_title_becomes_the_discord_activity_name() {
        assert_eq!(
            activity_display_name("Manual", Some("Watching with friends")),
            "Watching with friends"
        );
        assert_eq!(activity_display_name("Netflix", None), "Netflix");
    }

    #[test]
    fn disabled_desktop_detection_hides_stale_apps() {
        let app = SystemActivity {
            id: "system:example".to_string(),
            app_name: "Example".to_string(),
            details: "Example window".to_string(),
            window_title: Some("Example window".to_string()),
            icon_key: "manual".to_string(),
            is_foreground: true,
            updated_at: "2026-08-21T00:00:00Z".to_string(),
        };

        assert!(system_apps_for_status(false, std::slice::from_ref(&app)).is_empty());
        assert_eq!(system_apps_for_status(true, &[app]).len(), 1);
    }
}

fn detect_foreground_app() -> Option<SystemActivity> {
    let now = Utc::now().to_rfc3339();
    #[cfg(target_os = "macos")]
    {
        return run_command_text(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\"",
                "-e",
                "set frontApp to first application process whose frontmost is true",
                "-e",
                "set appName to name of frontApp",
                "-e",
                "set windowName to \"\"",
                "-e",
                "if (count of windows of frontApp) > 0 then set windowName to name of front window of frontApp",
                "-e",
                "return appName & tab & windowName",
                "-e",
                "end tell",
            ],
        )
        .and_then(|value| parse_app_title_line(&value))
        .map(|(app_name, title)| system_activity_snapshot(&app_name, title, Some(&app_name), &now));
    }

    #[cfg(target_os = "windows")]
    {
        return run_command_text(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class W { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); }\n'@; $hwnd=[W]::GetForegroundWindow(); [uint32]$pid=0; [void][W]::GetWindowThreadProcessId($hwnd,[ref]$pid); $p=Get-Process -Id $pid; \"$($p.ProcessName)`t$($p.MainWindowTitle)\"",
            ],
        )
        .and_then(|value| parse_app_title_line(&value))
        .map(|(app_name, title)| system_activity_snapshot(&app_name, title, Some(&app_name), &now));
    }

    #[cfg(target_os = "linux")]
    {
        run_command_text(
            "sh",
            &[
                "-lc",
                "pid=$(xdotool getactivewindow getwindowpid 2>/dev/null) && app=$(ps -p \"$pid\" -o comm= 2>/dev/null) && title=$(xdotool getactivewindow getwindowname 2>/dev/null) && printf '%s\\t%s' \"$app\" \"$title\"",
            ],
        )
        .and_then(|value| parse_app_title_line(&value))
        .map(|(app_name, title)| system_activity_snapshot(&app_name, title, Some(&app_name), &now))
    }
}

fn detect_running_apps() -> Vec<SystemActivity> {
    let now = Utc::now().to_rfc3339();
    let foreground_name = detect_foreground_app().map(|activity| activity.app_name);
    #[cfg(target_os = "macos")]
    {
        return run_command_text(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to get name of every application process whose background only is false",
            ],
        )
        .map(|value| {
            split_app_names(&value)
                .into_iter()
                .map(|app_name| {
                    system_activity_snapshot(&app_name, None, foreground_name.as_deref(), &now)
                })
                .collect()
        })
        .unwrap_or_default();
    }

    #[cfg(target_os = "windows")]
    {
        return run_command_text(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "Get-Process | Where-Object {$_.MainWindowTitle} | Sort-Object ProcessName -Unique | ForEach-Object { \"$($_.ProcessName)`t$($_.MainWindowTitle)\" }",
            ],
        )
        .map(|value| parse_app_title_lines(&value, foreground_name.as_deref(), &now))
        .unwrap_or_default();
    }

    #[cfg(target_os = "linux")]
    {
        run_command_text(
            "sh",
            &[
                "-lc",
                "if command -v wmctrl >/dev/null 2>&1; then wmctrl -lx | awk '{$1=$2=\"\"; cls=$3; sub(/.*\\./,\"\",cls); $3=\"\"; sub(/^ +/,\"\"); print cls \"\\t\" $0}' | sort -u; else ps -e -o comm= | sort -u | head -80; fi",
            ],
        )
        .map(|value| parse_app_title_lines(&value, foreground_name.as_deref(), &now))
        .unwrap_or_default()
    }
}

#[allow(dead_code)]
fn parse_app_title_lines(value: &str, foreground: Option<&str>, now: &str) -> Vec<SystemActivity> {
    let mut apps = value
        .lines()
        .filter_map(parse_app_title_line)
        .map(|(app_name, title)| system_activity_snapshot(&app_name, title, foreground, now))
        .filter(|item| item.app_name.len() > 1)
        .collect::<Vec<_>>();
    apps.sort_by_key(|item| item.app_name.to_lowercase());
    apps.dedup_by(|a, b| a.app_name.eq_ignore_ascii_case(&b.app_name));
    apps
}

fn parse_app_title_line(value: &str) -> Option<(String, Option<String>)> {
    let mut parts = value.trim().splitn(2, '\t');
    let app_name = parts.next()?.trim().trim_matches('"').to_string();
    if app_name.is_empty() {
        return None;
    }
    let title = parts
        .next()
        .map(|value| value.trim().trim_matches('"').to_string());
    Some((app_name, title.filter(|value| !value.is_empty())))
}

#[cfg(target_os = "macos")]
fn split_app_names(value: &str) -> Vec<String> {
    let mut apps = value
        .split(|character| character == '\n' || character == '\r' || character == ',')
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
    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        if child.try_wait().ok()?.is_some() {
            break;
        }
        if started.elapsed() > Duration::from_secs(2) {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let output = child.wait_with_output().ok()?;
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
    let incoming_selected_id = report.selected_activity_id.clone();
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
            if id == COMPANION_CUSTOM_ACTIVITY_ID {
                return state
                    .inner
                    .lock()
                    .map(|inner| {
                        inner
                            .activity_inbox
                            .iter()
                            .any(|activity| activity.id == COMPANION_CUSTOM_ACTIVITY_ID)
                    })
                    .unwrap_or(false);
            }
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
    let companion_owned_selection = incoming_selected_id.is_none()
        && selected_id
            .as_deref()
            .map(|id| id == COMPANION_CUSTOM_ACTIVITY_ID || id.starts_with("system:"))
            .unwrap_or(false);
    let auto_pick_mode = report.auto_pick_mode.unwrap_or_else(|| "smart".to_string());
    let chosen = choose_report_activity(&activities, selected_id.as_deref(), &auto_pick_mode);

    {
        let mut inner = state.inner.lock().expect("state poisoned");
        let pinned_custom = inner
            .activity_inbox
            .iter()
            .find(|activity| activity.id == COMPANION_CUSTOM_ACTIVITY_ID)
            .cloned();
        inner.activity_inbox = activities.iter().map(activity_entry_from_payload).collect();
        if let Some(custom) = pinned_custom {
            inner
                .activity_inbox
                .retain(|activity| activity.id != custom.id);
            inner.activity_inbox.insert(0, custom);
        }
        inner.selected_activity_id = selected_id.clone();
    }

    if selected_id.as_deref() == Some(COMPANION_CUSTOM_ACTIVITY_ID) {
        let selected = state
            .inner
            .lock()
            .expect("state poisoned")
            .activity_inbox
            .iter()
            .find(|activity| activity.id == COMPANION_CUSTOM_ACTIVITY_ID)
            .cloned();
        if let Some(activity) = selected {
            return apply_activity_payload(&state, payload_from_activity_entry(&activity));
        }
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

    if companion_owned_selection {
        return (
            StatusCode::OK,
            Json(ApiMessage::success("Companion selection retained")),
        );
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
        activity_name: payload.activity_name.clone(),
        platform: truncate(payload.platform.as_deref().unwrap_or("Browser"), 64),
        details: truncate(
            payload.details.as_deref().unwrap_or("Browser Activity"),
            128,
        ),
        state: truncate(payload.state.as_deref().unwrap_or("Active"), 128),
        series_title: payload.series_title.clone(),
        season_number: payload.season_number,
        episode_number: payload.episode_number,
        episode_title: payload.episode_title.clone(),
        episode_label: payload.episode_label.clone(),
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
        activity_name: entry.activity_name.clone(),
        details: Some(entry.details.clone()),
        state: Some(entry.state.clone()),
        series_title: entry.series_title.clone(),
        season_number: entry.season_number,
        episode_number: entry.episode_number,
        episode_title: entry.episode_title.clone(),
        episode_label: entry.episode_label.clone(),
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

fn activity_display_name(platform: &str, custom_name: Option<&str>) -> String {
    let trimmed = custom_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| platform.trim());
    if trimmed.is_empty() {
        "Activity".to_string()
    } else {
        trimmed.to_string()
    }
}

fn activity_type_for_payload(payload: &IncomingActivity, platform: &str) -> ActivityType {
    let key = platform.to_lowercase().replace([' ', '.', '-', '_'], "");
    if matches!(
        key.as_str(),
        "spotify" | "youtubemusic" | "applemusic" | "soundcloud" | "bandcamp"
    ) {
        return ActivityType::Listening;
    }
    if matches!(
        key.as_str(),
        "youtube"
            | "netflix"
            | "primevideo"
            | "hulu"
            | "disney+"
            | "disneyplus"
            | "appletv"
            | "hotstar"
            | "crunchyroll"
            | "twitch"
    ) {
        return ActivityType::Watching;
    }
    if matches!(key.as_str(), "chess" | "lichess" | "geoguessr" | "leetcode") {
        return ActivityType::Competing;
    }
    if payload
        .state
        .as_deref()
        .map(|state| state.to_lowercase().contains("watching"))
        .unwrap_or(false)
    {
        return ActivityType::Watching;
    }
    ActivityType::Playing
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
    let presence_state = payload
        .state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| truncate(value, 128))
        .unwrap_or_default();
    let platform = truncate(payload.platform.as_deref().unwrap_or("Browser"), 64);
    let display_name = truncate(
        &activity_display_name(&platform, payload.activity_name.as_deref()),
        64,
    );
    let stable_large_image = payload
        .large_image_key
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| asset_key_for_platform(&platform).to_string());
    let preferred_large_image = payload
        .thumbnail_url
        .as_deref()
        .and_then(discord_external_image_url)
        .unwrap_or_else(|| stable_large_image.clone());
    let mut activity = Activity::new()
        .name(display_name)
        .activity_type(activity_type_for_payload(&payload, &platform))
        .status_display_type(StatusDisplayType::Name)
        .details(details.clone());
    if !presence_state.is_empty() {
        activity = activity.state(presence_state.clone());
    }

    let mut assets = Assets::new().small_text(platform.clone());
    assets = assets.large_image(preferred_large_image);
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
    } else if payload
        .thumbnail_url
        .as_deref()
        .and_then(discord_external_image_url)
        .is_some()
    {
        assets = assets.small_image(stable_large_image.clone());
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
                    activity_name: payload.activity_name,
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

fn discord_external_image_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.starts_with("https://") && trimmed.len() <= 300 {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn api_status_payload(state: &AppState) -> ApiStatus {
    let inner = state.inner.lock().expect("state poisoned");
    ApiStatus {
        companion_version: env!("CARGO_PKG_VERSION").to_string(),
        expected_extension_version: EXPECTED_EXTENSION_VERSION.to_string(),
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
        system_activity: visible_system_activity(&inner),
        system_apps: visible_system_apps(&inner),
        uptime_seconds: inner.started_at.elapsed().as_secs(),
        timestamp: Utc::now().to_rfc3339(),
    }
}

fn companion_status(state: &AppState) -> CompanionStatus {
    let inner = state.inner.lock().expect("state poisoned");
    CompanionStatus {
        companion_version: env!("CARGO_PKG_VERSION").to_string(),
        expected_extension_version: EXPECTED_EXTENSION_VERSION.to_string(),
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
        system_activity: visible_system_activity(&inner),
        system_apps: visible_system_apps(&inner),
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
    for system in visible_system_apps(inner) {
        if activities.iter().any(|item| item.id == system.id) {
            continue;
        }
        activities.push(system_activity_entry(&system));
    }
    activities
}

fn visible_system_activity(inner: &InnerState) -> Option<SystemActivity> {
    inner
        .settings
        .system_activity_enabled
        .then(|| inner.system_activity.clone())
        .flatten()
}

fn visible_system_apps(inner: &InnerState) -> Vec<SystemActivity> {
    system_apps_for_status(inner.settings.system_activity_enabled, &inner.system_apps)
}

fn system_apps_for_status(enabled: bool, system_apps: &[SystemActivity]) -> Vec<SystemActivity> {
    if enabled {
        system_apps.to_vec()
    } else {
        Vec::new()
    }
}

fn system_activity_entry(system: &SystemActivity) -> ActivityEntry {
    ActivityEntry {
        id: system.id.clone(),
        tab_id: None,
        tab_title: system
            .window_title
            .clone()
            .or_else(|| Some("System app".to_string())),
        activity_name: None,
        platform: system.app_name.clone(),
        details: system.details.clone(),
        state: system_activity_state(system),
        series_title: None,
        season_number: None,
        episode_number: None,
        episode_title: None,
        episode_label: None,
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

fn register_global_shortcuts<R: Runtime>(
    app: &AppHandle<R>,
    settings: &Settings,
) -> Result<(), String> {
    let selector_shortcut =
        validate_shortcut(&settings.selector_shortcut, DEFAULT_SELECTOR_SHORTCUT)?;
    let settings_shortcut =
        validate_shortcut(&settings.settings_shortcut, DEFAULT_SETTINGS_SHORTCUT)?;
    if selector_shortcut.eq_ignore_ascii_case(&settings_shortcut) {
        return Err("Status selector and settings shortcuts must be different.".to_string());
    }
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())?;
    app.global_shortcut()
        .on_shortcut(selector_shortcut.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_selector_window(app);
            }
        })
        .map_err(|error| {
            format!(
                "Could not register selector shortcut `{selector_shortcut}`. Another app may already use it. ({error})"
            )
        })?;
    app.global_shortcut()
        .on_shortcut(settings_shortcut.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                show_settings_window(app);
            }
        })
        .map_err(|error| {
            format!(
                "Could not register settings shortcut `{settings_shortcut}`. Another app may already use it. ({error})"
            )
        })?;
    Ok(())
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
        selector_shortcut: normalize_shortcut(
            &settings.selector_shortcut,
            DEFAULT_SELECTOR_SHORTCUT,
        ),
        settings_shortcut: normalize_shortcut(
            &settings.settings_shortcut,
            DEFAULT_SETTINGS_SHORTCUT,
        ),
    }
}

fn normalize_shortcut(value: &str, default_value: &str) -> String {
    let shortcut = value.trim();
    if shortcut.is_empty() {
        default_value.to_string()
    } else if shortcut.eq_ignore_ascii_case(OLD_SETTINGS_SHORTCUT) {
        DEFAULT_SETTINGS_SHORTCUT.to_string()
    } else {
        shortcut.to_string()
    }
}

fn validate_shortcut(value: &str, default_value: &str) -> Result<String, String> {
    let shortcut = normalize_shortcut(value, default_value);
    let parts = shortcut
        .split('+')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.len() < 2 {
        return Err("Shortcut must include at least one modifier and one key, like CommandOrControl+Shift+Y.".to_string());
    }

    let key = parts.last().unwrap_or(&"").to_ascii_lowercase();
    let modifiers = &parts[..parts.len() - 1];
    let has_primary_modifier = modifiers.iter().any(|part| {
        matches!(
            part.to_ascii_lowercase().as_str(),
            "commandorcontrol"
                | "cmdorctrl"
                | "command"
                | "cmd"
                | "control"
                | "ctrl"
                | "super"
                | "meta"
                | "alt"
                | "option"
        )
    });

    if !has_primary_modifier {
        return Err(
            "Shortcut must include CommandOrControl, Command, Control, Alt, or Option.".to_string(),
        );
    }

    if matches!(
        key.as_str(),
        "tab" | "escape" | "esc" | "space" | "q" | "w" | "m" | "`" | "~"
    ) {
        return Err("That key is reserved or too easy to collide with system/app shortcuts. Use a letter like Y, K, or P with CommandOrControl+Shift.".to_string());
    }

    let lowered = shortcut.to_ascii_lowercase().replace(' ', "");
    let blocked = [
        "commandorcontrol+shift+d",
        "command+shift+d",
        "cmd+shift+d",
        "control+shift+d",
        "ctrl+shift+d",
        "commandorcontrol+q",
        "commandorcontrol+w",
        "commandorcontrol+space",
    ];
    if blocked.iter().any(|blocked| lowered == *blocked) {
        return Err("That shortcut commonly belongs to Chrome or the system. Pick something like CommandOrControl+Shift+Y.".to_string());
    }

    Ok(shortcut)
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
            settings_shortcut: default_settings_shortcut(),
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

fn default_settings_shortcut() -> String {
    DEFAULT_SETTINGS_SHORTCUT.to_string()
}
