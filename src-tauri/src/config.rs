//! Configuration management module / 配置管理模块
//! Provides JSON-based config storage with SQLite backend and fuzzy search
//! 提供基于 JSON 的配置存储，带 SQLite 后端和模糊搜索

use crate::db::{Database, Entry};
use crate::error::AppError;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::{Deserialize, Serialize};

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
}

// ============================================================================
// ConfigManager / 配置管理器
// ============================================================================

/// Configuration manager with JSON serialization and SQLite storage
/// 带 JSON 序列化和 SQLite 存储的配置管理器
/// Manages key-value config pairs organized by namespace (e.g., "global/theme")
/// 管理按命名空间组织的键值配置对（如 "global/theme"）
pub struct ConfigManager {
    db: Database,
}

impl ConfigManager {
    /// Create new ConfigManager and initialize default values
    /// 创建新的配置管理器并初始化默认值
    /// # Arguments
    /// - db: Database instance for config storage / 用于配置存储的数据库实例
    /// # Returns
    /// - Result<Self, AppError>: ConfigManager or error on failure
    /// # Side Effects
    /// - Sets default values for: mode, theme, language, has_launched
    /// - 为：mode、theme、language、has_launched 设置默认值
    pub fn new(db: Database) -> Result<Self, AppError> {
        let mut manager = Self { db };
        manager.init_defaults()?;
        Ok(manager)
    }

    /// Initialize default values if not present / 如果不存在则初始化默认值
    /// Only sets value if key doesn't exist / 仅在键不存在时设置值
    /// This preserves user settings on restarts / 这可以在重启时保留用户设置
    fn init_defaults(&mut self) -> Result<(), AppError> {
        if self.get_str("global/mode").is_err() {
            self.set("global/mode", serde_json::json!("expert"))?;
        }
        if self.get_str("global/theme").is_err() {
            self.set("global/theme", serde_json::json!("system"))?;
        }
        if self.get_str("global/language").is_err() {
            self.set("global/language", serde_json::json!("zh"))?;
        }
        if self.get_str("global/shortcut").is_err() {
            self.set("global/shortcut", serde_json::json!("Alt+Space"))?;
        }
        Ok(())
    }

    /// Get a config value by key / 根据键获取配置值
    /// # Arguments
    /// - key: Config key (e.g., "global/theme") / 配置键（如 "global/theme"）
    /// # Returns
    /// - Result<serde_json::Value, AppError>: JSON value or error
    /// # Errors
    /// - AppError::Config if key not found or JSON parse fails
    pub fn get(&self, key: &str) -> Result<serde_json::Value, AppError> {
        self.db
            .get_config(key)
            .and_then(|v| v.ok_or_else(|| AppError::Config(format!("Key not found: {}", key))))
            .and_then(|v| {
                serde_json::from_str(&v)
                    .map_err(|e| AppError::Config(format!("Failed to parse config value: {}", e)))
            })
    }

