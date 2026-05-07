# 前后端耦合度审计报告

> 生成时间：2026-05-08
> 审计范围：Rust 后端（`src-tauri/src/`）+ TypeScript 前端（`src/`）+ HTML 模板

---

## 一、发现的问题汇总

| # | 严重程度 | 分类 | 问题描述 | 涉及文件 |
|---|---------|------|---------|---------|
| 1 | 🔴 CRITICAL | invoke 类型错误 | `initI18n` 用 `invoke<string>` 调 `get_config`，但后端返回结构化 `AppConfig` 对象非 JSON 字符串，`JSON.parse(config)` 必定抛错 | `src/i18n/index.ts:L386` |
| 2 | 🟠 HIGH | 事件未消费 | 后端 `emit("hotkey-register-failed", ...)` 已发送，但前端没有任何 `listen("hotkey-register-failed")`，快捷键注册失败时用户无感知 | `src-tauri/src/lib.rs:L291` ↔ `src/index.ts` |
| 3 | 🟡 MEDIUM | 废弃状态字段 | `AppState.previous_foreground_window` 字段已无代码读取（Win32 前景窗口逻辑已移除），但未从 struct 和初始化中删除 | `src-tauri/src/lib.rs:L38, L1062` |
| 4 | 🟡 MEDIUM | i18n 键 `mode` 与 `setting` 冲突 | `t("mode")` 会匹配到 `mode: "模式"` 但 HTML 中 `data-i18n="mode"` 期望的是「模式选择标签」。当前字典中 `mode` 键值正确，但需确认无歧义 | `src/i18n/index.ts` ↔ `index.html` |
| 5 | 🟢 LOW | 孤立后端命令 | 4 个 Tauri command 前端从不调用：`get_mode`, `show_window`, `show_settings`, `get_hotkey_status` | `src-tauri/src/lib.rs` |
| 6 | 🟢 LOW | Cargo 未用依赖 | `windows` crate 已无代码使用（Win32 前景窗口代码已移除），可删除减小编译体积 | `src-tauri/Cargo.toml` |

---

## 二、详细分析

### 🔴 问题 1：i18n 初始化 `invoke` 类型错误

