//! Main Tauri application logic / Tauri 主应用逻辑
//! Handles window management, tray, global shortcuts, and all Tauri commands
//! 处理窗口管理、托盘、全局快捷键及所有 Tauri 命令

use log::{error, info};
use parking_lot::Mutex;
use std::io::Write;
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

// ============================================================================
// Application State / 应用状态管理
// ============================================================================

/// Global application state shared across all Tauri commands
/// 全局应用状态，在所有 Tauri 命令间共享
/// - db: SQLite database for entries and config / 用于 entries 和 config 的 SQLite 数据库
/// - config: ConfigManager for JSON-based settings / ConfigManager 用于 JSON 配置
/// - current_hotkey: Currently registered global shortcut / 当前注册的全量的快捷键
pub struct AppState {
    pub db: Arc<Mutex<db::Database>>,
    pub config: Arc<Mutex<config::ConfigManager>>,
    pub current_hotkey: Arc<Mutex<Option<Shortcut>>>,
}

// ============================================================================
// Directory & Logging / 目录与日志
// ============================================================================

/// Get application data directory / 获取应用数据目录
/// Returns: $LOCALAPPDATA/nk-launcher-tauri / 返回：$LOCALAPPDATA/nk-launcher-tauri
/// - On Windows: typically C:\Users\<user>\AppData\Local
/// - Fallback to current directory if LOCALAPPDATA not set
fn get_data_dir(_app: &AppHandle) -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local_app_data).join("nk-launcher-tauri")
}

/// Get log directory / 获取日志目录
/// Returns: <data_dir>/logs / 返回：<数据目录>/logs
fn get_log_dir(app: &AppHandle) -> PathBuf {
    get_data_dir(app).join("logs")
}

