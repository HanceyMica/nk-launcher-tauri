//! Application entry point / 应用程序入口点
//! Prevents additional console window on Windows in release builds
//! 在 Windows release 构建中隐藏额外的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Main entry point - delegates to app_lib::run()
/// 主入口点 - 委托给 app_lib::run()
fn main() {
    app_lib::run();
}