**位置**：[src/i18n/index.ts:L386](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src/i18n/index.ts#L386)

```typescript
const config = await import("@tauri-apps/api/core")
  .then(m => m.invoke<string>("get_config").catch(() => null));
if (config) {
  const parsed = JSON.parse(config);       // ❌ config 已经是对象，不是字符串
  currentLang = parsed.language || "zh";
```

**后端实际返回**：[src-tauri/src/lib.rs:L303-L316](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L303-L316)

```rust
async fn get_config(state: State<'_, AppState>) -> Result<config::AppConfig, String>
```

`AppConfig` 通过 Serde 序列化为 JSON 对象（如 `{version: "0.1.0", mode: "expert", ...}`），Tauri IPC 层将其反序列化后传给前端，前端收到的已经是 JavaScript 对象，不是字符串。

**影响**：`JSON.parse(config)` 在 `config` 已经是对象时抛 `TypeError`，导致 `initI18n()` 失败，语言回退为默认 `"zh"`。如果用户在 Welcome 页选了其他语言，重启后会丢失设置。

**修复方向**：
```typescript
const config = await import("@tauri-apps/api/core")
  .then(m => m.invoke<{ language: string }>("get_config").catch(() => null));
if (config) {
  currentLang = (config as any).language || "zh";
```

---

### 🟠 问题 2：热键注册失败事件无人监听

**后端发送**：[src-tauri/src/lib.rs:L291](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L291)

```rust
let _ = app.emit("hotkey-register-failed", shortcut_str.clone());
```

**前端**：`src/index.ts` 中没有任何 `listen("hotkey-register-failed", ...)` 调用。

**影响**：当 Alt+Space 被其他程序占用时，后端注册失败后发送此事件，但被静默丢失，用户不会收到任何提示。

---

### 🟡 问题 3：`AppState.previous_foreground_window` 死字段

**位置**：
- 定义：[src-tauri/src/lib.rs:L38](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L38)
- 初始化：[src-tauri/src/lib.rs:L1062](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L1062)

```rust
pub previous_foreground_window: Arc<Mutex<Option<isize>>>,
// ...
previous_foreground_window: Arc::new(Mutex::new(None)),
```

Win32 `GetForegroundWindow`/`SetForegroundWindow` 代码已从 `toggle_window_visibility` 中移除（替换为 `window_visible: Arc<Mutex<bool>>` 自追踪方案），但此字段仍在 struct 和初始化中保留。

**影响**：无运行时影响，仅增加代码混乱。

---

### 🟡 问题 4：i18n 键核对结果

**结论：所有 i18n 键均已存在。**

| 字典 | 键总数 | HTML data-i18n 键数 | TS t() 键数 | 去重唯一键 | 缺失 |
|------|-------|-------------------|-------------|-----------|------|
| `zh` | 110 | 69 | 35 | ~85 | **0** |
| `en` | 110 | — | — | — | **0** |
| `ja` | 110 | — | — | — | **0** |

> **所有三语字典键完全对齐，无遗漏。**

---

## 三、完整 invoke ↔ command 对照

| 前端 invoke 命令 | 后端 #[tauri::command] | 参数匹配 | 返回类型匹配 |
|:--|:--|:--|:--|
| `resize_window` | `resize_window` | ✅ | ✅ |
| `save_config` | `save_config` | ✅ | ✅ |
| `get_config` | `get_config` | ✅ | ✅ |
| `get_entries` | `get_entries` | ✅ | ✅ |
| `fuzzy_search` | `fuzzy_search` | ✅ | ✅ |
| `export_config` | `export_config` | ✅ | ✅ |
| `hide_window` | `hide_window` | ✅ | ✅ |
| `open_url` | `open_url` | ✅ (`url`, `browserId`→`browser_id`) | ✅ |
| `open_app` | `open_app` | ✅ | ✅ |
| `delete_entry` | `delete_entry` | ✅ | ✅ |
| `save_entry` | `save_entry` | ✅ | ✅ |
| `set_mode` | `set_mode` | ✅ | ✅ |
| `get_has_launched` | `get_has_launched` | ✅ | ✅ |
| `list_browsers` | `list_browsers` | ✅ | ✅ |
| `add_custom_browser` | `add_custom_browser` | ✅ | ✅ |
| `import_config` | `import_config` | ✅ | ✅ |
| `check_hotkey_conflict`| `check_hotkey_conflict` | ✅ | ✅ |
| `register_hotkey` | `register_hotkey` | ✅ | ✅ |
| `mark_launched` | `mark_launched` | ✅ | ✅ |
| `unmark_launched` | `unmark_launched` | ✅ | ✅ |
| `update_tray_menu` | `update_tray_menu` | ✅ | ✅ |

> 所有 21 个前端 invoke 命令均有匹配的后端 command。Tauri 自动处理 camelCase↔snake_case 转换。**invoke 与 command 层面无缺失。**

---

## 四、完整 AppConfig 字段对照

| 前端 TypeScript 字段 | 后端 Rust 字段 | 匹配 |
|:--|:--|:--|
| `version: string` | `version: String` | ✅ |
| `mode: string` | `mode: String` | ✅ |
| `theme: string` | `theme: String` | ✅ |
| `language: string` | `language: String` | ✅ |
| `default_browser?: string` | `default_browser: Option<String>` | ✅ |
| `shortcut?: string` | `shortcut: Option<String>` | ✅ |
| `bg_image?: string` | `bg_image: Option<String>` | ✅ |
| `bg_blur?: number` | `bg_blur: Option<i64>` | ✅ (JSON 序列化自动转换) |
| `bg_opacity?: number` | `bg_opacity: Option<i64>` | ✅ |
| `search_opacity?: number` | `search_opacity: Option<i64>` | ✅ |
| `search_width?: number` | `search_width: Option<f64>` | ✅ |
| `simple_bg_enabled?: boolean` | `simple_bg_enabled: Option<bool>` | ✅ |

> **AppConfig 字段现已完全对齐。**

---

## 五、事件 emit ↔ listen 对照

| 事件名 | 后端 emit | 前端 listen | 状态 |
|:--|:--|:--|:--|
| `show-settings` | `setup_tray` → `window.emit(...)` | `init()` → `listen(...)` | ✅ |
| `hotkey-register-failed` | `setup_global_shortcut` → `app.emit(...)` | **缺失** | ❌ |

---

## 六、修复建议优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | i18n `initI18n` invoke 类型错误 | 改为 `invoke<{language: string}>`，去掉 `JSON.parse` |
| P1 | `hotkey-register-failed` 无人监听 | 在 `init()` 中添加 `listen("hotkey-register-failed")` |
| P2 | `previous_foreground_window` 死字段 | 从 `AppState` 和初始化中移除 |
| P2 | 冗余 `windows` crate 依赖 | 从 `Cargo.toml` 移除 |
| P3 | 孤立后端命令 | 可选清理，建议保留以备用 |
