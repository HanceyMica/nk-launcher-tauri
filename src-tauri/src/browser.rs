//! Browser enumeration module / 浏览器枚举模块
//! Enumerates installed browsers via Windows Registry, supports custom browsers
//! 通过 Windows 注册表枚举已安装的浏览器，支持自定义浏览器

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ============================================================================
// Data Structures / 数据结构
// ============================================================================

/// Browser information / 浏览器信息
/// # Fields
/// - id: Unique identifier (e.g., "chrome", "firefox", "custom_chrome")
/// - name: Display name (e.g., "Google Chrome") / 显示名称（如 "Google Chrome"）
/// - exe_path: Path to browser executable / 浏览器可执行文件路径
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserInfo {
    pub id: String,
    pub name: String,
    pub exe_path: Option<String>,
}

// ============================================================================
// Registry Provider Trait / 注册表提供者 Trait
// ============================================================================

/// Trait for browser enumeration implementations
/// 浏览器枚举实现的 trait
/// Allows different implementations for Windows (Registry) and other OS
/// 允许为 Windows（注册表）和其他操作系统提供不同实现
pub trait RegistryProvider {
    /// Enumerate all installed browsers / 枚举所有已安装的浏览器
    /// # Returns
    /// - Result<Vec<BrowserInfo>, AppError>: List of discovered browsers
    fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError>;
}

// ============================================================================
// Windows Registry Implementation / Windows 注册表实现
// ============================================================================

/// Windows registry-based browser enumeration / 基于 Windows 注册表的浏览器枚举
/// Reads from HKEY_CURRENT_USER and HKEY_LOCAL_MACHINE under
/// Software\Clients\StartMenuInternet to find installed browsers
/// 从 HKEY_CURRENT_USER 和 HKEY_LOCAL_MACHINE 的 Software\Clients\StartMenuInternet 读取
pub struct WindowsRegistry;

impl RegistryProvider for WindowsRegistry {
    #[cfg(target_os = "windows")]
    fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError> {
        use std::collections::HashSet;
        use winreg::enums::*;
        use winreg::RegKey;

        let mut browsers = Vec::new();
        // Track seen names to avoid duplicates from both HKCU and HKLM
        // 跟踪已见名称以避免来自 HKCU 和 HKLM 的重复
        let mut seen = HashSet::new();

        // Check both user and machine registry hives / 检查用户和机器注册表配置单元
        let hives = [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];

        for hive in hives {
            let root = RegKey::predef(hive);
            // Main browser list location in Windows registry
            // Windows 注册表中的主浏览器列表位置
            if let Ok(startmenu) = root.open_subkey("Software\\Clients\\StartMenuInternet") {
                for name in startmenu.enum_keys().filter_map(|k| k.ok()) {
                    // Skip if already seen / 如果已见过则跳过
                    if seen.contains(&name) {
                        continue;
                    }

                    if let Ok(key) = startmenu.open_subkey(&name) {
                        // Get display name (default value), fallback to key name
                        // 获取显示名称（默认值），回退到键名
                        let browser_name = key
                            .get_value::<String, _>("")
                            .unwrap_or_else(|_| name.clone());

                        // Get executable path from shell\open\command
                        // 从 shell\open\command 获取可执行文件路径
                        let exe_path = key
                            .open_subkey("shell\\open\\command")
                            .and_then(|cmd_key| cmd_key.get_value::<String, _>(""))
                            .map(|cmd| parse_command_to_exe(&cmd))
                            .ok();

                        browsers.push(BrowserInfo {
                            id: name.clone(),
                            name: browser_name,
                            exe_path,
                        });
                        seen.insert(name);
                    }
                }
            }
        }

        // Fallback if no browsers found / 如果未找到浏览器则回退
        if browsers.is_empty() {
            browsers.push(BrowserInfo {
                id: "default".to_string(),
                name: "Default Browser".to_string(),
                exe_path: None,
            });
        }

        Ok(browsers)
    }

    #[cfg(not(target_os = "windows"))]
    fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError> {
        // Non-Windows fallback: return default browser only / 非 Windows 回退：只返回默认浏览器
        Ok(vec![BrowserInfo {
            id: "default".to_string(),
            name: "Default Browser".to_string(),
            exe_path: None,
        }])
    }
}

/// 5-second TTL cache to skip redundant registry walks within a single launch action.
/// Browsers rarely change at runtime, but install events do happen — TTL keeps a fresh view.
static BROWSER_CACHE: Mutex<Option<(Instant, Vec<BrowserInfo>)>> = Mutex::new(None);
const BROWSER_CACHE_TTL: Duration = Duration::from_secs(5);

/// Enumerate all browsers using Windows registry, with a short TTL cache.
/// 枚举浏览器，带 5 秒 TTL 缓存以避免重复扫描注册表。
pub fn enumerate_browsers() -> Result<Vec<BrowserInfo>, AppError> {
    if let Ok(guard) = BROWSER_CACHE.lock() {
        if let Some((stamp, list)) = guard.as_ref() {
            if stamp.elapsed() < BROWSER_CACHE_TTL {
                return Ok(list.clone());
            }
        }
    }

    let list = WindowsRegistry.enumerate_browsers()?;
    if let Ok(mut guard) = BROWSER_CACHE.lock() {
        *guard = Some((Instant::now(), list.clone()));
    }
    Ok(list)
}

