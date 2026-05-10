//! Database module / 数据库模块
//! SQLite wrapper for entries and configuration storage
//! 用于条目和配置存储的 SQLite 封装

use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ============================================================================
// Data Structures / 数据结构
// ============================================================================

/// Entry for launcher commands / 启动器命令的条目
/// Can represent: website (with URL), app (with path), subgrid (grouping)
/// 可以表示：网站（带 URL）、应用（带路径）、子网格（分组）
/// # Fields
/// - command: Unique identifier within namespace (e.g., "bd", "1", "12")
/// - kind: Type - "website", "app", or "subgrid" / 类型 - "website"、"app" 或 "subgrid"
/// - title: Display name / 显示名称
/// - url: URL for websites / 网站的 URL
/// - path: File path for apps / 应用的 文件路径
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub command: String,
    pub kind: String,
    pub title: String,
    pub url: Option<String>,
    pub path: Option<String>,
    /// Origin namespace, stamped on read by `Database::get_entries`.
    /// Persists through `fuzzy_search` round-trips so the frontend can
    /// distinguish cross-namespace results when mode interop is on.
    /// Ignored on writes — `save_entry` uses the explicit `namespace` arg.
    #[serde(default)]
    pub namespace: Option<String>,
}

// ============================================================================
// Database / 数据库
// ============================================================================

/// SQLite database wrapper / SQLite 数据库封装
/// Manages two tables: entries (command shortcuts) and config (key-value settings)
/// 管理两个表：entries（命令快捷方式）和 config（键值设置）
/// # Invariant
/// - All entries operations require namespace to prevent command collisions
/// - 所有 entries 操作需要 namespace 以防止 command 冲突
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Create new database connection and initialize tables
    /// 创建新的数据库连接并初始化表
    /// # Arguments
    /// - path: Path to SQLite database file / SQLite 数据库文件路径
    /// # Returns
    /// - Result<Self, AppError>: Database instance or error
    /// # Side Effects
    /// - Creates tables if not exist: entries, config / 如果不存在则创建表：entries, config
    /// - Uses IF NOT EXISTS so safe to call multiple times / 使用 IF NOT EXISTS 所以多次调用安全
    pub fn new(path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;

        // Create entries table: namespace + command form primary key
        // 创建 entries 表：namespace + command 形成主键
        conn.execute(
            "CREATE TABLE IF NOT EXISTS entries (
                namespace TEXT NOT NULL,
                command TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT,
                path TEXT,
                PRIMARY KEY (namespace, command)
            )",
            [],
        )?;

        // Create config table: key-value storage for all settings
        // 创建 config 表：所有设置的键值存储
        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Self { conn })
    }

    /// Get all entries for a namespace / 获取某个命名空间的所有条目
    /// # Arguments
    /// - namespace: "expert" or "simple" / 命名空间："expert" 或 "simple"
    /// # Returns
    /// - Result<Vec<Entry>, AppError>: List of entries in namespace
    pub fn get_entries(&self, namespace: &str) -> Result<Vec<Entry>, AppError> {
        let mut stmt = self
            .conn
            .prepare("SELECT command, kind, title, url, path FROM entries WHERE namespace = ?1")?;
        let entries = stmt
            .query_map([namespace], |row| {
                Ok(Entry {
                    command: row.get(0)?,
                    kind: row.get(1)?,
                    title: row.get(2)?,
                    url: row.get(3)?,
                    path: row.get(4)?,
                    namespace: Some(namespace.to_string()),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    /// Save or update an entry / 保存或更新条目
    /// Uses INSERT OR REPLACE so command is unique within namespace
    /// 使用 INSERT OR REPLACE，所以 command 在命名空间内唯一
    /// # Arguments
    /// - namespace: "expert" or "simple" / 命名空间："expert" 或 "simple"
    /// - entry: Entry to save / 要保存的条目
    /// # Side Effects
    /// - Updates existing entry if command exists, otherwise inserts new
    /// - 如果 command 存在则更新现有条目，否则插入新的
    pub fn save_entry(&mut self, namespace: &str, entry: &Entry) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO entries (namespace, command, kind, title, url, path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                namespace,
                entry.command,
                entry.kind,
                entry.title,
                entry.url,
                entry.path
            ],
        )?;
        Ok(())
    }

    /// Delete an entry by command key / 按 command 键删除条目
    /// # Arguments
    /// - namespace: "expert" or "simple" / 命名空间："expert" 或 "simple"
    /// - command: Entry command to delete / 要删除的条目 command
    pub fn delete_entry(&mut self, namespace: &str, command: &str) -> Result<(), AppError> {
        self.conn.execute(
            "DELETE FROM entries WHERE namespace = ?1 AND command = ?2",
            params![namespace, command],
        )?;
        Ok(())
    }

    /// Get a config value by key / 根据键获取配置值
    /// # Arguments
    /// - key: Config key (e.g., "global/theme") / 配置键（如 "global/theme"）
    /// # Returns
    /// - Result<Option<String>, AppError>: Some(value) if found, None if not exists
    pub fn get_config(&self, key: &str) -> Result<Option<String>, AppError> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM config WHERE key = ?1")?;
        // ok() converts NotFound to None / ok() 将 NotFound 转换为 None
        let result = stmt.query_row([key], |row| row.get(0)).ok();
        Ok(result)
    }

    /// Set a config value / 设置配置值
    /// Uses INSERT OR REPLACE so always overwrites / 使用 INSERT OR REPLACE 所以总是覆盖
    /// # Arguments
    /// - key: Config key / 配置键
    /// - value: String value to store / 要存储的字符串值
    pub fn set_config(&mut self, key: &str, value: &str) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    /// Get all config key-value pairs / 获取所有配置键值对
    /// # Returns
    /// - Result<Vec<(String, String)>, AppError>: All (key, value) pairs in config table
    pub fn get_all_config(&self) -> Result<Vec<(String, String)>, AppError> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM config")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Delete all entries in a namespace / 删除某个命名空间的所有条目
    /// Used when clearing a grid / 用于清空网格时
    /// # Arguments
    /// - namespace: Namespace to clear / 要清空的命名空间
    pub fn clear_namespace(&mut self, namespace: &str) -> Result<(), AppError> {
        self.conn
            .execute("DELETE FROM entries WHERE namespace = ?1", [namespace])?;
        Ok(())
    }
}

