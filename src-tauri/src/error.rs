//! Application error types / 应用错误类型定义
//! Provides unified error handling across all modules / 提供跨模块的统一错误处理

use thiserror::Error;

/// Central error type for the application / 应用的核心错误类型
/// All Rust-side errors are converted to this enum for consistent error handling
/// 所有 Rust 端错误都转换为这个枚举以实现一致的错误处理
#[derive(Error, Debug)]
pub enum AppError {
    /// IO errors: file operations, network, etc. / IO 错误：文件操作、网络等
    #[error("IO error: {0}")]
    Io(String),

    /// Database errors: SQLite operations / 数据库错误：SQLite 操作
    #[error("Database error: {0}")]
    Db(String),

    /// Configuration errors: JSON parsing, validation, missing keys
    /// 配置错误：JSON 解析、验证、缺失键
    #[error("Config error: {0}")]
    Config(String),

    /// Hotkey registration conflicts or system-level shortcut errors
    /// 热键注册冲突或系统级快捷键错误
    #[error("Hotkey error: {0}")]
    Hotkey(String),

    /// Browser enumeration or launch failures / 浏览器枚举或启动失败
    #[error("Browser error: {0}")]
    Browser(String),

    /// Tauri/UI framework errors / Tauri/UI 框架错误
    #[error("UI error: {0}")]
    Ui(String),
}

/// Convert rusqlite::Error into AppError::Db for unified handling
/// 将 rusqlite::Error 转换为 AppError::Db 以统一处理
impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

/// Convert tauri::Error into AppError::Ui for unified handling
/// 将 tauri::Error 转换为 AppError::Ui 以统一处理
impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Ui(e.to_string())
    }
}
