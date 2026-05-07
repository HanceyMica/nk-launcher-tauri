use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("Database error: {0}")]
    Db(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Hotkey error: {0}")]
    Hotkey(String),

    #[error("Browser error: {0}")]
    Browser(String),

    #[error("UI error: {0}")]
    Ui(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Ui(e.to_string())
    }
}
