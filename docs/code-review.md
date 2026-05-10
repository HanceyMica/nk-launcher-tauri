# 代码审查报告

> 审查时间：2026-05-08
> 审查范围：`src-tauri/src/*.rs`、`src/index.ts`、`src/i18n/index.ts`、`index.html`
> 既有审计：[frontend-backend-audit.md](./frontend-backend-audit.md)（其中 P0/P1 问题已修复，本报告补充新发现）

---

## 一、问题汇总

| # | 严重 | 分类 | 位置 | 摘要 |
|---|------|------|------|------|
| 1 | 🔴 CRITICAL | 后端逻辑 | `src-tauri/src/lib.rs:485-543` | `open_url` 完全忽略 `browser_id` 参数，两个分支行为完全相同 |
| 2 | 🔴 CRITICAL | 数据完整性 | `src-tauri/src/db.rs:202-212` + `lib.rs:1045-1056` | `Database::clone()` 创建第二个 SQLite 连接，`AppState.db` 与 `ConfigManager.db` 并发写同一文件，`import_config` 同时锁两者会触发 SQLITE_BUSY |
| 3 | 🟠 HIGH | XSS / 注入 | `src/index.ts:782, 854-858, 970-985, 1160-1175` | `innerHTML` 直接拼接用户输入（`title`/`url`/`path`），导入恶意 JSON 配置可执行任意 JS（Tauri 上下文中风险更高） |
| 4 | 🟠 HIGH | 异步竞争 | `src/index.ts:497-552` | 输入框 `input` 处理器无序列号/取消机制，快速输入时旧请求结果可覆盖新请求 |
| 5 | 🟠 HIGH | 模糊搜索逻辑 | `src-tauri/src/config.rs:285` | `key_score.max(title_score).or(sub_score)` — 当 key/title 任一匹配时完全忽略 url/path 分数，与"取四者最大"的注释意图不符 |
| 6 | 🟠 HIGH | 监听器泄漏 | `src/index.ts:1019-1026` | `updateVisibility` 闭包每次重建，`removeEventListener` 移除的不是先前添加的引用 → 监听器累积 |
| 7 | 🟡 MEDIUM | i18n | `src/index.ts:518, 846, 855, 885, 1000, 1379` | 多处硬编码中文（"未设置"/"跳转到"/"打开"/"编辑格子"/警告文案），英/日模式下显示中文 |
| 8 | 🟡 MEDIUM | 性能 | `src/index.ts` 多处 | 每次渲染、每次输入、每次模式切换都调 `resize_window`，无防抖 → 窗口闪烁 |
| 9 | 🟡 MEDIUM | 健壮性 | `src-tauri/src/config.rs:71-83` | `init_defaults` 用 `is_err()` 判断"键缺失"，但解析错误也会触发，导致默认值悄悄覆盖损坏的用户数据 |
| 10 | 🟡 MEDIUM | 性能 | `src-tauri/src/browser.rs:177-187` | 每次 `open_url` 都重新枚举注册表浏览器列表，无缓存 |
| 11 | 🟡 MEDIUM | 后端逻辑 | `src-tauri/src/lib.rs:485-510` | 添加自定义浏览器后，前端选 `browsers[length-1]` 作为默认（`index.ts:1490`），依赖合并顺序，不可靠 |
| 12 | 🟢 LOW | 一致性 | `src-tauri/src/lib.rs:553` vs `browser.rs:217` | `open_app` 未使用 `DETACHED_PROCESS`，与 `open_url_with_browser` 行为不一致（启动器退出可能影响子进程） |
| 13 | 🟢 LOW | 路径 | `src-tauri/src/lib.rs:49-52` | `LOCALAPPDATA` 缺失时静默回退到 `"."`，应使用 Tauri 的 `app_data_dir()` 或返回错误 |
| 14 | 🟢 LOW | 注释错误 | `src-tauri/src/lib.rs:33, 498` | `current_hotkey` 中文注释写成"全量的快捷键"；`format!("global/default_browser")` 是无意义的 format 调用 |
| 15 | 🟢 LOW | 死代码 | `src-tauri/src/lib.rs:49` | `_app` 参数从未使用，可去除整个参数 |

---

## 二、详细分析与修复

