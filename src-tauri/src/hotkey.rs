//! Hotkey provider trait and mock implementation
//! 热键提供者 trait 和 mock 实现
//! Abstracts global shortcut registration for testability
//! 抽象全局快捷键注册以支持测试

#[cfg(test)]
use parking_lot::Mutex;
#[cfg(test)]
use std::sync::Arc;
use tauri_plugin_global_shortcut::Shortcut;

// ============================================================================
// HotkeyProvider Trait / HotkeyProvider Trait
// ============================================================================

/// Abstract interface for global shortcut registration
/// 全局快捷键注册的抽象接口
/// # Purpose
/// - Allows AppHandle (production) and MockHotkeyProvider (testing) to use same logic
/// - 使 AppHandle（生产）和 MockHotkeyProvider（测试）可以使用相同的逻辑
/// # Invariant
/// - register() and unregister() must be called in pairs; always unregister old before registering new
/// - register() 和 unregister() 必须成对调用；在注册新的之前总是注销旧的
pub trait HotkeyProvider {
    /// Register a global shortcut / 注册全局快捷键
    /// # Arguments
    /// - shortcut: Shortcut to register / 要注册的快捷键
    /// # Returns
    /// - Result<(), String>: Error if registration fails (e.g., conflict)
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;

    /// Unregister a global shortcut / 注销全局快捷键
    /// # Arguments
    /// - shortcut: Shortcut to unregister / 要注销的快捷键
    /// # Returns
    /// - Result<(), String>: Error if shortcut not registered
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String>;

    /// Check if a shortcut is currently registered
    /// 检查快捷键是否已注册
    /// # Arguments
    /// - shortcut: Shortcut to check / 要检查的快捷键
    /// # Returns
    /// - true if registered, false otherwise
    fn is_registered(&self, shortcut: Shortcut) -> bool;
}

// ============================================================================
// Mock Implementation for Tests / 用于测试的 Mock 实现
// ============================================================================

/// Mock HotkeyProvider for unit testing / 用于单元测试的 Mock HotkeyProvider
/// Tracks registered shortcuts in memory / 在内存中跟踪已注册的快捷键
#[cfg(test)]
pub struct MockHotkeyProvider {
    /// Registered shortcuts / 已注册的快捷键
    pub registered: Arc<Mutex<Vec<Shortcut>>>,
    /// If true, register() always fails (for conflict testing)
    /// 如果为 true，register() 总是失败（用于冲突测试）
    pub should_fail: bool,
}

#[cfg(test)]
impl MockHotkeyProvider {
    /// Create new MockHotkeyProvider / 创建新的 MockHotkeyProvider
    /// # Arguments
    /// - should_fail: If true, all register() calls fail / 如果为 true，所有 register() 调用失败
    pub fn new(should_fail: bool) -> Self {
        Self {
            registered: Arc::new(Mutex::new(Vec::new())),
            should_fail,
        }
    }
}

#[cfg(test)]
impl HotkeyProvider for MockHotkeyProvider {
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        if self.should_fail {
            return Err("Conflict detected".to_string());
        }
        let mut list = self.registered.lock();
        if list.contains(&shortcut) {
            return Err("Already registered".to_string());
        }
        list.push(shortcut);
        Ok(())
    }

    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
        let mut list = self.registered.lock();
        if let Some(pos) = list.iter().position(|x| *x == shortcut) {
            list.remove(pos);
            Ok(())
        } else {
            Err("Not registered".to_string())
        }
    }

    fn is_registered(&self, shortcut: Shortcut) -> bool {
        self.registered.lock().contains(&shortcut)
    }
}

// ============================================================================
// Tests / 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::register_hotkey_logic;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    /// Test successful hotkey registration / 测试成功的热键注册
    #[test]
    fn test_hotkey_registration_success() {
        let provider = MockHotkeyProvider::new(false);
        let current_state = Arc::new(Mutex::new(None));

        let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);

        let result = register_hotkey_logic(&provider, shortcut.clone(), &current_state);
        assert!(result.is_ok());

        // Verify state updated / 验证状态已更新
        let current = current_state.lock();
        assert_eq!(*current, Some(shortcut.clone()));

        // Verify provider called / 验证提供者已调用
        let registered = provider.registered.lock();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0], shortcut);
    }

    /// Test registration failure rolls back state / 测试注册失败时状态回滚
    #[test]
    fn test_hotkey_registration_conflict_rollback() {
        let provider = MockHotkeyProvider::new(true); // will fail / 会失败
        let old_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
        let current_state = Arc::new(Mutex::new(Some(old_shortcut.clone())));

        let new_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);

        let result = register_hotkey_logic(&provider, new_shortcut, &current_state);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Conflict detected");

        // State should not change / 状态不应改变
        let current = current_state.lock();
        assert_eq!(*current, Some(old_shortcut));
    }

    /// Test old shortcut is unregistered when replacing / 测试替换时注销旧的快捷键
    #[test]
    fn test_hotkey_registration_removes_old() {
        let provider = MockHotkeyProvider::new(false);
        let old_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
        provider.registered.lock().push(old_shortcut.clone());

        let current_state = Arc::new(Mutex::new(Some(old_shortcut.clone())));
        let new_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);

        let result = register_hotkey_logic(&provider, new_shortcut.clone(), &current_state);
        assert!(result.is_ok());

        // New shortcut in state / 新快捷键在状态中
        let current = current_state.lock();
        assert_eq!(*current, Some(new_shortcut.clone()));

        // Only new shortcut registered / 只有新快捷键注册
        let registered = provider.registered.lock();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0], new_shortcut);
        assert!(!registered.contains(&old_shortcut));
    }
}