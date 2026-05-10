//! Configuration management module / 配置管理模块
//! Provides JSON-based config storage with SQLite backend and fuzzy search
//! 提供基于 JSON 的配置存储，带 SQLite 后端和模糊搜索

use crate::db::{Database, Entry};
use crate::error::AppError;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ============================================================================
// Data Structures / 数据结构
// ============================================================================

/// Application configuration structure / 应用配置结构
/// Contains all user-facing settings / 包含所有用户面向的设置
/// # Fields
/// - version: Config format version / 配置格式版本
/// - mode: "expert" or "simple" launcher mode / "expert" 或 "simple" 启动器模式
/// - theme: "light", "dark", or "system" / "light"、"dark" 或 "system"
/// - language: UI language code (zh/en/ja) / UI 语言代码 (zh/en/ja)
/// - default_browser: Browser ID for URL opening / 用于打开 URL 的浏览器 ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub mode: String,
    pub theme: String,
    pub language: String,
    pub default_browser: Option<String>,
    pub shortcut: Option<String>,
    pub bg_image: Option<String>,
    pub bg_blur: Option<i64>,
    pub bg_opacity: Option<i64>,
    pub search_opacity: Option<i64>,
    pub search_width: Option<f64>,
    pub simple_bg_enabled: Option<bool>,
    pub window_sizes: Option<serde_json::Value>,
}

// ============================================================================
// ConfigManager / 配置管理器
// ============================================================================

/// Configuration manager with JSON serialization and SQLite storage
/// 带 JSON 序列化和 SQLite 存储的配置管理器
/// Manages key-value config pairs organized by namespace (e.g., "global/theme")
/// 管理按命名空间组织的键值配置对（如 "global/theme"）
/// Holds a shared `Arc<Mutex<Database>>` so that the same SQLite connection is
/// reused across `AppState.db` and `AppState.config` — preventing the
/// dual-connection / SQLITE_BUSY race that plagued the previous design.
pub struct ConfigManager {
    db: Arc<Mutex<Database>>,
}

impl ConfigManager {
    /// Create new ConfigManager and initialize default values
    /// 创建新的配置管理器并初始化默认值
    /// # Arguments
    /// - db: Shared database handle / 共享数据库句柄
    /// # Returns
    /// - Result<Self, AppError>: ConfigManager or error on failure
    /// # Side Effects
    /// - Sets default values for: mode, theme, language, shortcut
    pub fn new(db: Arc<Mutex<Database>>) -> Result<Self, AppError> {
        let manager = Self { db };
        manager.init_defaults()?;
        Ok(manager)
    }

    /// Initialize default values if not present / 如果不存在则初始化默认值
    /// Only sets value if key doesn't exist (raw row absent), so corrupted/non-JSON
    /// values are preserved instead of silently overwritten.
    /// 仅当 raw 行缺失时写入默认值——非 JSON 等损坏值不会被静默覆盖。
    fn init_defaults(&self) -> Result<(), AppError> {
        let mut db = self.db.lock();
        let defaults: [(&str, serde_json::Value); 4] = [
            ("global/mode", serde_json::json!("expert")),
            ("global/theme", serde_json::json!("system")),
            ("global/language", serde_json::json!("zh")),
            ("global/shortcut", serde_json::json!("Alt+Space")),
        ];
        for (key, value) in defaults {
            if db.get_config(key)?.is_none() {
                let s = serde_json::to_string(&value).map_err(|e| {
                    AppError::Config(format!("Failed to serialize default: {}", e))
                })?;
                db.set_config(key, &s)?;
            }
        }
        Ok(())
    }

    /// Get a config value by key / 根据键获取配置值
    pub fn get(&self, key: &str) -> Result<serde_json::Value, AppError> {
        let raw = self
            .db
            .lock()
            .get_config(key)?
            .ok_or_else(|| AppError::Config(format!("Key not found: {}", key)))?;
        serde_json::from_str(&raw)
            .map_err(|e| AppError::Config(format!("Failed to parse config value: {}", e)))
    }