    /// Get a config value as String / 获取配置值为字符串
    /// # Arguments
    /// - key: Config key / 配置键
    /// # Returns
    /// - Result<String, AppError>: String value or error
    /// # Errors
    /// - AppError::Config if value is not a string
    pub fn get_str(&self, key: &str) -> Result<String, AppError> {
        self.get(key).and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| serde_json::Value::as_str(&v).map(|s| s.to_string()))
                .ok_or_else(|| AppError::Config(format!("Value is not a string: {}", v)))
        })
    }

    /// Set a config value / 设置配置值
    /// # Arguments
    /// - key: Config key / 配置键
    /// - value: JSON value to store / 要存储的 JSON 值
    /// # Side Effects
    /// - Overwrites existing value if key exists / 如果键存在则覆盖现有值
    pub fn set(&mut self, key: &str, value: serde_json::Value) -> Result<(), AppError> {
        let s = serde_json::to_string(&value)
            .map_err(|e| AppError::Config(format!("Failed to serialize value: {}", e)))?;
        self.db.set_config(key, &s)
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
        })
    }

    /// Export all config as JSON string / 将所有配置导出为 JSON 字符串
    /// # Arguments
    /// - db: Database reference for reading all config / 用于读取所有配置的数据库引用
    /// # Returns
    /// - Result<String, AppError>: JSON string in format:
    ///   ```json
    ///   {
    ///     "version": "0.1.0",
    ///     "kv": [["namespace", "key", "value"], ...]
    ///   }
    ///   ```
    /// # Algorithm
    /// 1. Read all (key, value) pairs from config table / 从 config 表读取所有 (键, 值) 对
    /// 2. Parse each key as "namespace/key" or just "key" with "global" namespace
    ///    将每个键解析为 "namespace/key" 或仅 "key" 并使用 "global" 命名空间
    /// 3. Build array of [namespace, key, value] triplets / 构建 [namespace, key, value] 三元组数组
    pub fn export_json(&self, db: &Database) -> Result<String, AppError> {
        let all_config = db.get_all_config()?;
        let kv: Vec<[String; 3]> = all_config
            .into_iter()
            .map(|(k, v)| {
                // Split key by first '/' to get namespace and key name
                // 按第一个 '/' 分割键以获取命名空间和键名
                let parts: Vec<&str> = k.splitn(2, '/').collect();
                let ns = parts.get(0).unwrap_or(&"global");
                let key_str = k.as_str();
                // If there's a second part, use it as key; otherwise use full key
                // 如果有第二部分，用它作为键；否则使用完整键
                let key = parts
                    .get(1)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| key_str.to_string());
                [ns.to_string(), key, v]
            })
            .collect();

        let export = serde_json::json!({
            "version": "0.1.0",
            "kv": kv
        });

        serde_json::to_string_pretty(&export)
            .map_err(|e| AppError::Config(format!("Failed to export: {}", e)))
    }

    /// Import config from JSON string / 从 JSON 字符串导入配置
    /// # Arguments
    /// - db: Database reference for writing config / 用于写入配置的数据库引用
    /// - json: JSON string from export_json / export_json 导出的 JSON 字符串
    /// # Side Effects
    /// - Overwrites existing config with INSERT OR REPLACE / 用 INSERT OR REPLACE 覆盖现有配置
    /// # Errors
    /// - AppError::Config if JSON invalid or missing "kv" field
    pub fn import_json(&mut self, db: &mut Database, json: &str) -> Result<(), AppError> {
        let data: serde_json::Value = serde_json::from_str(json)
            .map_err(|e| AppError::Config(format!("Invalid JSON: {}", e)))?;

        let kv = data["kv"]
            .as_array()
            .ok_or_else(|| AppError::Config("Missing 'kv' field".to_string()))?;

        for item in kv {
            // Extract namespace, key, value from each array element
            // 从每个数组元素提取命名空间、键、值
            let ns = item[0].as_str().unwrap_or("global");
            let key = item[1].as_str().unwrap_or("");
            let value = item[2].as_str().unwrap_or("");

            // Reconstruct full key: "namespace/key" if key contains '/', otherwise "namespace/key"
            // 重建完整键：如果键包含 '/' 则为 "namespace/key"，否则为 "namespace/key"
            let full_key = if key.contains('/') {
                key.to_string()
            } else {
                format!("{}/{}", ns, key)
            };

            db.set_config(&full_key, value)?;
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

            // Take maximum of all scores / 取所有分数的最大值
            let best = key_score.max(title_score).or(sub_score);

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
        let mut manager = ConfigManager::new(db).unwrap();

        manager
            .set("global/mode", serde_json::json!("expert"))
            .unwrap();
        manager
            .set("expert/test_key", serde_json::json!("test_value"))
            .unwrap();

        let json = manager.export_json(&manager.db).unwrap();
        assert!(json.contains("\"version\": \"0.1.0\""));
        assert!(json.contains("global"));
    }
}