use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub command: String,
    pub kind: String,
    pub title: String,
    pub url: Option<String>,
    pub path: Option<String>,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
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
        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;
        Ok(Self { conn })
    }

    pub fn get_entries(&self, namespace: &str) -> Result<Vec<Entry>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT command, kind, title, url, path FROM entries WHERE namespace = ?1",
        )?;
        let entries = stmt
            .query_map([namespace], |row| {
                Ok(Entry {
                    command: row.get(0)?,
                    kind: row.get(1)?,
                    title: row.get(2)?,
                    url: row.get(3)?,
                    path: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

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

    pub fn delete_entry(&mut self, namespace: &str, command: &str) -> Result<(), AppError> {
        self.conn.execute(
            "DELETE FROM entries WHERE namespace = ?1 AND command = ?2",
            params![namespace, command],
        )?;
        Ok(())
    }

    pub fn get_config(&self, key: &str) -> Result<Option<String>, AppError> {
        let mut stmt = self.conn.prepare("SELECT value FROM config WHERE key = ?1")?;
        let result = stmt.query_row([key], |row| row.get(0)).ok();
        Ok(result)
    }

    pub fn set_config(&mut self, key: &str, value: &str) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_config(&self) -> Result<Vec<(String, String)>, AppError> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM config")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn clear_namespace(&mut self, namespace: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM entries WHERE namespace = ?1", [namespace])?;
        Ok(())
    }
}

impl Clone for Database {
    fn clone(&self) -> Self {
        Self {
            conn: Connection::open_with_flags(
                self.conn.path().unwrap(),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
            ).expect("Failed to reopen database"),
        }
    }
}