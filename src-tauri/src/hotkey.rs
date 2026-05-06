use tauri_plugin_global_shortcut::Shortcut;
#[cfg(test)]
use std::sync::Arc;
#[cfg(test)]
use parking_lot::Mutex;

pub trait HotkeyProvider {
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String>;
    fn is_registered(&self, shortcut: Shortcut) -> bool;
}

#[cfg(test)]
pub struct MockHotkeyProvider {
    pub registered: Arc<Mutex<Vec<Shortcut>>>,
    pub should_fail: bool,
}

#[cfg(test)]
impl MockHotkeyProvider {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    use crate::register_hotkey_logic;

    #[test]
    fn test_hotkey_registration_success() {
        let provider = MockHotkeyProvider::new(false);
        let current_state = Arc::new(Mutex::new(None));
        
        let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
        
        let result = register_hotkey_logic(&provider, shortcut.clone(), &current_state);
        assert!(result.is_ok());
        
        let current = current_state.lock();
        assert_eq!(*current, Some(shortcut.clone()));
        
        let registered = provider.registered.lock();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0], shortcut);
    }

    #[test]
    fn test_hotkey_registration_conflict_rollback() {
        let provider = MockHotkeyProvider::new(true); // will fail
        let old_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
        let current_state = Arc::new(Mutex::new(Some(old_shortcut.clone())));
        
        let new_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
        
        let result = register_hotkey_logic(&provider, new_shortcut, &current_state);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Conflict detected");
        
        // state should not change
        let current = current_state.lock();
        assert_eq!(*current, Some(old_shortcut));
    }

    #[test]
    fn test_hotkey_registration_removes_old() {
        let provider = MockHotkeyProvider::new(false);
        let old_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
        provider.registered.lock().push(old_shortcut.clone());
        
        let current_state = Arc::new(Mutex::new(Some(old_shortcut.clone())));
        let new_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
        
        let result = register_hotkey_logic(&provider, new_shortcut.clone(), &current_state);
        assert!(result.is_ok());
        
        let current = current_state.lock();
        assert_eq!(*current, Some(new_shortcut.clone()));
        
        let registered = provider.registered.lock();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0], new_shortcut);
        assert!(!registered.contains(&old_shortcut));
    }
}