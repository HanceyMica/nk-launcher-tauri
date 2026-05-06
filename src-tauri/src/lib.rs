use log::{error, info};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

mod browser;
mod config;
mod db;
mod error;
mod hotkey;

pub use error::AppError;

pub struct AppState {
    pub db: Arc<Mutex<db::Database>>,
    pub config: Arc<Mutex<config::ConfigManager>>,
    pub current_hotkey: Arc<Mutex<Option<Shortcut>>>,
}

fn get_data_dir(_app: &AppHandle) -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local_app_data).join("nk-launcher-tauri")
}

fn get_log_dir(app: &AppHandle) -> PathBuf {
    get_data_dir(app).join("logs")
}

use std::io::Write;

fn write_error_log(app: &AppHandle, message: &str) {
    let log_dir = get_log_dir(app);
    let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_file = log_dir.join(format!("error-{}.txt", date_str));
    
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        let time_str = chrono::Local::now().format("%H:%M:%S").to_string();
        let _ = writeln!(file, "[{}] {}", time_str, message);
    }
}

fn setup_logging(app: &AppHandle) -> Result<(), AppError> {
    let log_dir = get_log_dir(app);
    std::fs::create_dir_all(&log_dir).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<(), error::AppError> {
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])
        .map_err(|e| error::AppError::Ui(e.to_string()))?;

    let _tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("nk-launcher")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("show-settings", ());
                }
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;
    Ok(())
}


fn update_window_position(window: &WebviewWindow) -> Result<(), AppError> {
    if let Some(monitor) = window.primary_monitor().map_err(|e| AppError::Ui(e.to_string()))? {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let win_size = window.outer_size().map_err(|e| AppError::Ui(e.to_string()))?;

        let screen_w = size.width as f64 / scale;
        let screen_h = size.height as f64 / scale;
        let win_w = win_size.width as f64 / scale;
        let win_h = win_size.height as f64 / scale;

        let x = ((screen_w - win_w) / 2.0) as i32;
        let y = ((screen_h / 3.0) - (win_h / 2.0)) as i32;

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
            .map_err(|e| AppError::Ui(e.to_string()))?;
    }
    Ok(())
}

fn toggle_window_visibility(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = update_window_position(&window);
        }
    }
}

