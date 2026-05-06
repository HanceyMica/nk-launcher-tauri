use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserInfo {
    pub id: String,
    pub name: String,
    pub exe_path: Option<String>,
}

pub trait RegistryProvider {
    fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError>;
}

pub struct WindowsRegistry;

impl RegistryProvider for WindowsRegistry {
    #[cfg(target_os = "windows")]
    fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError> {
        use winreg::enums::*;
        use winreg::RegKey;
        use std::collections::HashSet;

        let mut browsers = Vec::new();
        let mut seen = HashSet::new();

        let hives = [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];
        
        for hive in hives {
            let root = RegKey::predef(hive);
            if let Ok(startmenu) = root.open_subkey("Software\\Clients\\StartMenuInternet") {
                for name in startmenu.enum_keys().filter_map(|k| k.ok()) {
                    if seen.contains(&name) {
                        continue;
                    }

                    if let Ok(key) = startmenu.open_subkey(&name) {
                        let browser_name = key.get_value::<String, _>("").unwrap_or_else(|_| name.clone());
                        
                        let exe_path = key.open_subkey("shell\\open\\command")
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
        Ok(vec![BrowserInfo {
            id: "default".to_string(),
            name: "Default Browser".to_string(),
            exe_path: None,
        }])
    }
}

pub fn enumerate_browsers() -> Result<Vec<BrowserInfo>, AppError> {
    let provider = WindowsRegistry;
    provider.enumerate_browsers()
}

fn parse_command_to_exe(cmd: &str) -> String {
    let cmd = cmd.trim();
    if cmd.starts_with('"') {
        let rest = &cmd[1..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    if let Some(space) = cmd.find(' ') {
        return cmd[..space].to_string();
    }
    cmd.to_string()
}

pub fn resolve_browser_path(browser_id: Option<&str>) -> Result<Option<String>, AppError> {
    match browser_id {
        Some(id) => {
            let browsers = enumerate_browsers()?;
            let browser = browsers.iter().find(|b| b.id == id);
            Ok(browser.and_then(|b| b.exe_path.clone()))
        }
        None => Ok(None),
    }
}

pub fn open_url_with_browser(url: &str, exe_path: &str) -> Result<(), AppError> {
    let exe = PathBuf::from(exe_path);
    if !exe.exists() {
        return Err(AppError::Browser(format!("Browser not found: {}", exe_path)));
    }

    let mut cmd = Command::new(&exe);
    cmd.arg(url);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    cmd.spawn()
        .map_err(|e| AppError::Browser(format!("Failed to open URL: {}", e)))?;

    Ok(())
}

#[cfg(test)]
pub fn construct_browser_args(browser_id: &str, url: &str) -> Result<(String, Vec<String>), AppError> {
    let browsers = enumerate_browsers()?;
    let browser = browsers.iter().find(|b| b.id == browser_id);

    let exe_path = browser
        .and_then(|b| b.exe_path.as_ref())
        .ok_or_else(|| AppError::Browser("Browser not found".to_string()))?
        .clone();

    Ok((exe_path, vec![url.to_string()]))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockRegistry;

    impl RegistryProvider for MockRegistry {
        fn enumerate_browsers(&self) -> Result<Vec<BrowserInfo>, AppError> {
            Ok(vec![
                BrowserInfo {
                    id: "chrome".to_string(),
                    name: "Google Chrome".to_string(),
                    exe_path: Some("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe".to_string()),
                },
                BrowserInfo {
                    id: "firefox".to_string(),
                    name: "Mozilla Firefox".to_string(),
                    exe_path: None,
                },
            ])
        }
    }

    #[test]
    fn test_parse_command_to_exe() {
        let cmd1 = "\"C:\\Program Files\\Browser\\browser.exe\" --arg \"value\"";
        assert_eq!(parse_command_to_exe(cmd1), "C:\\Program Files\\Browser\\browser.exe");

        let cmd2 = "C:\\Browser\\chrome.exe https://example.com";
        assert_eq!(parse_command_to_exe(cmd2), "C:\\Browser\\chrome.exe");
    }

    #[test]
    fn test_browser_enumeration_mock() {
        let provider = MockRegistry;
        let browsers = provider.enumerate_browsers().unwrap();
        assert_eq!(browsers.len(), 2);
        assert_eq!(browsers[0].id, "chrome");
        assert_eq!(browsers[0].exe_path.as_deref(), Some("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"));
        assert_eq!(browsers[1].id, "firefox");
        assert!(browsers[1].exe_path.is_none());
    }

    #[test]
    fn test_browser_enumeration() {
        let browsers = enumerate_browsers();
        assert!(browsers.is_ok());
    }

    #[test]
    fn test_resolve_browser_path() {
        let path = resolve_browser_path(Some("default"));
        assert!(path.is_ok());
    }
}