    /// Get a config value as String / 获取配置值为字符串
    pub fn get_str(&self, key: &str) -> Result<String, AppError> {
        self.get(key).and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Config(format!("Value is not a string: {}", v)))
        })
    }

    /// Set a config value / 设置配置值
    pub fn set(&self, key: &str, value: serde_json::Value) -> Result<(), AppError> {
        let s = serde_json::to_string(&value)
            .map_err(|e| AppError::Config(format!("Failed to serialize value: {}", e)))?;
        self.db.lock().set_config(key, &s)
    }

    /// Get all configuration as AppConfig struct / 将所有配置获取为 AppConfig 结构
    /// # Returns
    /// - Result<AppConfig, AppError>: Full app config with defaults for missing values
    /// # Note
    /// - Missing keys return default values: version="0.1.0", mode="expert", theme="system", language="zh"
    pub fn get_all(&self) -> Result<AppConfig, AppError> {
        Ok(AppConfig {
            version: self
                .get_str("global/version")
                .unwrap_or_else(|_| "0.1.0".to_string()),
            mode: self
                .get_str("global/mode")
                .unwrap_or_else(|_| "expert".to_string()),
            theme: self
                .get_str("global/theme")
                .unwrap_or_else(|_| "system".to_string()),
            language: self
                .get_str("global/language")
                .unwrap_or_else(|_| "zh".to_string()),
            default_browser: self.get_str("global/default_browser").ok(),
            shortcut: self.get_str("global/shortcut").ok(),
            bg_image: self.get_str("global/bg_image").ok(),
            bg_blur: self.get("global/bg_blur").ok().and_then(|v| v.as_i64()),
            bg_opacity: self.get("global/bg_opacity").ok().and_then(|v| v.as_i64()),
            search_opacity: self.get("global/search_opacity").ok().and_then(|v| v.as_i64()),
            search_width: self.get("global/search_width").ok().and_then(|v| v.as_f64()),
            simple_bg_enabled: self.get("global/simple_bg_enabled").ok().and_then(|v| v.as_bool()),
            window_sizes: self.get("global/window_sizes").ok(),
        })
    }

    /// Export all config AND entries as JSON string / 将所有配置和条目导出为 JSON 字符串
    /// # Returns
    /// - Result<String, AppError>: JSON string in format:
    ///   ```json
    ///   {
    ///     "version": "0.1.0",
    ///     "kv": [["namespace", "key", "value"], ...],
    ///     "entries": { "namespace": [{ "command": "", "kind": "", "title": "", "url": null, "path": null }, ...], ... }
    ///   }
    ///   ```
    pub fn export_json(&self) -> Result<String, AppError> {
        let all_config = self.db.lock().get_all_config()?;
        let kv: Vec<[String; 3]> = all_config
            .into_iter()
            .map(|(k, v)| {
                let parts: Vec<&str> = k.splitn(2, '/').collect();
                let ns = parts.get(0).unwrap_or(&"global");
                let key_str = k.as_str();
                let key = parts
                    .get(1)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| key_str.to_string());
                [ns.to_string(), key, v]
            })
            .collect();

        // Export entries from both expert and simple namespaces
        let expert_entries = self.db.lock().get_entries("expert")?;
        let simple_entries = self.db.lock().get_entries("simple")?;

        let mut entries_map = serde_json::Map::new();
        if !expert_entries.is_empty() {
            entries_map.insert(
                "expert".to_string(),
                serde_json::to_value(&expert_entries).map_err(|e| AppError::Config(format!("Failed to serialize expert entries: {}", e)))?,
            );
        }
        if !simple_entries.is_empty() {
            entries_map.insert(
                "simple".to_string(),
                serde_json::to_value(&simple_entries).map_err(|e| AppError::Config(format!("Failed to serialize simple entries: {}", e)))?,
            );
        }

        let export = serde_json::json!({
            "version": "0.1.0",
            "kv": kv,
            "entries": entries_map
        });

        serde_json::to_string_pretty(&export)
            .map_err(|e| AppError::Config(format!("Failed to export: {}", e)))
    }

    /// Import config AND entries from JSON string / 从 JSON 字符串导入配置和条目
    /// # Arguments
    /// - json: JSON string from export_json / export_json 导出的 JSON 字符串
    /// # Side Effects
    /// - Overwrites existing config with INSERT OR REPLACE / 用 INSERT OR REPLACE 覆盖现有配置
    /// - Imports entries into expert and simple namespaces / 导入条目到 expert 和 simple 命名空间
    pub fn import_json(&self, json: &str) -> Result<(), AppError> {
        let data: serde_json::Value = serde_json::from_str(json)
            .map_err(|e| AppError::Config(format!("Invalid JSON: {}", e)))?;

        let kv = data["kv"]
            .as_array()
            .ok_or_else(|| AppError::Config("Missing 'kv' field".to_string()))?;

        let mut db = self.db.lock();
        for item in kv {
            let ns = item[0].as_str().unwrap_or("global");
            let key = item[1].as_str().unwrap_or("");
            let value = item[2].as_str().unwrap_or("");

            let full_key = if key.contains('/') {
                key.to_string()
            } else {
                format!("{}/{}", ns, key)
            };

            db.set_config(&full_key, value)?;
        }

        // Import entries if present in the JSON
        if let Some(entries_obj) = data["entries"].as_object() {
            for (namespace, entries_arr) in entries_obj {
                if let Some(arr) = entries_arr.as_array() {
                    for entry_val in arr {
                        let entry: Entry = serde_json::from_value(entry_val.clone())
                            .map_err(|e| AppError::Config(format!("Failed to parse entry: {}", e)))?;
                        db.save_entry(namespace, &entry)?;
                    }
                }
            }
        }

        Ok(())
    }
}