fn setup_global_shortcut(app: &AppHandle, _state: State<'_, AppState>) {
    let handle = app.clone();
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle_window_visibility(&handle);
        }
    }).unwrap();
}

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<config::AppConfig, String> {
    let config = state.config.lock();
    config.get_all().map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_config(
    key: String,
    value: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock();
    config.set(&key, value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_mode(state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock();
    config.get_str("global/mode").map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_mode(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    config.set("global/mode", serde_json::json!(mode)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_entries(
    namespace: String,
    state: State<'_, AppState>,
) -> Result<Vec<db::Entry>, String> {
    let db = state.db.lock();
    db.get_entries(&namespace).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_entry(
    namespace: String,
    entry: db::Entry,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = state.db.lock();
    db.save_entry(&namespace, &entry).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_entry(
    namespace: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = state.db.lock();
    db.delete_entry(&namespace, &key).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fuzzy_search(query: String, entries: Vec<db::Entry>) -> Vec<db::Entry> {
    config::fuzzy_search(&query, entries)
}

#[tauri::command]
async fn list_browsers() -> Result<Vec<browser::BrowserInfo>, String> {
    browser::enumerate_browsers().map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_url(url: String, browser_id: Option<String>, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let browser_cmd = if let Some(_bid) = browser_id {
        state.config.lock().get_str(&format!("global/default_browser")).ok()
            .and_then(|s| if s.is_empty() { None } else { Some(s) })
    } else {
        // If frontend didn't pass a specific browser id, read from global config
        state.config.lock().get_str("global/default_browser").ok()
            .and_then(|s| if s.is_empty() { None } else { Some(s) })
    };

    let exe_path_res = browser::resolve_browser_path(browser_cmd.as_deref())
        .map_err(|e| e.to_string());
    
    match exe_path_res {
        Ok(Some(path)) => {
            browser::open_url_with_browser(&url, &path).map_err(|e| {
                let msg = e.to_string();
                write_error_log(&app, &msg);
                msg
            })
        },
        _ => {
            // Fallback to system default
            use tauri_plugin_opener::OpenerExt;
            app.opener().open_url(&url, None::<&str>).map_err(|e| {
                let msg = format!("Failed to open system default browser: {}", e);
                write_error_log(&app, &msg);
                msg
            })
        }
    }
}

#[tauri::command]
async fn open_app(path: String, app: AppHandle) -> Result<(), String> {
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| {
            let msg = format!("Failed to open {}: {}", path, e);
            write_error_log(&app, &msg);
            msg
        })?;
    Ok(())
}

fn key_string_to_code(key: &str) -> Option<Code> {
    match key.to_uppercase().as_str() {
        "SPACE" => Some(Code::Space),
        "ENTER" => Some(Code::Enter),
        "ESCAPE" | "ESC" => Some(Code::Escape),
        "TAB" => Some(Code::Tab),
        "BACKSPACE" => Some(Code::Backspace),
        "DELETE" | "DEL" => Some(Code::Delete),
        "UP" => Some(Code::ArrowUp),
        "DOWN" => Some(Code::ArrowDown),
        "LEFT" => Some(Code::ArrowLeft),
        "RIGHT" => Some(Code::ArrowRight),
        "HOME" => Some(Code::Home),
        "END" => Some(Code::End),
        "PAGEUP" => Some(Code::PageUp),
        "PAGEDOWN" => Some(Code::PageDown),
        "F1" => Some(Code::F1),
        "F2" => Some(Code::F2),
        "F3" => Some(Code::F3),
        "F4" => Some(Code::F4),
        "F5" => Some(Code::F5),
        "F6" => Some(Code::F6),
        "F7" => Some(Code::F7),
        "F8" => Some(Code::F8),
        "F9" => Some(Code::F9),
        "F10" => Some(Code::F10),
        "F11" => Some(Code::F11),
        "F12" => Some(Code::F12),
        "A" => Some(Code::KeyA),
        "B" => Some(Code::KeyB),
        "C" => Some(Code::KeyC),
        "D" => Some(Code::KeyD),
        "E" => Some(Code::KeyE),
        "F" => Some(Code::KeyF),
        "G" => Some(Code::KeyG),
        "H" => Some(Code::KeyH),
        "I" => Some(Code::KeyI),
        "J" => Some(Code::KeyJ),
        "K" => Some(Code::KeyK),
        "L" => Some(Code::KeyL),
        "M" => Some(Code::KeyM),
        "N" => Some(Code::KeyN),
        "O" => Some(Code::KeyO),
        "P" => Some(Code::KeyP),
        "Q" => Some(Code::KeyQ),
        "R" => Some(Code::KeyR),
        "S" => Some(Code::KeyS),
        "T" => Some(Code::KeyT),
        "U" => Some(Code::KeyU),
        "V" => Some(Code::KeyV),
        "W" => Some(Code::KeyW),
        "X" => Some(Code::KeyX),
        "Y" => Some(Code::KeyY),
        "Z" => Some(Code::KeyZ),
        "0" => Some(Code::Digit0),
        "1" => Some(Code::Digit1),
        "2" => Some(Code::Digit2),
        "3" => Some(Code::Digit3),
        "4" => Some(Code::Digit4),
        "5" => Some(Code::Digit5),
        "6" => Some(Code::Digit6),
        "7" => Some(Code::Digit7),
        "8" => Some(Code::Digit8),
        "9" => Some(Code::Digit9),
        _ => None,
    }
}

impl hotkey::HotkeyProvider for AppHandle {
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        self.global_shortcut().register(shortcut).map_err(|e| e.to_string())
    }

    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
        self.global_shortcut().unregister(shortcut).map_err(|e| e.to_string())
    }

    fn is_registered(&self, shortcut: Shortcut) -> bool {
        self.global_shortcut().is_registered(shortcut)
    }
}

pub fn register_hotkey_logic<T: hotkey::HotkeyProvider>(
    provider: &T,
    new_shortcut: Shortcut,
    current_state: &Arc<Mutex<Option<Shortcut>>>,
) -> Result<(), String> {
    provider.register(new_shortcut.clone())?;

    let mut current = current_state.lock();
    if let Some(old) = current.take() {
        let _ = provider.unregister(old);
    }
    *current = Some(new_shortcut);
    Ok(())
}

#[tauri::command]
async fn register_hotkey(
    modifiers: Vec<String>,
    key: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mods: Result<Vec<Modifiers>, String> = modifiers
        .iter()
        .map(|m| match m.to_uppercase().as_str() {
            "CTRL" | "CONTROL" => Ok(Modifiers::CONTROL),
            "ALT" => Ok(Modifiers::ALT),
            "SHIFT" => Ok(Modifiers::SHIFT),
            "WIN" | "META" => Ok(Modifiers::META),
            _ => Err(format!("Unknown modifier: {}", m)),
        })
        .collect();
    let mods = mods?;

    let code = key_string_to_code(&key).ok_or_else(|| format!("Unknown key: {}", key))?;

    let new_shortcut = Shortcut::new(
        if mods.is_empty() { None } else { Some(mods.iter().fold(Modifiers::empty(), |acc, m| acc | *m)) },
        code,
    );

    register_hotkey_logic(&app, new_shortcut.clone(), &state.current_hotkey)?;

    let handle = app.clone();
    let _ = app.global_shortcut().on_shortcut(new_shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle_window_visibility(&handle);
        }
    });

    Ok(())
}

#[tauri::command]
async fn check_hotkey_conflict(
    modifiers: Vec<String>,
    key: String,
    app: AppHandle,
) -> Result<bool, String> {
    let mods: Result<Vec<Modifiers>, String> = modifiers
        .iter()
        .map(|m| match m.to_uppercase().as_str() {
            "CTRL" | "CONTROL" => Ok(Modifiers::CONTROL),
            "ALT" => Ok(Modifiers::ALT),
            "SHIFT" => Ok(Modifiers::SHIFT),
            "WIN" | "META" => Ok(Modifiers::META),
            _ => Err(format!("Unknown modifier: {}", m)),
        })
        .collect();
    let mods = mods?;

    let code = key_string_to_code(&key).ok_or_else(|| format!("Unknown key: {}", key))?;

    let shortcut = Shortcut::new(
        if mods.is_empty() { None } else { Some(mods.iter().fold(Modifiers::empty(), |acc, m| acc | *m)) },
        code,
    );

    let registered = app.global_shortcut().is_registered(shortcut);

    Ok(registered)
}

#[tauri::command]
async fn export_config(state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock();
    let db = state.db.lock();
    config.export_json(&db).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_config(json: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    let mut db = state.db.lock();
    config.import_json(&mut db, &json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        update_window_position(&window).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
async fn get_has_launched(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock();
    let val = config.get("global/has_launched").map_err(|e| e.to_string())?;
    Ok(val.as_bool().unwrap_or(false))
}

#[tauri::command]
async fn mark_launched(state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    config.set("global/has_launched", serde_json::json!(true)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn show_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn update_tray_menu(app: AppHandle, show: String, settings: String, quit: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let quit_item = MenuItem::with_id(&app, "quit", &quit, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let settings_item = MenuItem::with_id(&app, "settings", &settings, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let show_item = MenuItem::with_id(&app, "show", &show, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let menu = Menu::with_items(&app, &[&show_item, &settings_item, &quit_item])
            .map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_window(width: f64, height: f64, app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: width,
                height: height,
            }))
            .map_err(|e| e.to_string())?;
        update_window_position(&window).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let data_dir = get_data_dir(app.handle());
            std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

            if let Err(e) = setup_logging(app.handle()) {
                error!("Failed to setup logging: {}", e);
            }

            let db = db::Database::new(&data_dir.join("config.db"))
                .expect("Failed to initialize database");
            let config = config::ConfigManager::new(db.clone())
                .expect("Failed to initialize config manager");

            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                config: Arc::new(Mutex::new(config)),
                current_hotkey: Arc::new(Mutex::new(None)),
            });

            setup_tray(app.handle())?;

            let state = app.state::<AppState>();
            setup_global_shortcut(app.handle(), state);

            if let Some(window) = app.get_webview_window("main") {
                let _ = update_window_position(&window);
            }

            info!("nk-launcher started successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_mode,
            set_mode,
            get_entries,
            save_entry,
            delete_entry,
            fuzzy_search,
            list_browsers,
            open_url,
            open_app,
            register_hotkey,
            check_hotkey_conflict,
            export_config,
            import_config,
            show_window,
            hide_window,
            resize_window,
            get_has_launched,
            mark_launched,
            show_settings,
            update_tray_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}