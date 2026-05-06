use crate::db::{Database, Entry};
use crate::error::AppError;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub mode: String,
    pub theme: String,
    pub language: String,
    pub default_browser: Option<String>,
}

pub struct ConfigManager {
    db: Database,
}

impl ConfigManager {
    pub fn new(db: Database) -> Result<Self, AppError> {
        let mut manager = Self { db };
        manager.init_defaults()?;
        Ok(manager)
    }

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
        if self.get_str("global/has_launched").is_err() {
            self.set("global/has_launched", serde_json::json!(false))?;
        }
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<serde_json::Value, AppError> {
        self.db
            .get_config(key)
            .and_then(|v| v.ok_or_else(|| AppError::Config(format!("Key not found: {}", key))))
            .and_then(|v| {
                serde_json::from_str(&v)
                    .map_err(|e| AppError::Config(format!("Failed to parse config value: {}", e)))
            })
    }

    pub fn get_str(&self, key: &str) -> Result<String, AppError> {
        self.get(key).and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| serde_json::Value::as_str(&v).map(|s| s.to_string()))
                .ok_or_else(|| AppError::Config(format!("Value is not a string: {}", v)))
        })
    }

    pub fn set(&mut self, key: &str, value: serde_json::Value) -> Result<(), AppError> {
        let s = serde_json::to_string(&value)
            .map_err(|e| AppError::Config(format!("Failed to serialize value: {}", e)))?;
        self.db.set_config(key, &s)
    }

    pub fn get_all(&self) -> Result<AppConfig, AppError> {
        Ok(AppConfig {
            version: self.get_str("global/version").unwrap_or_else(|_| "0.1.0".to_string()),
            mode: self.get_str("global/mode").unwrap_or_else(|_| "expert".to_string()),
            theme: self.get_str("global/theme").unwrap_or_else(|_| "system".to_string()),
            language: self.get_str("global/language").unwrap_or_else(|_| "zh".to_string()),
            default_browser: self.get_str("global/default_browser").ok(),
        })
    }

    pub fn export_json(&self, db: &Database) -> Result<String, AppError> {
        let all_config = db.get_all_config()?;
        let kv: Vec<[String; 3]> = all_config
            .into_iter()
            .map(|(k, v)| {
                let parts: Vec<&str> = k.splitn(2, '/').collect();
                let ns = parts.get(0).unwrap_or(&"global");
                let key_str = k.as_str();
                let key = parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| key_str.to_string());
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

    pub fn import_json(&mut self, db: &mut Database, json: &str) -> Result<(), AppError> {
        let data: serde_json::Value = serde_json::from_str(json)
            .map_err(|e| AppError::Config(format!("Invalid JSON: {}", e)))?;

        let kv = data["kv"]
            .as_array()
            .ok_or_else(|| AppError::Config("Missing 'kv' field".to_string()))?;

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

        Ok(())
    }
}

pub fn fuzzy_search(query: &str, entries: Vec<Entry>) -> Vec<Entry> {
    let matcher = SkimMatcherV2::default();

    let mut scored: Vec<(i64, Entry)> = entries
        .into_iter()
        .filter_map(|entry| {
            let key_score = matcher.fuzzy_match(&entry.command, query);
            let title_score = matcher.fuzzy_match(&entry.title, query);

            let url = entry.url.as_ref();
            let path = entry.path.as_ref();

            let sub_score = url.and_then(|u| matcher.fuzzy_match(u, query))
                .or_else(|| path.and_then(|p| matcher.fuzzy_match(p, query)));

            let best = key_score
                .max(title_score)
                .or(sub_score);

            best.map(|score| (score, entry))
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().map(|(_, e)| e).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzzy_match_key() {
        let entries = vec![
            Entry {
                command: "bd".to_string(),
                kind: "website".to_string(),
                title: "百度".to_string(),
                url: Some("https://www.baidu.com".to_string()),
                path: None,
            },
        ];

        let result = fuzzy_search("bd", entries.clone());
        assert!(!result.is_empty());
        assert_eq!(result[0].command, "bd");

        let result = fuzzy_search("baidu", entries);
        assert!(!result.is_empty());
    }

    #[test]
    fn test_fuzzy_match_title() {
        let entries = vec![
            Entry {
                command: "bd".to_string(),
                kind: "website".to_string(),
                title: "百度".to_string(),
                url: Some("https://www.baidu.com".to_string()),
                path: None,
            },
        ];

        let result = fuzzy_search("百", entries);
        assert!(!result.is_empty());
    }

    #[test]
    fn test_config_export_import() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();
        let mut manager = ConfigManager::new(db).unwrap();

        manager.set("global/mode", serde_json::json!("expert")).unwrap();
        manager.set("expert/test_key", serde_json::json!("test_value")).unwrap();

        let json = manager.export_json(&manager.db).unwrap();
        assert!(json.contains("\"version\": \"0.1.0\""));
        assert!(json.contains("global"));
    }
}