// ============================================================================
// Command Parsing / 命令解析
// ============================================================================

/// Parse browser command string to extract executable path
/// 解析浏览器命令字符串以提取可执行文件路径
/// Handles formats: "C:\path\to\browser.exe" and C:\path\to\browser.exe
/// 处理格式："C:\path\to\browser.exe" 和 C:\path\to\browser.exe
/// # Algorithm
/// 1. Trim whitespace / 去除空白
/// 2. If starts with '"', extract between quotes / 如果以 '"' 开头，提取引号之间的内容
/// 3. Else if contains space, take first token / 否则如果包含空格，取第一个标记
/// 4. Otherwise return as-is / 否则原样返回
/// # Arguments
/// - cmd: Command string from registry / 来自注册表的命令字符串
/// # Returns
/// - String: Executable path / 可执行文件路径
fn parse_command_to_exe(cmd: &str) -> String {
    let cmd = cmd.trim();
    // Handle quoted paths like "C:\Program Files\Browser\chrome.exe" --arg
    // 处理带引号的路径如 "C:\Program Files\Browser\chrome.exe" --arg
    if cmd.starts_with('"') {
        let rest = &cmd[1..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    // Handle unquoted paths like C:\Browser\chrome.exe https://example.com
    // 处理不带引号的路径如 C:\Browser\chrome.exe https://example.com
    if let Some(space) = cmd.find(' ') {
        return cmd[..space].to_string();
    }
    // No space, return as-is / 没有空格，原样返回
    cmd.to_string()
}

// ============================================================================
// Browser Resolution & Launch / 浏览器解析与启动
// ============================================================================

/// Resolve browser path from browser ID / 从浏览器 ID 解析浏览器路径
/// # Arguments
/// - browser_id: Browser identifier (e.g., "chrome", "custom_chrome")
/// # Returns
/// - Result<Option<String>, AppError>: Some(path) if found, None if not found
pub fn resolve_browser_path(browser_id: Option<&str>) -> Result<Option<String>, AppError> {
    match browser_id {
        Some(id) => {
            // Enumerate and find matching browser / 枚举并查找匹配的浏览器
            let browsers = enumerate_browsers()?;
            let browser = browsers.iter().find(|b| b.id == id);
            Ok(browser.and_then(|b| b.exe_path.clone()))
        }
        None => Ok(None),
    }
}

/// Open URL with specified browser / 使用指定浏览器打开 URL
/// # Arguments
/// - url: Target URL / 目标 URL
/// - exe_path: Path to browser executable / 浏览器可执行文件路径
/// # Returns
/// - Result<(), AppError>: Error if browser not found or launch fails
/// # Side Effects
/// - Spawns browser process / 生成浏览器进程
/// - On Windows: uses DETACHED_PROCESS to avoid child process management
/// - 在 Windows 上：使用 DETACHED_PROCESS 以避免子进程管理
pub fn open_url_with_browser(url: &str, exe_path: &str) -> Result<(), AppError> {
    let exe = PathBuf::from(exe_path);
    // Verify browser exists before attempting launch / 在尝试启动前验证浏览器存在
    if !exe.exists() {
        return Err(AppError::Browser(format!(
            "Browser not found: {}",
            exe_path
        )));
    }

    let mut cmd = Command::new(&exe);
    cmd.arg(url);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS: new process runs independently, no console window
        // DETACHED_PROCESS：新进程独立运行，无控制台窗口
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    cmd.spawn()
        .map_err(|e| AppError::Browser(format!("Failed to open URL: {}", e)))?;

    Ok(())
}

// ============================================================================
// Tests / 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Test parsing quoted command paths / 测试解析带引号的命令路径
    #[test]
    fn test_parse_command_to_exe() {
        // Quoted path with arguments / 带参数的带引号路径
        let cmd1 = "\"C:\\Program Files\\Browser\\browser.exe\" --arg \"value\"";
        assert_eq!(
            parse_command_to_exe(cmd1),
            "C:\\Program Files\\Browser\\browser.exe"
        );

        // Unquoted path / 不带引号的路径
        let cmd2 = "C:\\Browser\\chrome.exe https://example.com";
        assert_eq!(parse_command_to_exe(cmd2), "C:\\Browser\\chrome.exe");
    }

    /// Test browser enumeration with mock / 使用 mock 测试浏览器枚举
    #[test]
    fn test_browser_enumeration_mock() {
        // Using MockRegistry in tests / 在测试中使用 MockRegistry
        let provider = MockRegistry;
        let browsers = provider.enumerate_browsers().unwrap();
        assert_eq!(browsers.len(), 2);
        assert_eq!(browsers[0].id, "chrome");
        assert_eq!(
            browsers[0].exe_path.as_deref(),
            Some("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
        );
        assert_eq!(browsers[1].id, "firefox");
        assert!(browsers[1].exe_path.is_none());
    }
}

// Mock implementation for tests / 用于测试的 Mock 实现
#[cfg(test)]
pub struct MockRegistry;

#[cfg(test)]
impl RegistryProvider for MockRegistry {
    fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError> {
        Ok(vec![
            BrowserInfo {
                id: "chrome".to_string(),
                name: "Google Chrome".to_string(),
                exe_path: Some(
                    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe".to_string(),
                ),
            },
            BrowserInfo {
                id: "firefox".to_string(),
                name: "Mozilla Firefox".to_string(),
                exe_path: None,
            },
        ])
    }
}