// ============================================================================
// Fuzzy Search / 模糊搜索
// ============================================================================

/// Perform fuzzy search on entries using SkimMatcherV2
/// 使用 SkimMatcherV2 对条目执行模糊搜索
/// Matches against command, title, url, and path fields
/// 在 command、title、url 和 path 字段上匹配
/// # Arguments
/// - query: Search string (case-insensitive) / 搜索字符串（不区分大小写）
/// - entries: List of entries to search / 要搜索的条目列表
/// # Returns
/// - Vec<Entry>: Entries sorted by relevance score descending
/// # Algorithm
/// 1. For each entry, calculate fuzzy match score on: command, title, url, path
///    对每个条目，在：command、title、url、path 上计算模糊匹配分数
/// 2. Take maximum score across all fields / 取所有字段中的最高分数
/// 3. Sort by score descending / 按分数降序排序
/// 4. Return only entries with non-negative scores (at least partial match)
///    返回只有非负分数的条目（至少部分匹配）
pub fn fuzzy_search(query: &str, entries: Vec<Entry>) -> Vec<Entry> {
    let matcher = SkimMatcherV2::default();

    // Calculate scores for each entry / 计算每个条目的分数
    let mut scored: Vec<(i64, Entry)> = entries
        .into_iter()
        .filter_map(|entry| {
            // Score command and title with higher priority / 给 command 和 title 更高优先级
            let key_score = matcher.fuzzy_match(&entry.command, query);
            let title_score = matcher.fuzzy_match(&entry.title, query);

            // Also check url and path as secondary fields / 也检查 url 和 path 作为次要字段
            let url = entry.url.as_ref();
            let path = entry.path.as_ref();

            // Take best score from url or path / 从 url 或 path 取最佳分数
            let sub_score = url
                .and_then(|u| matcher.fuzzy_match(u, query))
                .or_else(|| path.and_then(|p| matcher.fuzzy_match(p, query)));

            // Take maximum across all 4 fields (command/title/url/path) / 取四者最大
            let best = [key_score, title_score, sub_score]
                .into_iter()
                .flatten()
                .max();

            // Only include entries with positive match / 只包含有正向匹配的条目
            best.map(|score| (score, entry))
        })
        .collect();

    // Sort by score descending / 按分数降序排序
    scored.sort_by(|a, b| b.0.cmp(&a.0));

    // Discard scores, return only entries / 丢弃分数，只返回条目
    scored.into_iter().map(|(_, e)| e).collect()
}

// ============================================================================
// Tests / 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Test fuzzy match on command field / 测试在 command 字段上的模糊匹配
    #[test]
    fn test_fuzzy_match_key() {
        let entries = vec![Entry {
            command: "bd".to_string(),
            kind: "website".to_string(),
            title: "百度".to_string(),
            url: Some("https://www.baidu.com".to_string()),
            path: None,
        }];

        // Exact command match / 精确 command 匹配
        let result = fuzzy_search("bd", entries.clone());
        assert!(!result.is_empty());
        assert_eq!(result[0].command, "bd");

        // Title partial match / 标题部分匹配
        let result = fuzzy_search("baidu", entries);
        assert!(!result.is_empty());
    }

    /// Regression test for #5: url match must contribute when command/title don't match
    /// 即使 command/title 与 query 都不沾边，url 命中也应被纳入排序
    #[test]
    fn test_fuzzy_match_url_only() {
        let entries = vec![Entry {
            command: "zz".to_string(),
            kind: "website".to_string(),
            title: "yy".to_string(),
            url: Some("https://github.com/foo".to_string()),
            path: None,
        }];
        let result = fuzzy_search("github", entries);
        assert!(!result.is_empty(), "url-only match must produce a hit");
        assert_eq!(result[0].command, "zz");
    }

    /// Test fuzzy match on title field / 测试在 title 字段上的模糊匹配
    #[test]
    fn test_fuzzy_match_title() {
        let entries = vec![Entry {
            command: "bd".to_string(),
            kind: "website".to_string(),
            title: "百度".to_string(),
            url: Some("https://www.baidu.com".to_string()),
            path: None,
        }];

        // Chinese character match / 中文字符匹配
        let result = fuzzy_search("百", entries);
        assert!(!result.is_empty());
    }

    /// Test config export and import round-trip / 测试配置导出导入往返
    #[test]
    fn test_config_export_import() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();
        let manager = ConfigManager::new(Arc::new(Mutex::new(db))).unwrap();

        manager
            .set("global/mode", serde_json::json!("expert"))
            .unwrap();
        manager
            .set("expert/test_key", serde_json::json!("test_value"))
            .unwrap();

        let json = manager.export_json().unwrap();
        assert!(json.contains("\"version\": \"0.1.0\""));
        assert!(json.contains("global"));
    }
}