/// Write error message to daily rotating log file / 将错误信息写入按日滚动的日志文件
/// File format: error-YYYY-MM-DD.txt / 文件格式：error-YYYY-MM-DD.txt
/// Used for crash diagnostics and debugging / 用于崩溃诊断和调试
fn write_error_log(app: &AppHandle, message: &str) {
    let log_dir = get_log_dir(app);
    // Format: YYYY-MM-DD for daily log rotation / 按日轮转的日期格式
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

/// Initialize logging directory / 初始化日志目录
/// Creates log directory if it doesn't exist / 如果日志目录不存在则创建
fn setup_logging(app: &AppHandle) -> Result<(), AppError> {
    let log_dir = get_log_dir(app);
    std::fs::create_dir_all(&log_dir).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

// ============================================================================
// System Tray / 系统托盘
// ============================================================================

/// Initialize system tray with menu items / 初始化带菜单项的系统托盘
/// Menu items: Show, Settings, Quit / 菜单项：显示、设置、退出
/// # Arguments
/// - app: Tauri AppHandle for tray building / 用于构建托盘的 Tauri AppHandle
/// # Returns
/// - Result<(), AppError>: Tray creation result / 托盘创建结果
/// # Side Effects
/// - Creates tray icon with click handlers / 创建带点击事件处理器的托盘图标
fn setup_tray(app: &AppHandle) -> Result<(), error::AppError> {
    // Build menu items with i18n labels / 使用国际化标签构建菜单项
    // with_id(app, id, label, enabled, shortcut) / with_id(应用, ID, 标签, 启用状态, 快捷键)
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)
        .map_err(|e| error::AppError::Ui(e.to_string()))?;

    // Create menu from items / 从项创建菜单
    let menu = Menu::with_items(app, &[&show, &settings, &quit])
        .map_err(|e| error::AppError::Ui(e.to_string()))?;

    // Build tray icon with menu and event handlers / 构建带菜单和事件处理器的托盘图标
    let _tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("nk-launcher")
        // Handle menu click events / 处理菜单点击事件
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                // Exit application / 退出应用
                app.exit(0);
            }
            "show" => {
                // Show main window and focus / 显示主窗口并聚焦
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                // Show window and emit show-settings event to frontend
                // 显示窗口并向 frontend 发送 show-settings 事件
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

// ============================================================================
// Window Management / 窗口管理
// ============================================================================

/// Update window position to center-top of screen / 将窗口位置更新到屏幕顶部居中
/// Respects monitor scale factor for HiDPI displays / 对于 HiDPI 显示器考虑缩放因子
/// # Arguments
/// - window: Target WebviewWindow / 目标 WebviewWindow
/// # Returns
/// - Result<(), AppError>: Position update result / 位置更新结果
/// # Side Effects
/// - Moves window on screen / 在屏幕上移动窗口
fn update_window_position(window: &WebviewWindow) -> Result<(), AppError> {
    if let Some(monitor) = window
        .primary_monitor()
        .map_err(|e| AppError::Ui(e.to_string()))?
    {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let win_size = window
            .outer_size()
            .map_err(|e| AppError::Ui(e.to_string()))?;

        // Convert from physical pixels to logical pixels for HiDPI support
        // 从物理像素转换为逻辑像素以支持 HiDPI
        let screen_w = size.width as f64 / scale;
        let screen_h = size.height as f64 / scale;
        let win_w = win_size.width as f64 / scale;
        let win_h = win_size.height as f64 / scale;

        // Center horizontally / 水平居中
        let x = ((screen_w - win_w) / 2.0) as i32;
        // Position at 1/3 from top (upper-center) / 放在距顶部 1/3 处（上部居中）
        let y = ((screen_h / 3.0) - (win_h / 2.0)) as i32;

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
            .map_err(|e| AppError::Ui(e.to_string()))?;
    }
    Ok(())
}

/// Toggle main window visibility / 切换主窗口可见性
/// If visible: hide. If hidden: show, focus, and update position.
/// 如果可见：隐藏。如果隐藏：显示、聚焦、更新位置
/// # Arguments
/// - app: AppHandle to get window reference / 用于获取窗口引用的 AppHandle
/// # Side Effects
/// - Shows/hides window / 显示/隐藏窗口
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

// ============================================================================
// Global Shortcut Parsing & Registration / 全局快捷键解析与注册
// ============================================================================

/// Parse shortcut string (e.g., "Alt+Space") into Tauri Shortcut
/// 解析快捷键字符串（如 "Alt+Space"）为 Tauri Shortcut
/// # Arguments
/// - shortcut_str: String like "Ctrl+Shift+K" / 类似 "Ctrl+Shift+K" 的字符串
/// # Returns
/// - Result<Shortcut, String>: Parsed shortcut or error / 解析后的快捷键或错误
/// # Algorithm
/// 1. Split by '+' / 按 '+' 分割
/// 2. Last part is the key / 最后一部分是按键
/// 3. All preceding parts are modifiers (Ctrl, Alt, Shift, Win) / 所有前面的部分是修饰键
fn parse_shortcut(shortcut_str: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();
    if parts.is_empty() {
        return Err("Empty shortcut".to_string());
    }

    // Last part is the actual key / 最后一部分是实际按键
    let key = parts.last().unwrap();
    let code = key_string_to_code(key).ok_or_else(|| format!("Unknown key: {}", key))?;

    // Build modifiers from preceding parts / 从前面的部分构建修饰键
    let mut mods = Modifiers::empty();
    for m in parts.iter().take(parts.len() - 1) {
        match m.to_uppercase().as_str() {
            "CTRL" | "CONTROL" => mods |= Modifiers::CONTROL,
            "ALT" => mods |= Modifiers::ALT,
            "SHIFT" => mods |= Modifiers::SHIFT,
            "WIN" | "META" => mods |= Modifiers::META,
            _ => return Err(format!("Unknown modifier: {}", m)),
        }
    }

    Ok(Shortcut::new(
        if mods.is_empty() { None } else { Some(mods) },
        code,
    ))
}

/// Setup global shortcut on app startup / 在应用启动时设置全局快捷键
/// Reads shortcut from config, falls back to Alt+Space on parse failure
/// 从配置读取快捷键，解析失败时回退到 Alt+Space
/// # Arguments
/// - app: AppHandle for shortcut registration / 用于快捷键注册的 AppHandle
/// - state: AppState containing config and current_hotkey / 包含 config 和 current_hotkey 的 AppState
/// # Side Effects
/// - Registers global shortcut with system / 向系统注册全局快捷键
/// - Updates current_hotkey in state / 更新 state 中的 current_hotkey
fn setup_global_shortcut(app: &AppHandle, state: State<'_, AppState>) {
    let handle = app.clone();

    let shortcut_str = {
        let config = state.config.lock();
        config
            .get_str("global/shortcut")
            .unwrap_or_else(|_| "Alt+Space".to_string())
    };

    let new_shortcut = match parse_shortcut(&shortcut_str) {
        Ok(s) => s,
        Err(e) => {
            error!(
                "Failed to parse saved shortcut: {}, falling back to Alt+Space",
                e
            );
            Shortcut::new(Some(Modifiers::ALT), Code::Space)
        }
    };

    let current_hotkey = state.current_hotkey.clone();
    let registered_shortcut = match register_hotkey_logic(&app.clone(), new_shortcut.clone(), &current_hotkey) {
        Ok(_) => Some(new_shortcut),
        Err(e) => {
            error!(
                "Failed to register saved shortcut: {}, falling back to Alt+Space",
                e
            );
            let fallback = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            match register_hotkey_logic(&app.clone(), fallback.clone(), &current_hotkey) {
                Ok(_) => Some(fallback),
                Err(_) => None,
            }
        }
    };

    if let Some(shortcut) = registered_shortcut {
        let cb_handle = handle.clone();
        let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_window_visibility(&cb_handle);
            }
        });
    }
}