### 🔴 #1 `open_url` 忽略 `browser_id`

**位置**：[src-tauri/src/lib.rs:485-510](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L485)

```rust
let browser_cmd = if let Some(_bid) = browser_id {
    // 分支 A：忽略 _bid，读 global/default_browser
    state.config.lock().get_str(&format!("global/default_browser")).ok()...
} else {
    // 分支 B：读 global/default_browser
    state.config.lock().get_str("global/default_browser").ok()...
};
```

两个分支语义完全一致，`browser_id` 参数被丢弃。前端目前总是传 `browserId: null`（[src/index.ts:740](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src/index.ts#L740)），所以表面无影响——但若未来想做"per-entry 指定浏览器"则不工作。

**修复**：分支 A 应使用 `Some(_bid)` 而非读全局配置：
```rust
let browser_cmd = browser_id.or_else(|| {
    state.config.lock().get_str("global/default_browser").ok()
        .filter(|s| !s.is_empty())
});
```

---

### 🔴 #2 双 SQLite 连接竞争

**位置**：
- [src-tauri/src/db.rs:202-212](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/db.rs#L202)：`impl Clone for Database` 打开第二个连接到同一文件
- [src-tauri/src/lib.rs:1045-1056](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L1045)：`config::ConfigManager::new(db.clone())`，随后 `db` 也存入 `AppState`

结果：进程内有两条独立 SQLite 连接，分别由 `state.db` 与 `state.config.db` 持有。`parking_lot::Mutex` 仅保护各自的连接，不能跨连接同步。

**典型故障**：[`import_config`](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/lib.rs#L879)：

```rust
let mut config = state.config.lock();   // 锁连接 A
let mut db = state.db.lock();           // 锁连接 B
config.import_json(&mut db, &json)      // 同时使用两条连接写
```

SQLite 的文件锁会让两个连接的写互相阻塞，触发 `SQLITE_BUSY`（默认无 busy_timeout）。

**修复方向**：让 `ConfigManager` 不拥有连接，而是接受 `&mut Database`；或将 SQLite 连接设为 `Arc<Mutex<Connection>>` 单实例共享。

---

### 🟠 #3 XSS / 模板注入

**位置**：所有 `innerHTML = ...` 拼接用户字段处。例：

```ts
// src/index.ts:780-784
return `<div class="result-item ..." data-index="${i}">
  ${icon} ${entry.title}<span class="desc">${desc}</span></div>`;
```

`entry.title`、`entry.url`、`entry.path` 来自 SQLite，但用户可通过 `import_config` 导入任意 JSON。一个 `title = "<img src=x onerror=alert(1)>"` 可执行任意脚本。在 Tauri 中，前端拥有 `invoke` 权限 → 等同 RCE。

**修复**：用 `textContent`/DOM API 构造，或封装 `escapeHtml(s)`：
```ts
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
```

---

### 🟠 #4 输入处理异步竞争

**位置**：[src/index.ts:497-552](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src/index.ts#L497)

```ts
searchInput?.addEventListener("input", async (e) => {
  searchQuery = ...;
  // 多个 await，无 cancellation
  const results = await searchEntries(searchQuery);
  renderResults(results);
});
```

快速键入 `b`→`ba`→`bd` 时，三次 invoke 并发。"ba" 的结果可能晚于 "bd" 到达，渲染出过期数据。

**修复**：维护 `let lastQueryId = 0; const myId = ++lastQueryId; if (myId !== lastQueryId) return;` 序列号守卫。

---

### 🟠 #5 模糊搜索逻辑错误

**位置**：[src-tauri/src/config.rs:285](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/config.rs#L285)

```rust
let best = key_score.max(title_score).or(sub_score);
```

`Option::or` 仅在 `self` 为 `None` 时使用参数。即：当 command/title 任一匹配，url/path 的分数被丢弃，无法参与比较。

**修复**：
```rust
let best = [key_score, title_score, sub_score]
    .into_iter().flatten().max();
```

---

### 🟠 #6 监听器累积

**位置**：[src/index.ts:1019-1026](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src/index.ts#L1019)

```ts
const updateVisibility = () => { ... };  // 每次点击都创建新闭包
updateVisibility();
kindSelect.removeEventListener("change", updateVisibility);  // 移除的是新闭包，永远没添加过
kindSelect.addEventListener("change", updateVisibility);     // 新闭包入列表
```

`removeEventListener` 比较函数引用，每次点击 grid item 都向 `simple-kind` 元素新增一个监听器，change 事件触发次数 N = 累计点击数。

**修复**：把 `updateVisibility` 提到外层作用域，或用 `{ once: true }` 选项 / `AbortController`。

---

### 🟡 #7 硬编码中文绕过 i18n

明显未走 `t(...)` 的位置：
- `index.ts:518, 885`：`actionText = entry.kind === "website" ? "跳转到" : "打开";`
- `index.ts:846`：`const name = entry ? entry.title : "未设置";`
- `index.ts:1000`：`titleEl.textContent = `编辑格子 ${cmd}`;`
- `index.ts:1379`：`showToast(`⚠ 全局快捷键 ${shortcut} 注册失败...`);`

**修复**：将这些字面量加入 `i18n/index.ts` 的三语字典并改用 `t(...)`。

---

### 🟡 #8 resize 风暴

`invoke("resize_window", ...)` 出现在：`showWelcomeWindow`、`showConfigWindow`、`loadConfig`、`setCollapsed`、`renderCommandSuggestions`、`renderResults`、`renderSimpleGrid`、`init`。每次按键都可能触发一次 IPC + 窗口尺寸调整。

**修复**：包一层防抖（≥80ms），或仅在尺寸真正变化时调用。

---

### 🟡 #9 `init_defaults` 误覆盖损坏数据

**位置**：[src-tauri/src/config.rs:71-83](file:///d:/Project/nqs-manifestv2/nk-launcher-tauri/src-tauri/src/config.rs#L71)

```rust
if self.get_str("global/mode").is_err() { self.set("global/mode", json!("expert"))?; }
```

`get_str` 在以下情况都返回 `Err`：
1. 键不存在（应该写默认值 ✓）
2. 值不是 JSON 字符串（不应覆盖 ✗）
3. JSON 解析失败（不应覆盖 ✗）

**修复**：分两步——先 `db.get_config(key)?` 检查 `Option`，仅 `None` 时写默认。

---

### 🟢 其他细节

- **#10**：`browser::enumerate_browsers()` 注册表枚举无缓存 → 加 `OnceLock` 或 5 秒 TTL 缓存。
- **#11**：`index.ts:1490` 用 `browsers[browsers.length - 1].id` 选刚加的浏览器，依赖 `list_browsers` 内合并顺序。改为按 `id` 显式匹配。
- **#12**：`open_app` 应同步使用 `creation_flags(DETACHED_PROCESS)` 与 `open_url_with_browser` 一致。
- **#13**：`get_data_dir` 用 `tauri::path::PathResolver::app_local_data_dir()` 替换手写 `LOCALAPPDATA`。
- **#14**：删除 `format!("global/default_browser")` 中无变量的 format；修正 `lib.rs:33` 的中文注释。
- **#15**：`get_data_dir(_app: &AppHandle)` 的参数从未使用，去掉签名中的 `&AppHandle` 让调用点更清爽。

---

## 三、修复优先级建议

| 优先级 | 问题 | 工作量 |
|--------|------|--------|
| **P0** | #1 open_url 逻辑、#2 双连接、#3 XSS | 各 1-2 小时 |
| **P1** | #4 异步竞争、#5 fuzzy 逻辑、#6 监听器泄漏 | 各 30-60 分钟 |
| **P2** | #7 i18n、#8 resize 防抖、#9 init_defaults | 各 30-60 分钟 |
| **P3** | #10–#15 工程化清理 | 合计 1-2 小时 |

---

## 四、积极面（保持）

- 错误类型 `AppError` 统一，模块边界清晰。
- `HotkeyProvider` trait + `MockHotkeyProvider` 抽象到位，单元测试覆盖了注册成功/冲突/替换三种路径。
- 数据库使用 `INSERT OR REPLACE` 简化 upsert 语义。
- 前后端 `AppConfig` 字段已完全对齐（既有审计已修复）。
- i18n 三语字典键数完全一致（既有审计已确认）。