// ============================================================================
// Tauri Commands: Config Management / Tauri 命令：配置管理
// ============================================================================

/// Get full application configuration / 获取完整应用配置
/// Returns AppConfig with version, mode, theme, language, default_browser
/// 返回包含 version、mode、theme、language、default_browser 的 AppConfig
#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<config::AppConfig, String> {
    let config = state.config.lock();
    config.get_all().map_err(|e| e.to_string())
}

/// Save a configuration key-value pair / 保存配置键值对
/// # Arguments
/// - key: Config key in namespace/key format (e.g., "global/theme")
/// - value: JSON value to store / 要存储的 JSON 值
#[tauri::command]
async fn save_config(
    key: String,
    value: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock();
    config.set(&key, value).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands: Mode Management / Tauri 命令：模式管理
// ============================================================================

/// Get current mode (expert/simple) / 获取当前模式（expert/simple）
#[tauri::command]
async fn get_mode(state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock();
    config.get_str("global/mode").map_err(|e| e.to_string())
}

/// Set current mode / 设置当前模式
/// # Arguments
/// - mode: Either "expert" or "simple" / 为 "expert" 或 "simple"
#[tauri::command]
async fn set_mode(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    config
        .set("global/mode", serde_json::json!(mode))
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands: Entry Management / Tauri 命令：条目管理
// ============================================================================

/// Get all entries for a namespace / 获取某个命名空间的所有条目
/// # Arguments
/// - namespace: "expert" or "simple" / 命名空间："expert" 或 "simple"
/// # Returns
/// - Vec<Entry>: List of entries with command, kind, title, url, path
/// - 返回包含 command、kind、title、url、path 的条目列表
#[tauri::command]
async fn get_entries(
    namespace: String,
    state: State<'_, AppState>,
) -> Result<Vec<db::Entry>, String> {
    let db = state.db.lock();
    db.get_entries(&namespace).map_err(|e| e.to_string())
}

/// Save or update an entry / 保存或更新条目
/// Uses INSERT OR REPLACE so command is unique within namespace
/// 使用 INSERT OR REPLACE，所以 command 在命名空间内唯一
#[tauri::command]
async fn save_entry(
    namespace: String,
    entry: db::Entry,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = state.db.lock();
    db.save_entry(&namespace, &entry).map_err(|e| e.to_string())
}

/// Delete an entry by command key / 按 command 键删除条目
#[tauri::command]
async fn delete_entry(
    namespace: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = state.db.lock();
    db.delete_entry(&namespace, &key).map_err(|e| e.to_string())
}

/// Perform fuzzy search on entries / 对条目执行模糊搜索
/// Uses SkimMatcherV2 for fuzzy matching on command, title, url, path
/// 使用 SkimMatcherV2 在 command、title、url、path 上模糊匹配
/// # Arguments
/// - query: Search string / 搜索字符串
/// - entries: List of entries to search / 要搜索的条目列表
/// # Returns
/// - Vec<Entry>: Sorted by relevance score descending / 按相关性分数降序排序
#[tauri::command]
async fn fuzzy_search(query: String, entries: Vec<db::Entry>) -> Vec<db::Entry> {
    config::fuzzy_search(&query, entries)
}

// ============================================================================
// Tauri Commands: Browser Management / Tauri 命令：浏览器管理
// ============================================================================

/// Get custom browsers from config / 从配置获取自定义浏览器
/// Returns empty vec if no custom browsers configured / 如果没有配置自定义浏览器则返回空 vec
/// # Returns
/// - Vec<BrowserInfo>: Custom browser list / 自定义浏览器列表
fn get_custom_browsers(state: &State<'_, AppState>) -> Vec<browser::BrowserInfo> {
    state
        .config
        .lock()
        .get("global/custom_browsers")
        .and_then(|v| serde_json::from_value(v).map_err(|e| AppError::Config(e.to_string())))
        .unwrap_or_else(|_| Vec::new())
}

/// List all available browsers (system + custom) / 列出所有可用浏览器（系统 + 自定义）
/// Merges system browsers with custom browsers, avoiding duplicates by id
/// 将系统浏览器与自定义浏览器合并，按 id 去重
/// # Returns
/// - Vec<BrowserInfo>: Combined browser list / 合并后的浏览器列表
#[tauri::command]
async fn list_browsers(state: State<'_, AppState>) -> Result<Vec<browser::BrowserInfo>, String> {
    let mut browsers = browser::enumerate_browsers().map_err(|e| e.to_string())?;
    let custom = get_custom_browsers(&state);

    // Merge custom browsers, skip if already in system list / 合并自定义浏览器，如果已在系统列表则跳过
    for cb in custom {
        if !browsers.iter().any(|b| b.id == cb.id) {
            browsers.push(cb);
        }
    }

    Ok(browsers)
}

/// Add or update a custom browser / 添加或更新自定义浏览器
/// If browser with same id exists, updates path and name; otherwise adds new
/// 如果存在相同 id 的浏览器则更新 path 和 name；否则添加新的
/// # Arguments
/// - name: Display name for the browser / 浏览器的显示名称
/// - path: Full path to browser executable / 浏览器可执行文件的完整路径
#[tauri::command]
async fn add_custom_browser(
    name: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Generate id from name: lowercase, spaces to underscores
    // 从名称生成 id：转小写，空格变下划线
    let id = format!("custom_{}", name.to_lowercase().replace(" ", "_"));
    let new_browser = browser::BrowserInfo {
        id: id.clone(),
        name: name.clone(),
        exe_path: Some(path.clone()),
    };

    let mut custom = get_custom_browsers(&state);
    if let Some(existing) = custom.iter_mut().find(|b| b.id == id) {
        // Update existing / 更新已存在的
        existing.exe_path = Some(path);
        existing.name = name;
    } else {
        // Add new / 添加新的
        custom.push(new_browser);
    }

    let mut config = state.config.lock();
    config
        .set("global/custom_browsers", serde_json::json!(custom))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open URL with specified or default browser / 使用指定或默认浏览器打开 URL
/// # Arguments
/// - url: Target URL / 目标 URL
/// - browser_id: Optional specific browser id / 可选的特定浏览器 id
///   - If None: uses global/default_browser config / 如果为 None：使用 global/default_browser 配置
///   - If Some: uses specified browser / 如果为 Some：使用指定的浏览器
/// # Side Effects
/// - Launches browser process / 启动浏览器进程
/// - Writes to error log on failure / 失败时写入错误日志
#[tauri::command]
async fn open_url(
    url: String,
    browser_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Determine which browser to use / 确定使用哪个浏览器
    let browser_cmd = if let Some(_bid) = browser_id {
        // Frontend passed specific browser, check global config for actual command
        // 前端传递了特定浏览器，检查全局配置获取实际命令
        state
            .config
            .lock()
            .get_str(&format!("global/default_browser"))
            .ok()
            .and_then(|s| if s.is_empty() { None } else { Some(s) })
    } else {
        // If frontend didn't pass a specific browser id, read from global config
        // 如果前端没有传递特定浏览器 id，从全局配置读取
        state
            .config
            .lock()
            .get_str("global/default_browser")
            .ok()
            .and_then(|s| if s.is_empty() { None } else { Some(s) })
    };

    // Try to resolve browser path / 尝试解析浏览器路径
    let mut exe_path_res =
        browser::resolve_browser_path(browser_cmd.as_deref()).map_err(|e| e.to_string());

    // Check custom browsers if not found / 如果找不到则检查自定义浏览器
    if let Ok(None) = exe_path_res {
        if let Some(id) = browser_cmd.as_deref() {
            let custom = get_custom_browsers(&state);
            if let Some(b) = custom.iter().find(|b| b.id == id) {
                exe_path_res = Ok(b.exe_path.clone());
            }
        }
    }

    // Execute URL open / 执行 URL 打开
    match exe_path_res {
        Ok(Some(path)) => browser::open_url_with_browser(&url, &path).map_err(|e| {
            let msg = e.to_string();
            write_error_log(&app, &msg);
            msg
        }),
        _ => {
            // Fallback to system default browser / 回退到系统默认浏览器
            use tauri_plugin_opener::OpenerExt;
            app.opener().open_url(&url, None::<&str>).map_err(|e| {
                let msg = format!("Failed to open system default browser: {}", e);
                write_error_log(&app, &msg);
                msg
            })
        }
    }
}

/// Open a local application / 打开本地应用
/// # Arguments
/// - path: Full path to application executable / 应用可执行文件的完整路径
/// # Side Effects
/// - Spawns new process / 生成新进程
/// - Writes to error log on failure / 失败时写入错误日志
#[tauri::command]
async fn open_app(path: String, app: AppHandle) -> Result<(), String> {
    std::process::Command::new(&path).spawn().map_err(|e| {
        let msg = format!("Failed to open {}: {}", path, e);
        write_error_log(&app, &msg);
        msg
    })?;
    Ok(())
}

// ============================================================================
// Key Code Mapping / 按键代码映射
// ============================================================================

/// Convert key string to Tauri Code / 将按键字符串转换为 Tauri Code
/// Supports: letters (A-Z), digits (0-9), function keys (F1-F12),
/// navigation keys (Arrow keys, Home, End, etc.)
/// 支持：字母 (A-Z)、数字 (0-9)、功能键 (F1-F12)、导航键（方向键、Home、End 等）
/// # Arguments
/// - key: Key name string (case-insensitive) / 按键名字符串（不区分大小写）
/// # Returns
/// - Some(Code) if valid, None if unknown / 如果有效则返回 Some(Code)，未知则返回 None
fn key_string_to_code(key: &str) -> Option<Code> {
    match key.to_uppercase().as_str() {
        // Navigation: Space, Enter, Escape, Tab / 导航：空格、回车、Esc、Tab
        "SPACE" => Some(Code::Space),
        "ENTER" => Some(Code::Enter),
        "ESCAPE" | "ESC" => Some(Code::Escape),
        "TAB" => Some(Code::Tab),
        "BACKSPACE" => Some(Code::Backspace),
        "DELETE" | "DEL" => Some(Code::Delete),
        // Arrow keys / 方向键
        "UP" => Some(Code::ArrowUp),
        "DOWN" => Some(Code::ArrowDown),
        "LEFT" => Some(Code::ArrowLeft),
        "RIGHT" => Some(Code::ArrowRight),
        // Navigation keys / 导航键
        "HOME" => Some(Code::Home),
        "END" => Some(Code::End),
        "PAGEUP" => Some(Code::PageUp),
        "PAGEDOWN" => Some(Code::PageDown),
        // Function keys / 功能键
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
        // Letters / 字母
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
        // Digits / 数字
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

// ============================================================================
// HotkeyProvider Implementation / HotkeyProvider 实现
// ============================================================================

/// Implement HotkeyProvider for AppHandle to enable hotkey registration
/// 为 AppHandle 实现 HotkeyProvider 以启用热键注册
/// This allows register_hotkey_logic to work with Tauri AppHandle
/// 这使得 register_hotkey_logic 可以与 Tauri AppHandle 一起工作
impl hotkey::HotkeyProvider for AppHandle {
    /// Register a shortcut with the global shortcut manager
    /// 向全局快捷键管理器注册快捷键
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        self.global_shortcut()
            .register(shortcut)
            .map_err(|e| e.to_string())
    }

    /// Unregister a shortcut from the global shortcut manager
    /// 从全局快捷键管理器注销快捷键
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
        self.global_shortcut()
            .unregister(shortcut)
            .map_err(|e| e.to_string())
    }

    /// Check if a shortcut is currently registered
    /// 检查快捷键是否已注册
    fn is_registered(&self, shortcut: Shortcut) -> bool {
        self.global_shortcut().is_registered(shortcut)
    }
}

/// Core hotkey registration logic / 核心热键注册逻辑
/// Registers new shortcut, unregisters old one, updates state
/// 注册新快捷键，注销旧的，更新状态
/// # Type Parameter
/// - T: Any type implementing HotkeyProvider / 任何实现 HotkeyProvider 的类型
/// # Arguments
/// - provider: HotkeyProvider implementation (AppHandle or MockHotkeyProvider)
/// - new_shortcut: Shortcut to register / 要注册的快捷键
/// - current_state: Shared state to update with new shortcut
/// # Side Effects
/// - Registers new shortcut with system / 向系统注册新快捷键
/// - Unregisters old shortcut if exists / 如果存在则注销旧的快捷键
/// - Updates current_state with new shortcut / 用新快捷键更新 current_state
pub fn register_hotkey_logic<T: hotkey::HotkeyProvider>(
    provider: &T,
    new_shortcut: Shortcut,
    current_state: &Arc<Mutex<Option<Shortcut>>>,
) -> Result<(), String> {
    // Register first; if fails, don't update state / 先注册；如果失败，不更新状态
    provider.register(new_shortcut.clone())?;

    // Take old shortcut and unregister it / 取出旧的快捷键并注销
    let mut current = current_state.lock();
    if let Some(old) = current.take() {
        let _ = provider.unregister(old);
    }
    // Store new shortcut in state / 将新快捷键存入状态
    *current = Some(new_shortcut);
    Ok(())
}

// ============================================================================
// Tauri Commands: Hotkey Management / Tauri 命令：热键管理
// ============================================================================

/// Register a new global shortcut / 注册新的全局快捷键
/// Replaces any previously registered shortcut / 替换之前注册的任何快捷键
/// # Arguments
/// - modifiers: Array of modifier names ["Ctrl", "Alt", "Shift", "Win"]
/// - key: Key name (e.g., "Space", "K", "F1")
/// # Side Effects
/// - Registers shortcut with system / 向系统注册快捷键
/// - Previous shortcut is unregistered / 之前的快捷键会被注销
#[tauri::command]
async fn register_hotkey(
    modifiers: Vec<String>,
    key: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Parse modifiers / 解析修饰键
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

    // Parse key / 解析按键
    let code = key_string_to_code(&key).ok_or_else(|| format!("Unknown key: {}", key))?;

    // Build shortcut / 构建快捷键
    let new_shortcut = Shortcut::new(
        if mods.is_empty() {
            None
        } else {
            Some(mods.iter().fold(Modifiers::empty(), |acc, m| acc | *m))
        },
        code,
    );

    // Register using core logic / 使用核心逻辑注册
    register_hotkey_logic(&app, new_shortcut.clone(), &state.current_hotkey)?;

    // Setup callback for this shortcut / 为这个快捷键设置回调
    let handle = app.clone();
    let _ = app
        .global_shortcut()
        .on_shortcut(new_shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_window_visibility(&handle);
            }
        });

    Ok(())
}

/// Check if a shortcut would conflict with system or other apps
/// 检查快捷键是否与系统或其他应用冲突
/// # Arguments
/// - modifiers: Array of modifier names / 修饰键名称数组
/// - key: Key name / 按键名称
/// # Returns
/// - true if conflict exists, false otherwise / 如果存在冲突返回 true，否则返回 false
/// # Algorithm
/// 1. If already registered by us, no conflict / 如果已由我们注册则无冲突
/// 2. Try to register temporarily / 尝试临时注册
/// 3. If registration succeeds: no conflict, unregister immediately
///    如果注册成功：无冲突，立即注销
/// 4. If registration fails: conflict exists / 如果注册失败：存在冲突
#[tauri::command]
async fn check_hotkey_conflict(
    modifiers: Vec<String>,
    key: String,
    app: AppHandle,
) -> Result<bool, String> {
    // Parse modifiers and key / 解析修饰键和按键
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
        if mods.is_empty() {
            None
        } else {
            Some(mods.iter().fold(Modifiers::empty(), |acc, m| acc | *m))
        },
        code,
    );

    // Check if already registered by us / 检查是否已由我们注册
    if app.global_shortcut().is_registered(shortcut) {
        // Already registered by us, so no system conflict
        // 已由我们注册，所以没有系统冲突
        return Ok(false);
    }

    // Try to register to check for system-wide conflict / 尝试注册以检查系统级冲突
    match app.global_shortcut().register(shortcut) {
        Ok(_) => {
            // Success means no conflict. Unregister it so it can be registered for real later.
            // 成功意味着无冲突。注销它以便之后真正注册。
            let _ = app.global_shortcut().unregister(shortcut);
            Ok(false)
        }
        Err(_) => {
            // Failed to register means it's conflicting / 注册失败意味着存在冲突
            Ok(true)
        }
    }
}

// ============================================================================
// Tauri Commands: Import/Export / Tauri 命令：导入/导出
// ============================================================================

/// Export all configuration and entries to JSON
/// 将所有配置和条目导出为 JSON
/// # Returns
/// - String: JSON representation of all config and entries
/// # Format
/// ```json
/// {
///   "version": "0.1.0",
///   "kv": [["namespace", "key", "value"], ...]
/// }
/// ```
#[tauri::command]
async fn export_config(state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock();
    let db = state.db.lock();
    config.export_json(&db).map_err(|e| e.to_string())
}

/// Import configuration and entries from JSON
/// 从 JSON 导入配置和条目
/// # Arguments
/// - json: JSON string from export_config / export_config 导出的 JSON 字符串
/// # Side Effects
/// - Overwrites existing config and entries / 覆盖现有配置和条目
/// - Uses INSERT OR REPLACE so existing entries are updated
/// - 使用 INSERT OR REPLACE 所以现有条目会被更新
#[tauri::command]
async fn import_config(json: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    let mut db = state.db.lock();
    config
        .import_json(&mut db, &json)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands: Window Visibility / Tauri 命令：窗口可见性
// ============================================================================

/// Show main window, focus it, and update position / 显示主窗口、聚焦并更新位置
#[tauri::command]
async fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        update_window_position(&window).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide main window / 隐藏主窗口
#[tauri::command]
async fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

// ============================================================================
// Tauri Commands: First Launch / Tauri 命令：首次启动
// ============================================================================

/// Check if app has been launched before / 检查应用是否曾经启动过
/// Used for first-run welcome wizard / 用于首次运行欢迎向导
/// # Returns
/// - true if launched before, false if first launch
/// - 如果曾经启动过返回 true，首次启动返回 false
#[tauri::command]
async fn get_has_launched(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock();
    let val = config
        .get("global/has_launched")
        .map_err(|e| e.to_string())?;
    Ok(val.as_bool().unwrap_or(false))
}

/// Mark app as having been launched / 标记应用已经启动
/// Called after first-run wizard completes / 在首次运行向导完成后调用
#[tauri::command]
async fn mark_launched(state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    config
        .set("global/has_launched", serde_json::json!(true))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear launched state to show welcome wizard again
/// 清除启动状态以再次显示欢迎向导
/// Used for "restart welcome" feature / 用于"重新观看欢迎向导"功能
#[tauri::command]
async fn unmark_launched(state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock();
    config
        .set("global/has_launched", serde_json::json!(false))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Tauri Commands: Settings Panel / Tauri 命令：设置面板
// ============================================================================

/// Show settings window / 显示设置窗口
#[tauri::command]
async fn show_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// Update tray menu item labels with i18n support
/// 用 i18n 支持更新托盘菜单项标签
/// # Arguments
/// - show: Label for "show" menu item / "显示" 菜单项的标签
/// - settings: Label for "settings" menu item / "设置" 菜单项的标签
/// - quit: Label for "quit" menu item / "退出" 菜单项的标签
#[tauri::command]
async fn update_tray_menu(
    app: AppHandle,
    show: String,
    settings: String,
    quit: String,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        // Rebuild menu with new labels / 用新标签重建菜单
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

/// Resize main window and update position / 调整主窗口大小并更新位置
/// # Arguments
/// - width: New window width (logical pixels) / 新窗口宽度（逻辑像素）
/// - height: New window height (logical pixels) / 新窗口高度（逻辑像素）
/// # Side Effects
/// - Resizes and repositions window / 调整大小并重新定位窗口
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

// ============================================================================
// Application Entry / 应用入口
// ============================================================================

/// Main application setup and run / 主应用设置和运行
/// Initializes:
/// - Data directory and logging / 数据目录和日志
/// - SQLite database / SQLite 数据库
/// - ConfigManager / 配置管理器
/// - System tray / 系统托盘
/// - Global shortcut / 全局快捷键
/// - Main window position / 主窗口位置
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Initialize plugins / 初始化插件
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        // Setup application / 设置应用
        .setup(|app| {
            // Create data directory / 创建数据目录
            let data_dir = get_data_dir(app.handle());
            std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

            // Initialize logging / 初始化日志
            if let Err(e) = setup_logging(app.handle()) {
                error!("Failed to setup logging: {}", e);
            }

            // Initialize database and config manager / 初始化数据库和配置管理器
            let db = db::Database::new(&data_dir.join("config.db"))
                .expect("Failed to initialize database");
            let config = config::ConfigManager::new(db.clone())
                .expect("Failed to initialize config manager");

            // Manage application state / 管理应用状态
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                config: Arc::new(Mutex::new(config)),
                current_hotkey: Arc::new(Mutex::new(None)),
            });

            // Setup system tray / 设置系统托盘
            setup_tray(app.handle())?;

            // Setup global shortcut / 设置全局快捷键
            let state = app.state::<AppState>();
            setup_global_shortcut(app.handle(), state);

            // Center window on startup / 启动时将窗口居中
            if let Some(window) = app.get_webview_window("main") {
                let _ = update_window_position(&window);
            }

            info!("nk-launcher started successfully");
            Ok(())
        })
        // Register all Tauri commands / 注册所有 Tauri 命令
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
            add_custom_browser,
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
            unmark_launched,
            show_settings,
            update_tray_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}