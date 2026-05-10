/**
 * nk-launcher Frontend - Main Entry Point
 * nk-launcher 前端 - 主入口点
 *
 * Tauri-based hybrid launcher supporting two modes:
 * 基于 Tauri 的混合启动器，支持两种模式：
 * - Expert Mode: Fuzzy search with command prefixes (/s, /d, etc.)
 * - Expert 模式：带命令前缀的模糊搜索（/s、/d 等）
 * - Simple Mode: 9-grid numeric launcher (1-9, with subgrid support)
 * - Simple 模式：9宫格数字启动器（1-9，支持子网格）
 *
 * @module index
 */

// ============================================================================
// Imports / 导入
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { initI18n, t, setLanguage, getCurrentLanguage } from "./i18n/index";

// Fluent UI Web Components for settings dialog
// 用于设置对话框的 Fluent UI Web Components
import {
  provideFluentDesignSystem,
  fluentSelect,
  fluentOption,
  fluentTextField,
  fluentButton,
  fluentRadio,
  fluentRadioGroup,
  fluentCheckbox,
  baseLayerLuminance,
  StandardLuminance
} from "@fluentui/web-components";

// Register Fluent UI components / 注册 Fluent UI 组件
provideFluentDesignSystem().register(
  fluentSelect(),
  fluentOption(),
  fluentTextField(),
  fluentButton(),
  fluentRadio(),
  fluentRadioGroup(),
  fluentCheckbox()
);

// ============================================================================
// Type Definitions / 类型定义
// ============================================================================

/**
 * Entry - Command entry in launcher / 启动器中的命令条目
 * @typedef {Object} Entry
 * @property {string} command - Unique identifier (e.g., "bd", "1", "12") / 唯一标识符
 * @property {string} kind - Type: "website", "app", or "subgrid" / 类型
 * @property {string} title - Display name / 显示名称
 * @property {string} [url] - URL for website entries / 网站条目的 URL
 * @property {string} [path] - File path for app entries / 应用条目的文件路径
 */
export interface Entry {
  command: string;
  kind: string;
  title: string;
  url?: string;
  path?: string;
}

/**
 * AppConfig - Application configuration / 应用配置
 * @typedef {Object} AppConfig
 * @property {string} version - Config version / 配置版本
 * @property {string} mode - "expert" or "simple" / 模式
 * @property {string} theme - "light", "dark", or "system" / 主题
 * @property {string} language - UI language (zh/en/ja) / UI 语言
 * @property {string} [default_browser] - Default browser ID / 默认浏览器 ID
 * @property {string} [shortcut] - Global hotkey / 全局热键
 * @property {string} [bg_image] - Background image base64 / 背景图片 base64
 * @property {number} [bg_blur] - Background blur intensity / 背景模糊强度
 * @property {number} [bg_opacity] - Background opacity / 背景不透明度
 * @property {number} [search_opacity] - Search box opacity / 搜索框不透明度
 * @property {number} [search_width] - Search box width / 搜索框宽度
 */
export interface AppConfig {
  version: string;
  mode: string;
  theme: string;
  language: string;
  default_browser?: string;
  shortcut?: string;
  bg_image?: string;
  bg_blur?: number;
  bg_opacity?: number;
  search_opacity?: number;
  search_width?: number;
  simple_bg_enabled?: boolean;
  window_sizes?: Partial<Record<WindowState, [number, number]>>;
}

/**
 * Window state used for stateful size persistence (#feature-1).
 * Each state's last user-resized dimensions are saved to global/window_sizes.
 */
export type WindowState =
  | "simple_grid"
  | "simple_collapsed"
  | "simple_results"
  | "expert_collapsed"
  | "expert_results"
  | "settings"
  | "welcome";

/**
 * BrowserInfo - Browser information / 浏览器信息
 * @typedef {Object} BrowserInfo
 * @property {string} id - Unique identifier / 唯一标识符
 * @property {string} name - Display name / 显示名称
 * @property {string} [exe_path] - Executable path / 可执行文件路径
 */
export interface BrowserInfo {
  id: string;
  name: string;
  exe_path?: string;
}

// ============================================================================
// Global State / 全局状态
// ============================================================================

/** Current launcher mode / 当前启动器模式 */
let currentMode: "expert" | "simple" = "simple";

/** All entries for current namespace / 当前命名空间的所有条目 */
let entries: Entry[] = [];

/** Current search query / 当前搜索查询 */
let searchQuery = "";

/** Command mode: true if query starts with '/' / 命令模式：查询是否以 '/' 开头 */
let commandMode = false;

/** Currently selected result index / 当前选中的结果索引 */
let selectedIndex = 0;

/** Number of DOM items currently rendered — bounds keyboard navigation. */
let visibleResultCount = 0;

/** Whether launcher is collapsed (minimal UI) / 启动器是否折叠（最小化 UI）*/
let collapsed = true;

/** Settings panel visibility / 设置面板可见性 */
let settingsVisible = false;

/** About panel visibility / 关于面板可见性 */
let aboutVisible = false;

/** Current search box width for expert mode / 当前搜索框宽度（专家模式）*/
let currentSearchWidth = 600.0;

/** Simple mode grid level: "main" or "1"-"9" subgrid / 简单模式网格级别："main" 或 "1"-"9" 子网格 */
let currentSimpleGridLevel = "main";

// ============================================================================
// DOM Element References / DOM 元素引用
// ============================================================================

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const resultList = document.getElementById("result-list") as HTMLDivElement;
const container = document.getElementById("container") as HTMLDivElement;
const configWindow = document.getElementById("config-window") as HTMLDivElement;
const welcomeWindow = document.getElementById("welcome-window") as HTMLDivElement;

// ============================================================================
// Theme Management / 主题管理
// ============================================================================

/**
 * Apply theme to UI / 将主题应用到 UI
 * @param {string} theme - "light", "dark", or "system" / 主题
 * @description
 * - "system": Follow OS preference / 跟随操作系统偏好
 * - Also updates Fluent UI luminance for web components
 * - 也更新 Fluent UI 亮度以适配 web 组件
 */
function applyTheme(theme: string) {
  if (theme === "dark") {
    document.body.dataset.theme = "dark";
    baseLayerLuminance.setValueFor(document.body, StandardLuminance.DarkMode);
    baseLayerLuminance.setValueFor(document.documentElement, StandardLuminance.DarkMode);
  } else if (theme === "light") {
    document.body.dataset.theme = "light";
    baseLayerLuminance.setValueFor(document.body, StandardLuminance.LightMode);
    baseLayerLuminance.setValueFor(document.documentElement, StandardLuminance.LightMode);
  } else {
    // System preference / 系统偏好
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.body.dataset.theme = "dark";
      baseLayerLuminance.setValueFor(document.body, StandardLuminance.DarkMode);
      baseLayerLuminance.setValueFor(document.documentElement, StandardLuminance.DarkMode);
    } else {
      document.body.dataset.theme = "light";
      baseLayerLuminance.setValueFor(document.body, StandardLuminance.LightMode);
      baseLayerLuminance.setValueFor(document.documentElement, StandardLuminance.LightMode);
    }
  }
}

// Listen for system theme changes / 监听系统主题变化
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
    if (!themeSelect || themeSelect.value === "system") {
      applyTheme("system");
    }
  });
}

// ============================================================================
// i18n UI Updates / 国际化 UI 更新
// ============================================================================

/**
 * Update all UI elements with data-i18n attribute / 更新所有带 data-i18n 属性的 UI 元素
 * Uses t() function to translate keys / 使用 t() 函数翻译键
 */
function updateI18nUI() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key);
    }
  });

  // Update placeholder text / 更新占位符文本
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      el.setAttribute("placeholder", t(key));
    }
  });
}

// ============================================================================
// Window Visibility Management / 窗口可见性管理
// ============================================================================

/**
 * Show welcome window / 显示欢迎窗口
 * Used for first-run wizard / 用于首次运行向导
 * @description Resizes window and shows welcome panel / 调整窗口大小并显示欢迎面板
 */
function showWelcomeWindow() {
  settingsVisible = true;
  if (welcomeWindow) welcomeWindow.classList.add("visible");
  if (container) container.style.display = "none";
  if (configWindow) configWindow.classList.remove("visible");
  getCurrentWindow().setSkipTaskbar(false).catch(() => {});
  applyState("welcome", 1000.0, 600.0);
}

/**
 * Hide welcome window / 隐藏欢迎窗口
 */
function hideWelcomeWindow() {
  settingsVisible = false;
  if (welcomeWindow) welcomeWindow.classList.remove("visible");
  if (container) container.style.display = "block";
  getCurrentWindow().setSkipTaskbar(true).catch(() => {});
}

/**
 * Show settings window / 显示设置窗口
 * @param {string} [targetId="basic-settings"] - Initial sidebar target / 初始侧边栏目标
 */
function showConfigWindow(targetId: string = "basic-settings") {
  settingsVisible = true;
  if (welcomeWindow) welcomeWindow.classList.remove("visible");
  if (configWindow) configWindow.classList.add("visible");
  if (container) container.style.display = "none";
  applyState("settings", 700.0, 500.0);
  switchSidebar(targetId);
}

/**
 * Hide settings window / 隐藏设置窗口
 * @description Also reloads entries and restores search state / 也重新加载条目并恢复搜索状态
 */
function hideConfigWindow() {
  settingsVisible = false;
  if (configWindow) configWindow.classList.remove("visible");
  if (container) container.style.display = "block";
  // Reload entries after closing settings / 关闭设置后重新加载条目
  loadEntries().then(() => {
    if (!searchQuery) {
      if (currentMode === "simple") {
        collapsed = false;
        renderResults([]);
      } else {
        setCollapsed(true);
        renderResults([]);
      }
    } else {
      searchEntries(searchQuery).then(results => {
        renderResults(results);
      });
    }
  });
}

/**
 * Switch sidebar panel / 切换侧边栏面板
 * @param {string} targetId - Panel ID to show / 要显示的面板 ID
 */
function switchSidebar(targetId: string) {
  // Update active sidebar item / 更新活跃的侧边栏项
  document.querySelectorAll(".sidebar-item").forEach(item => {
    item.classList.toggle("active", item.getAttribute("data-target") === targetId);
  });
  // Update active content panel / 更新活跃的内容面板
  document.querySelectorAll(".content-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === targetId);
  });

  // Lazy load panel content / 惰性加载面板内容
  if (targetId === "simple-settings") {
    loadAndRenderSimpleEntries();
  } else if (targetId === "expert-settings") {
    loadAndRenderExpertEntries();
  }
}

// ============================================================================
// Window Control Buttons / 窗口控制按钮
// ============================================================================

// Standard window buttons (minimize, maximize, close)
// 标准窗口按钮（最小化、最大化、关闭）
document.getElementById("btn-minimize")?.addEventListener("click", () => {
  getCurrentWindow().minimize();
});

document.getElementById("btn-maximize")?.addEventListener("click", async () => {
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

document.getElementById("btn-close")?.addEventListener("click", () => {
  hideConfigWindow();
});

// Welcome window buttons / 欢迎窗口按钮
document.querySelector(".btn-welcome-minimize")?.addEventListener("click", () => {
  getCurrentWindow().minimize();
});

document.querySelector(".btn-welcome-close")?.addEventListener("click", async () => {
  // Show current config (user picks or defaults) before entering launcher. (#5)
  const lang = getCurrentLanguage();
  const langLabel = { zh: "中文", en: "English", ja: "日本語" }[lang] ?? lang;
  const theme = document.body.dataset.theme ?? "system";
  const themeLabel =
    theme === "dark" ? t("dark_mode")
    : theme === "light" ? t("light_mode")
    : t("system");
  const modeLabel =
    currentMode === "simple" ? t("simple_mode") : t("expert_mode");
  const msg = `${t('will_use_config')}\n\n${t('mode')}：${modeLabel}\n${t('language')}：${langLabel}\n${t('theme')}：${themeLabel}\n\n${t('confirm_enter_launcher')}`;
  if (!window.confirm(msg)) return;

  await invoke("mark_launched").catch(() => {});
  hideWelcomeWindow();
  if (currentMode === "simple") {
    collapsed = false;
    renderResults([]);
  } else {
    setCollapsed(true);
    renderResults([]);
  }
});

// Sidebar navigation / 侧边栏导航
document.querySelectorAll(".sidebar-item").forEach(item => {
  item.addEventListener("click", () => {
    const target = item.getAttribute("data-target");
    if (target) switchSidebar(target);
  });
});

// ============================================================================
// Configuration Management / 配置管理
// ============================================================================

/**
 * Load configuration from backend / 从后端加载配置
 * Applies theme, language, background settings
 * 应用主题、语言、背景设置
 */
async function loadConfig() {
  try {
    const config = await invoke<AppConfig>("get_config");
    currentMode = config.mode as "expert" | "simple";
    applyTheme(config.theme || "system");
    setLanguage(config.language || "zh");

    // Apply background image if set / 如果设置了则应用背景图片
    if (config.bg_image) {
      if (configWindow) {
        configWindow.style.backgroundImage = `url(${config.bg_image})`;
        configWindow.style.backgroundColor = "transparent";
      }
      if (config.simple_bg_enabled === true && container) {
        container.style.backgroundImage = `url(${config.bg_image})`;
      }
    } else {
      if (configWindow) {
        configWindow.style.backgroundImage = "none";
        configWindow.style.backgroundColor = "";
      }
      if (container) {
        container.style.backgroundImage = "none";
      }
    }

    // Apply simple bg toggle / 应用简单模式背景开关
    if (config.simple_bg_enabled === true) {
      document.body.dataset.simpleBg = "true";
    } else {
      delete document.body.dataset.simpleBg;
    }

    // Apply blur, opacity, search width settings
    // Rust `Option::None` serializes as JSON null (not undefined), so use `??`
    // to also catch the fresh-DB case where these keys are absent.
    const blur = config.bg_blur ?? 20;
    const opacity = config.bg_opacity ?? 60;
    const searchOpacity = config.search_opacity ?? 100;
    currentSearchWidth = config.search_width ?? 600.0;

    // Hydrate persisted per-state window sizes (#feature-1).
    if (config.window_sizes && typeof config.window_sizes === "object") {
      persistedSizes = config.window_sizes as Partial<Record<WindowState, [number, number]>>;
    }

    // Update CSS custom properties / 更新 CSS 自定义属性
    document.documentElement.style.setProperty("--bg-blur", `${blur}px`);
    document.documentElement.style.setProperty("--bg-opacity", `${opacity / 100}`);
    document.documentElement.style.setProperty("--search-opacity", `${searchOpacity / 100}`);

    // Expert mode starts collapsed / 专家模式开始时折叠
    if (currentMode === "expert" && collapsed && !settingsVisible) {
      applyState("expert_collapsed", currentSearchWidth, 40.0);
    }

    // Setup search width slider / 设置搜索框宽度滑块
    const searchWidthSlider = document.getElementById("search-width-slider") as HTMLInputElement;
    if (searchWidthSlider) {
      searchWidthSlider.value = (config.search_width ?? 600).toString();
      searchWidthSlider.addEventListener("input", (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        currentSearchWidth = val;
      });
      searchWidthSlider.addEventListener("change", async (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        await invoke("save_config", { key: "global/search_width", value: val });
      });
    }
  } catch (e) {
    console.error("Failed to load config:", e);
  }
}

// ============================================================================
// Entry Management / 条目管理
// ============================================================================

/**
 * Load entries for current mode/namespace / 加载当前模式/命名空间的条目
 */
async function loadEntries() {
  const namespace = currentMode === "expert" ? "expert" : "simple";
  try {
    entries = await invoke<Entry[]>("get_entries", { namespace });
  } catch (e) {
    console.error("Failed to load entries:", e);
    entries = [];
  }
}

/**
 * Perform fuzzy search on entries / 对条目执行模糊搜索
 * @param {string} query - Search query / 搜索查询
 * @returns {Promise<Entry[]>} - Matching entries sorted by relevance / 按相关性排序的匹配条目
 */
async function searchEntries(query: string): Promise<Entry[]> {
  if (!query.trim()) return [];
  return await invoke<Entry[]>("fuzzy_search", { query, entries });
}

// ============================================================================
// Window Collapsing / 窗口折叠
// ============================================================================

/**
 * Set collapsed state and resize window / 设置折叠状态并调整窗口大小
 * @param {boolean} collapse - Whether to collapse / 是否折叠
 */
function setCollapsed(collapse: boolean) {
  collapsed = collapse;
  if (collapse) {
    if (currentMode === "simple") {
      applyState("simple_collapsed", 340.0, 40.0);
    } else {
      applyState("expert_collapsed", currentSearchWidth, 40.0);
    }
  }
}

// ============================================================================
// Search Input Handler / 搜索输入处理
// ============================================================================

/**
 * Handle search input events / 处理搜索输入事件
 * Implements:
 * - Command mode (starts with /) / 命令模式（以 / 开头）
 * - Simple mode number input (1-9) / 简单模式数字输入（1-9）
 * - Fuzzy search for expert mode / 专家模式模糊搜索
 */
// Monotonic id ensures only the freshest async search result reaches the DOM,
// so a fast `b → ba → bd` sequence won't paint stale results. (#4)
let lastQueryId = 0;
searchInput?.addEventListener("input", async (e) => {
  const myId = ++lastQueryId;
  searchQuery = (e.target as HTMLInputElement).value;
  commandMode = searchQuery.startsWith("/");
  selectedIndex = 0;

  if (commandMode) {
    // Command mode: show suggestions for /commands / 命令模式：为 /命令显示建议
    renderCommandSuggestions();
  } else if (currentMode === "simple" && /^[1-9]{1,2}$/.test(searchQuery)) {
    // Simple mode: number input / 简单模式：数字输入
    const entry = entries.find(e => e.command === searchQuery);
    if (searchQuery.length === 1 && entry?.kind === "subgrid") {
      // Single digit + subgrid = enter subgrid / 单位数 + 子网格 = 进入子网格
      collapsed = false;
      renderSimpleGrid(searchQuery);
    } else {
      if (entry && entry.kind !== "subgrid") {
        // Direct execute for non-subgrid entries / 直接执行非子网格条目
        collapsed = false;

        const actionText = entry.kind === "website" ? t("jump_to") : t("open_action");
        const formattedEntry = {
          ...entry,
          title: `${searchQuery}：${actionText} ${entry.title}`,
          url: "", // Hide extra info / 隐藏额外信息
          path: ""
        };

        renderResults([formattedEntry]);
      } else {
        renderResults([]);
      }
    }
  } else if (collapsed && searchQuery.length > 0) {
    // Start search, expand if results found / 开始搜索，如有结果则展开
    const results = await searchEntries(searchQuery);
    if (myId !== lastQueryId) return;
    if (results.length > 0) {
      collapsed = false;
    }
    renderResults(results);
  } else if (!searchQuery) {
    // Empty query: show grid or collapse / 空查询：显示网格或折叠
    if (currentMode === "simple") {
      collapsed = false;
      renderSimpleGrid();
    } else {
      setCollapsed(true);
      renderResults([]);
    }
  } else {
    // Continue search / 继续搜索
    const results = await searchEntries(searchQuery);
    if (myId !== lastQueryId) return;
    renderResults(results);
  }
});

// ============================================================================
// Search Keyboard Handler / 搜索键盘处理
// ============================================================================

/**
 * Handle keyboard navigation in search / 处理搜索中的键盘导航
 * - Enter: Execute selected / Enter：执行选中
 * - Arrow Up/Down: Navigate results / 方向键上下：导航结果
 * - Escape: Close settings or clear / Escape：关闭设置或清空
 */
searchInput?.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    if (commandMode) {
      await executeCommand(searchQuery.slice(1));
    } else if (currentMode === "simple" && /^[1-9]{1,2}$/.test(searchQuery)) {
      const entry = entries.find(e => e.command === searchQuery);
      if (entry && entry.kind !== "subgrid") {
        await executeEntry(entry);
      }
    } else {
      const results = await searchEntries(searchQuery);
      if (results[selectedIndex]) {
        await executeEntry(results[selectedIndex]);
      }
    }

    // Clear search after execution / 执行后清空搜索
    searchQuery = "";
    searchInput.value = "";
    if (settingsVisible) {
      return;
    }
    if (currentMode === "simple") {
      collapsed = false;
      renderResults([]);
    } else {
      setCollapsed(true);
      renderResults([]);
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIndex = Math.min(selectedIndex + 1, Math.max(0, visibleResultCount - 1));
    updateSelection();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIndex = Math.max(selectedIndex - 1, 0);
    updateSelection();
  } else if (e.key === "Escape") {
    if (settingsVisible) {
      hideConfigWindow();
    } else {
      searchQuery = "";
      searchInput.value = "";
      if (currentMode === "simple") {
        collapsed = false;
        renderResults([]);
      } else {
        setCollapsed(true);
        renderResults([]);
      }
    }
  }
});

// ============================================================================
// Command Mode / 命令模式
// ============================================================================

/**
 * Command definitions for command mode / 命令模式的命令定义
 * Format: { cmd, label, icon, action }
 * 格式：{ cmd, label, icon, action }
 */
function renderCommandSuggestions() {
  const commands = [
    { cmd: "s", label: t("setting"), icon: `<i class="fa-solid fa-cog"></i>`, action: () => showConfigWindow("basic-settings") },
    { cmd: "d", label: t("dark"), icon: `<i class="fa-solid fa-moon"></i>`, action: async () => { await invoke("save_config", { key: "global/theme", value: "dark" }); applyTheme("dark"); } },
    { cmd: "l", label: t("light"), icon: `<i class="fa-solid fa-sun"></i>`, action: async () => { await invoke("save_config", { key: "global/theme", value: "light" }); applyTheme("light"); } },
    { cmd: "w", label: t("system"), icon: `<i class="fa-solid fa-desktop"></i>`, action: async () => { await invoke("save_config", { key: "global/theme", value: "system" }); applyTheme("system"); } },
    { cmd: "i", label: t("import"), icon: `<i class="fa-solid fa-file-import"></i>`, action: () => importConfigFromFile() },
    { cmd: "o", label: t("export"), icon: `<i class="fa-solid fa-file-export"></i>`, action: () => exportConfigToFile() },
    { cmd: "a", label: t("about"), icon: `<i class="fa-solid fa-info-circle"></i>`, action: () => showConfigWindow("about-settings") },
    { cmd: "e", label: t("hide_to_tray"), icon: `<i class="fa-solid fa-eye-slash"></i>`, action: () => invoke("hide_window") },
    { cmd: "q", label: t("quit"), icon: `<i class="fa-solid fa-power-off"></i>`, action: () => invoke("quit_app") },
  ];

  // Filter commands by query / 根据查询过滤命令
  const filtered = commands.filter(c => c.cmd.startsWith(searchQuery.slice(1).toLowerCase()));
  visibleResultCount = filtered.length;
  const html = filtered.map((c, i) => `<div class="result-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">${c.icon} /${c.cmd} → ${c.label}</div>`).join("");
  resultList.innerHTML = html;

  // Resize window to fit results / 调整窗口大小以容纳结果
  const targetWidth = currentMode === "simple" ? 340.0 : currentSearchWidth;
  const height = Math.min(40 + filtered.length * 36, 400);
  applyState(currentMode === "simple" ? "simple_results" : "expert_results", targetWidth, height);

  // Click handlers for results / 结果的点击处理器
  document.querySelectorAll(".result-item").forEach((item, i) => {
    item.addEventListener("click", async () => {
      const filteredCmds = commands.filter(c => c.cmd.startsWith(searchQuery.slice(1).toLowerCase()));
      if (filteredCmds[i]) {
        await executeCommand(filteredCmds[i].cmd);
        searchQuery = "";
        searchInput.value = "";
        if (settingsVisible) {
          return;
        }
        if (currentMode === "simple") {
          collapsed = false;
          renderResults([]);
        } else {
          setCollapsed(true);
          renderResults([]);
        }
      }
    });
  });
}

/**
 * Execute a command / 执行命令
 * @param {string} cmd - Command to execute / 要执行的命令
 */
async function executeCommand(cmd: string) {
  const commands: Record<string, () => Promise<void>> = {
    s: () => { showConfigWindow("basic-settings"); return Promise.resolve(); },
    d: async () => { await invoke("save_config", { key: "global/theme", value: "dark" }); applyTheme("dark"); },
    l: async () => { await invoke("save_config", { key: "global/theme", value: "light" }); applyTheme("light"); },
    w: async () => { await invoke("save_config", { key: "global/theme", value: "system" }); applyTheme("system"); },
    i: () => importConfigFromFile(),
    o: () => exportConfigToFile(),
    a: () => { showConfigWindow("about-settings"); return Promise.resolve(); },
    e: () => { invoke("hide_window"); return Promise.resolve(); },
    q: () => { invoke("quit_app"); return Promise.resolve(); },
  };

  if (commands[cmd]) {
    await commands[cmd]();
  }
}

// ============================================================================
// Utility Functions / 工具函数
// ============================================================================

/**
 * Escape HTML special chars before splicing untrusted strings into innerHTML.
 * 将不受信任的字符串拼接进 innerHTML 前必须转义，避免 imported config 注入脚本。
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

/**
 * Debounced resize_window invocation. Many code paths trigger resize on every
 * keystroke; collapse them into one IPC call ~80ms after the last request.
 * 多处渲染路径都会触发 resize；统一收敛到 80ms 后单次调用，避免窗口闪烁。
 */
let resizeTimer: number | null = null;
let lastResize = { w: -1, h: -1 };
function scheduleResize(width: number, height: number) {
  if (lastResize.w === width && lastResize.h === height) return;
  lastResize = { w: width, h: height };
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null;
    invoke("resize_window", { width, height }).catch(() => {});
  }, 80);
}

/**
 * Stateful resize: tracks current logical state and applies persisted
 * dimensions when present, falling back to defaults otherwise.
 * Also enforces per-state minimum window size to prevent degenerate drag.
 * 按状态记忆窗口尺寸：若有持久化值则用，否则落到默认。
 * 同时强制按状态设置最小窗口尺寸，防止拖拽到无法使用的大小。
 */
let currentWindowState: WindowState = "expert_collapsed";
let persistedSizes: Partial<Record<WindowState, [number, number]>> = {};
let lastProgrammaticSize: { w: number; h: number } | null = null;

const STATE_MIN_SIZES: Record<WindowState, [number, number]> = {
  simple_grid: [340, 380],
  simple_collapsed: [340, 40],
  simple_results: [340, 120],
  expert_collapsed: [300, 40],
  expert_results: [300, 120],
  settings: [700, 500],
  welcome: [1000, 600],
};

function applyState(state: WindowState, defaultW: number, defaultH: number) {
  currentWindowState = state;
  const persisted = persistedSizes[state];
  const w = persisted?.[0] ?? defaultW;
  const h = persisted?.[1] ?? defaultH;
  lastProgrammaticSize = { w, h };
  const [minW, minH] = STATE_MIN_SIZES[state];
  getCurrentWindow().setMinSize(new LogicalSize(minW, minH)).catch(() => {});
  scheduleResize(w, h);
}

/**
 * Export config via native save dialog so the user picks the destination.
 * 通过原生保存对话框让用户挑路径/文件名。
 */
async function exportConfigToFile() {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const path = await save({
    defaultPath: `nk-launcher-config-${today}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return; // user cancelled
  try {
    await invoke("export_config_to_file", { path });
    showToast(t("export_success"));
  } catch (e) {
    showToast(String(e), true);
  }
}

/**
 * Import config via native open dialog. On success the window reloads so
 * all caches reflect the new state.
 * 通过原生打开对话框选择 JSON，导入成功后刷新窗口使全部缓存重置。
 */
async function importConfigFromFile() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path || typeof path !== "string") return;
  try {
    await invoke("import_config_from_file", { path });
    showToast(t("import_restarting"));
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    showToast(t("import_failed") + ": " + String(e), true);
  }
}

/**
 * Show toast notification / 显示 toast 通知
 * @param {string} message - Message to display / 要显示的消息
 * @param {boolean} [isError=false] - Whether this is an error / 是否为错误
 */
function showToast(message: string, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.backgroundColor = isError ? "var(--error-color)" : "var(--accent-color)";
  toast.classList.add("visible");
  setTimeout(() => {
    toast.classList.remove("visible");
  }, 2000);
}

/**
 * Execute an entry / 执行条目
 * @param {Entry} entry - Entry to execute / 要执行的条目
 * @description Opens URL with browser or launches app / 用浏览器打开 URL 或启动应用
 */
async function executeEntry(entry: Entry) {
  try {
    if (entry.kind === "website" && entry.url) {
      await invoke("open_url", { url: entry.url, browserId: null });
      await invoke("hide_window");
    } else if (entry.kind === "app" && entry.path) {
      await invoke("open_app", { path: entry.path });
      await invoke("hide_window");
    }
  } catch (e) {
    showToast(String(e), true);
  }
}

// ============================================================================
// Result Rendering / 结果渲染
// ============================================================================

/**
 * Render search results / 渲染搜索结果
 * @param {Entry[]} results - Results to display / 要显示的结果
 */
function renderResults(results: Entry[]) {
  if (results.length === 0) {
    // No results: show grid (simple) or empty (expert) / 无结果：显示网格（简单）或空（专家）
    visibleResultCount = 0;
    if (currentMode === "simple" && !searchQuery) {
      renderSimpleGrid();
    } else {
      resultList.innerHTML = "";
      if (currentMode === "simple" && searchQuery) {
        applyState("simple_collapsed", 340.0, 40.0);
      }
    }
    return;
  }

  visibleResultCount = results.length;

  // Resize window to fit results / 调整窗口大小以容纳结果
  const targetWidth = currentMode === "simple" ? 340.0 : currentSearchWidth;
  const height = Math.min(40 + results.length * 36, 400);
  applyState(currentMode === "simple" ? "simple_results" : "expert_results", targetWidth, height);

  // Build HTML for results — every user-supplied string is escaped before splicing.
  // 构建结果的 HTML，所有用户字段必须经 escapeHtml 转义。
  const html = results.map((entry, i) => {
    const icon = entry.kind === "website" ? `<i class="fa-solid fa-globe"></i>` : `<i class="fa-solid fa-box"></i>`;
    const desc = entry.url || entry.path || "";
    return `<div class="result-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">${icon} ${escapeHtml(entry.title)}<span class="desc">${escapeHtml(desc)}</span></div>`;
  }).join("");

  resultList.innerHTML = html;

  // Add click handlers / 添加点击处理器
  document.querySelectorAll(".result-item").forEach((item, i) => {
    item.addEventListener("mouseenter", () => {
      selectedIndex = i;
      updateSelection();
    });
    item.addEventListener("click", async () => {
      let results = [];
      if (currentMode === "simple" && /^[1-9]{1,2}$/.test(searchQuery)) {
        const entry = entries.find(e => e.command === searchQuery);
        if (entry && entry.kind !== "subgrid") {
          results = [entry];
        }
      } else {
        results = await searchEntries(searchQuery);
      }

      if (results[i]) {
        await executeEntry(results[i]);
        searchQuery = "";
        searchInput.value = "";
        if (currentMode === "simple") {
          collapsed = false;
          renderResults([]);
        } else {
          setCollapsed(true);
          renderResults([]);
        }
      }
    });
  });
}

/**
 * Update visual selection state / 更新视觉选中状态
 */
function updateSelection() {
  document.querySelectorAll(".result-item").forEach((item, i) => {
    item.classList.toggle("selected", i === selectedIndex);
  });
  document.querySelectorAll(".result-item")[selectedIndex]
    ?.scrollIntoView({ block: "nearest" });
}

// ============================================================================
// Simple Mode Grid / 简单模式网格
// ============================================================================

/**
 * Render 9-grid layout for simple mode / 渲染简单模式的 9 宫格布局
 * @param {string} [prefix=""] - Grid prefix (for subgrid navigation) / 网格前缀（用于子网格导航）
 */
function renderSimpleGrid(prefix: string = "") {
  // Resize for grid layout / 为网格布局调整大小
  applyState("simple_grid", 340.0, 380.0);

  // Build grid HTML / 构建网格 HTML
  let html = `<div id="nine-grid">`;
  for (let i = 1; i <= 9; i++) {
    const cmd = prefix + String(i);
    const entry = entries.find(e => e.command === cmd);
    const name = entry ? entry.title : t("unset");
    let icon = `<i class="fa-solid fa-plus"></i>`;
    if (entry) {
      if (entry.kind === "website") icon = `<i class="fa-solid fa-globe"></i>`;
      else if (entry.kind === "app") icon = `<i class="fa-solid fa-box"></i>`;
      else if (entry.kind === "subgrid") icon = `<i class="fa-solid fa-folder"></i>`;
    }
    const safeCmd = escapeHtml(cmd);
    const safeName = escapeHtml(name);
    html += `
      <div class="grid-item" data-cmd="${safeCmd}">
        <span class="number">${i}</span>
        <span class="icon">${icon}</span>
        <span class="name" title="${safeName}">${safeName}</span>
      </div>
    `;
  }
  html += `</div>`;

  // Add action buttons / 添加操作按钮
  html += `<div id="simple-actions">
    <fluent-button id="btn-settings" appearance="stealth"><i class="fa-solid fa-cog"></i> ${t("setting")}</fluent-button>
    <fluent-button id="btn-theme" appearance="stealth"><i class="fa-solid fa-moon"></i> ${t("theme")}</fluent-button>
    <fluent-button id="btn-about" appearance="stealth"><i class="fa-solid fa-info-circle"></i> ${t("about")}</fluent-button>
  </div>`;

  resultList.innerHTML = html;

  // Grid item click handlers / 网格项点击处理器
  document.querySelectorAll(".grid-item").forEach((item) => {
    item.addEventListener("click", () => {
      const cmd = item.getAttribute("data-cmd");
      if (cmd) {
        searchInput.value = cmd;
        searchQuery = cmd;

        const entry = entries.find(e => e.command === cmd);
        if (entry && entry.kind !== "subgrid") {
          collapsed = false;

          const actionText = entry.kind === "website" ? t("jump_to") : t("open_action");
          const formattedEntry = {
            ...entry,
            title: `${searchQuery}：${actionText} ${entry.title}`,
            url: "",
            path: ""
          };

          renderResults([formattedEntry]);
        } else {
          // Subgrid or empty: trigger search to show grid / 子网格或空：触发搜索以显示网格
          searchInput.dispatchEvent(new Event("input"));
        }
      }
    });
  });

  // Action button handlers / 操作按钮处理器
  document.getElementById("btn-settings")?.addEventListener("click", () => showConfigWindow("basic-settings"));
  document.getElementById("btn-about")?.addEventListener("click", () => showConfigWindow("about-settings"));
  document.getElementById("btn-theme")?.addEventListener("click", async () => {
    const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
    const currentTheme = themeSelect ? themeSelect.value : "system";
    let newTheme = "system";
    if (currentTheme === "system") newTheme = "dark";
    else if (currentTheme === "dark") newTheme = "light";
    else newTheme = "system";

    await invoke("save_config", { key: "global/theme", value: newTheme });
    applyTheme(newTheme);
    if (themeSelect) themeSelect.value = newTheme;
  });
}

// ============================================================================
// Settings: Simple Mode / 设置：简单模式
// ============================================================================

/** Cached simple entries for settings / 设置的缓存简单条目 */
let simpleEntries: Entry[] = [];

/**
 * AbortController scoped to the currently-open simple-mode edit form.
 * On every grid-item click we abort the previous form's listeners before
 * attaching new ones, so `change` listeners cannot accumulate. (#6)
 */
let simpleEditListeners: AbortController | null = null;

/**
 * Load and render simple mode entries for settings / 加载并渲染设置中的简单模式条目
 */
async function loadAndRenderSimpleEntries() {
  simpleEntries = await invoke<Entry[]>("get_entries", { namespace: "simple" });
  updateSimpleGridLevelOptions();
  renderSimpleSettingsGrid();
}

/**
 * Render settings grid for simple mode / 渲染简单模式的设置网格
 */
function renderSimpleSettingsGrid() {
  const gridContainer = document.getElementById("simple-settings-grid");
  if (!gridContainer) return;

  const prefix = currentSimpleGridLevel === "main" ? "" : currentSimpleGridLevel;
  let html = "";

  // Build 9 grid items / 构建 9 个网格项
  for (let i = 1; i <= 9; i++) {
    const cmd = prefix + String(i);
    const entry = simpleEntries.find(e => e.command === cmd);

    // Determine badge content / 确定徽章内容
    let kindBadge = t("unconfigured");
    let title = t("click_to_config");
    let desc = "";
    let badgeClass = "";

    if (entry) {
      if (entry.kind === "website") {
        kindBadge = `<i class="fa-solid fa-globe"></i> ${t("website")}`;
        desc = entry.url || "";
      } else if (entry.kind === "app") {
        kindBadge = `<i class="fa-solid fa-box"></i> ${t("app")}`;
        desc = entry.path || "";
      } else if (entry.kind === "subgrid") {
        kindBadge = `<i class="fa-solid fa-folder"></i> ${t("subgrid")}`;
        badgeClass = "subgrid";
        desc = t("subgrid_desc");
      }
      title = entry.title;
    }

    html += `
      <div class="settings-grid-item" data-cmd="${escapeHtml(cmd)}">
        <div class="settings-grid-item-header">
          <span>${t("grid")} ${i}</span>
          <span class="settings-grid-item-badge ${badgeClass}">${kindBadge}</span>
        </div>
        <div class="settings-grid-item-content">
          <span class="settings-grid-item-title">${escapeHtml(title)}</span>
          <span class="settings-grid-item-desc">${escapeHtml(desc)}</span>
        </div>
      </div>
    `;
  }

  gridContainer.innerHTML = html;

  // Grid item click handlers / 网格项点击处理器
  document.querySelectorAll(".settings-grid-item").forEach(item => {
    item.addEventListener("click", (e) => {
      document.querySelectorAll(".settings-grid-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");

      const cmd = item.getAttribute("data-cmd") || "";
      const entry = simpleEntries.find(x => x.command === cmd);

      // Show edit form / 显示编辑表单
      const form = document.getElementById("simple-entry-form");
      const titleEl = document.getElementById("simple-entry-form-title");
      if (form && titleEl) {
        titleEl.textContent = t("edit_grid_with_cmd").replace("{cmd}", cmd);
        (document.getElementById("simple-cmd") as HTMLInputElement).value = cmd;
        (document.getElementById("simple-title") as HTMLInputElement).value = entry?.title || "";
        (document.getElementById("simple-kind") as HTMLSelectElement).value = entry?.kind || "website";
        (document.getElementById("simple-url") as HTMLInputElement).value = entry?.url || "";
        (document.getElementById("simple-path") as HTMLInputElement).value = entry?.path || "";
        form.classList.add("active");

        // Toggle delete button visibility / 切换删除按钮可见性
        const btnDelete = document.getElementById("btn-delete-simple");
        if (btnDelete) {
          btnDelete.style.display = entry ? "block" : "none";
        }

        // Toggle URL/Path inputs based on kind / 根据类型切换 URL/Path 输入
        const kindSelect = document.getElementById("simple-kind") as HTMLSelectElement;
        const urlInput = document.getElementById("simple-url") as HTMLInputElement;
        const pathInput = document.getElementById("simple-path") as HTMLInputElement;

        const updateVisibility = () => {
          urlInput.style.display = kindSelect.value === "website" ? "block" : "none";
          pathInput.style.display = kindSelect.value === "app" ? "block" : "none";
        };

        // Abort previous form's listeners — addEventListener identity comparison
        // doesn't help here since each click rebuilds the closure (#6).
        simpleEditListeners?.abort();
        simpleEditListeners = new AbortController();
        updateVisibility();
        kindSelect.addEventListener("change", updateVisibility, {
          signal: simpleEditListeners.signal,
        });
      }
    });
  });
}

/**
 * Update grid level dropdown options / 更新网格级别下拉选项
 */
function updateSimpleGridLevelOptions() {
  const select = document.getElementById("simple-grid-level-select") as HTMLSelectElement;
  if (!select) return;

  // Build options with main + subgrids / 用 main + 子网格构建选项
  let html = `<fluent-option value="main">${escapeHtml(t("main_grid"))}</fluent-option>`;

  // Find all subgrids / 找到所有子网格
  const subgrids = simpleEntries.filter(e => e.kind === "subgrid" && e.command.length === 1);
  subgrids.forEach(sg => {
    const cmd = escapeHtml(sg.command);
    html += `<fluent-option value="${cmd}">${escapeHtml(t("subgrid"))}: ${escapeHtml(sg.title)} (${cmd})</fluent-option>`;
  });

  select.innerHTML = html;

  // Ensure current level is still valid / 确保当前级别仍然有效
  if (currentSimpleGridLevel !== "main" && !subgrids.find(sg => sg.command === currentSimpleGridLevel)) {
    currentSimpleGridLevel = "main";
  }
  select.value = currentSimpleGridLevel;
}

/**
 * Setup simple mode settings UI handlers / 设置简单模式设置 UI 处理器
 */
function setupSimpleSettingsUI() {
  // Grid level select / 网格级别选择
  const levelSelect = document.getElementById("simple-grid-level-select") as HTMLSelectElement;
  if (levelSelect) {
    levelSelect.addEventListener("change", (e) => {
      currentSimpleGridLevel = (e.target as HTMLSelectElement).value;
      document.getElementById("simple-entry-form")?.classList.remove("active");
      renderSimpleSettingsGrid();
    });
  }

  // Cancel button / 取消按钮
  document.getElementById("btn-cancel-simple")?.addEventListener("click", () => {
    document.getElementById("simple-entry-form")?.classList.remove("active");
    document.querySelectorAll(".settings-grid-item").forEach(el => el.classList.remove("active"));
  });

  // Delete button / 删除按钮
  document.getElementById("btn-delete-simple")?.addEventListener("click", async () => {
    const cmd = (document.getElementById("simple-cmd") as HTMLInputElement).value;
    if (cmd) {
      await invoke("delete_entry", { namespace: "simple", key: cmd });

      // Also delete child entries if subgrid / 如果是子网格也删除子条目
      const entry = simpleEntries.find(e => e.command === cmd);
      if (entry && entry.kind === "subgrid") {
        for (let i = 1; i <= 9; i++) {
          await invoke("delete_entry", { namespace: "simple", key: cmd + String(i) });
        }
      }

      // If viewing deleted subgrid, switch to main / 如果正在查看已删除的子网格，切换到 main
      if (cmd === currentSimpleGridLevel) {
        currentSimpleGridLevel = "main";
      }

      showToast(t("clear_grid_success"));
      document.getElementById("simple-entry-form")?.classList.remove("active");
      await loadAndRenderSimpleEntries();
      updateSimpleGridLevelOptions();
    }
  });

  // Save button / 保存按钮
  document.getElementById("btn-save-simple")?.addEventListener("click", async () => {
    const cmd = (document.getElementById("simple-cmd") as HTMLInputElement).value.trim();
    const title = (document.getElementById("simple-title") as HTMLInputElement).value.trim();
    const kind = (document.getElementById("simple-kind") as HTMLSelectElement).value;
    const url = (document.getElementById("simple-url") as HTMLInputElement).value.trim();
    const path = (document.getElementById("simple-path") as HTMLInputElement).value.trim();

    // Validation / 验证
    if (!cmd || !title) {
      showToast(t("empty_display_name"), true);
      return;
    }

    const entry: Entry = { command: cmd, title, kind };
    if (kind === "website") {
      if (!url) { showToast(t("empty_url"), true); return; }
      entry.url = url;
    } else if (kind === "app") {
      if (!path) { showToast(t("empty_path"), true); return; }
      entry.path = path;
    }

    try {
      await invoke("save_entry", { namespace: "simple", entry });
      showToast(t("save_success"));
      document.getElementById("simple-entry-form")?.classList.remove("active");
      await loadAndRenderSimpleEntries();
      updateSimpleGridLevelOptions();
    } catch (e) {
      showToast(String(e), true);
    }
  });
}

// ============================================================================
// Settings: Expert Mode / 设置：专家模式
// ============================================================================

/** Cached expert entries for settings / 设置的缓存专家条目 */
let expertEntries: Entry[] = [];

/**
 * Load and render expert mode entries / 加载并渲染专家模式条目
 */
async function loadAndRenderExpertEntries() {
  expertEntries = await invoke<Entry[]>("get_entries", { namespace: "expert" });
  renderExpertEntries();
}

/**
 * Render expert entries list / 渲染专家条目列表
 */
function renderExpertEntries() {
  const list = document.getElementById("expert-entries-list");
  if (!list) return;

  list.innerHTML = expertEntries.map(e => {
    let icon = "";
    if (e.kind === "website") icon = `<i class="fa-solid fa-globe"></i>`;
    else if (e.kind === "app") icon = `<i class="fa-solid fa-box"></i>`;

    const cmd = escapeHtml(e.command);
    const title = escapeHtml(e.title);
    const target = escapeHtml(e.url || e.path || t("none"));

    return `
    <div class="entry-item-row">
      <div class="entry-item-info">
        <strong>[${cmd}] ${icon} ${title}</strong>
        <span>${t("type")}: ${t(e.kind)} | ${t("target")}: ${target}</span>
      </div>
      <div>
        <fluent-button class="btn-edit-expert" data-cmd="${cmd}">${t("edit")}</fluent-button>
        <fluent-button class="btn-delete-expert" data-cmd="${cmd}" style="color: var(--error-color);">${t("delete")}</fluent-button>
      </div>
    </div>
  `}).join("");

  // Edit button handlers / 编辑按钮处理器
  document.querySelectorAll(".btn-edit-expert").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const cmd = (e.target as HTMLElement).getAttribute("data-cmd");
      const entry = expertEntries.find(x => x.command === cmd);
      if (entry) {
        (document.getElementById("expert-cmd") as HTMLInputElement).value = entry.command;
        (document.getElementById("expert-title") as HTMLInputElement).value = entry.title;
        (document.getElementById("expert-kind") as HTMLSelectElement).value = entry.kind;
        (document.getElementById("expert-url") as HTMLInputElement).value = entry.url || "";
        (document.getElementById("expert-path") as HTMLInputElement).value = entry.path || "";
        document.getElementById("expert-entry-form")?.classList.add("active");
      }
    });
  });

  // Delete button handlers / 删除按钮处理器
  document.querySelectorAll(".btn-delete-expert").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const cmd = (e.target as HTMLElement).getAttribute("data-cmd");
      if (cmd) {
        await invoke("delete_entry", { namespace: "expert", key: cmd });
        showToast(t("delete_entry_success") || "条目已删除");
        loadAndRenderExpertEntries();
      }
    });
  });
}

/**
 * Setup expert mode settings UI handlers / 设置专家模式设置 UI 处理器
 */
function setupExpertSettingsUI() {
  // Refresh button / 刷新按钮
  document.getElementById("btn-refresh-expert")?.addEventListener("click", loadAndRenderExpertEntries);

  // Add button / 添加按钮
  document.getElementById("btn-add-expert")?.addEventListener("click", () => {
    (document.getElementById("expert-cmd") as HTMLInputElement).value = "";
    (document.getElementById("expert-title") as HTMLInputElement).value = "";
    (document.getElementById("expert-kind") as HTMLSelectElement).value = "website";
    (document.getElementById("expert-url") as HTMLInputElement).value = "";
    (document.getElementById("expert-path") as HTMLInputElement).value = "";
    document.getElementById("expert-entry-form")?.classList.add("active");
  });

  // Cancel button / 取消按钮
  document.getElementById("btn-cancel-expert")?.addEventListener("click", () => {
    document.getElementById("expert-entry-form")?.classList.remove("active");
  });

  // Save button / 保存按钮
  document.getElementById("btn-save-expert")?.addEventListener("click", async () => {
    const cmd = (document.getElementById("expert-cmd") as HTMLInputElement).value.trim();
    const title = (document.getElementById("expert-title") as HTMLInputElement).value.trim();
    const kind = (document.getElementById("expert-kind") as HTMLSelectElement).value;
    const url = (document.getElementById("expert-url") as HTMLInputElement).value.trim();
    const path = (document.getElementById("expert-path") as HTMLInputElement).value.trim();

    // Validation / 验证
    if (!cmd || !title) {
      showToast(t("empty_keyword"), true);
      return;
    }

    const entry: Entry = { command: cmd, title, kind };
    if (kind === "website") {
      if (!url) { showToast(t("empty_url"), true); return; }
      entry.url = url;
    } else if (kind === "app") {
      if (!path) { showToast(t("empty_path"), true); return; }
      entry.path = path;
    }

    try {
      await invoke("save_entry", { namespace: "expert", entry });
      showToast(t("save_success"));
      document.getElementById("expert-entry-form")?.classList.remove("active");
      loadAndRenderExpertEntries();
    } catch (e) {
      showToast(String(e), true);
    }
  });
}

// ============================================================================
// Global Click Handler / 全局点击处理
// ============================================================================

/**
 * Hide window on outside clicks. For a borderless transparent window the OS
 * dropshadow/chrome registers clicks on <body>/<html> — we ignore those.
 * 外部点击隐藏窗口。无边框透明窗口的投影/边框区域点击目标是 body/html → 跳过。
 */
document.addEventListener("click", (e) => {
  const target = e.target as Node;
  if (!document.contains(target)) return;
  // Clicks on document root / body fall on transparent window chrome of a
  // borderless window — they are NOT "outside" clicks. (#6)
  if (target === document.body || target === document.documentElement) return;
  if (
    !container.contains(target) &&
    !configWindow?.contains(target) &&
    !welcomeWindow?.contains(target)
  ) {
    invoke("hide_window");
  }
});

/**
 * Handle global keyboard shortcuts / 处理全局键盘快捷键
 * @description Escape key: close settings or hide window / Escape 键：关闭设置或隐藏窗口
 */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (settingsVisible) {
      hideConfigWindow();
    } else {
      invoke("hide_window");
    }
  }
});

// ============================================================================
// Settings Panel Event Handlers / 设置面板事件处理器
// ============================================================================

// Close buttons / 关闭按钮
document.getElementById("close-config")?.addEventListener("click", () => {
  hideConfigWindow();
});

document.getElementById("close-about-config")?.addEventListener("click", () => {
  hideConfigWindow();
});

// Language select / 语言选择
document.getElementById("lang-select")?.addEventListener("change", async (e) => {
  const lang = (e.target as HTMLSelectElement).value;
  setLanguage(lang);
  await invoke("save_config", { key: "global/language", value: lang });
  await updateTrayMenu();
  updateI18nUI();
  rebuildSettingsSearchIndex();
  const welcomeLangSelect = document.getElementById("welcome-lang-select") as HTMLSelectElement;
  if (welcomeLangSelect) welcomeLangSelect.value = lang;
});

// Welcome language select / 欢迎语言选择
document.getElementById("welcome-lang-select")?.addEventListener("change", async (e) => {
  const lang = (e.target as HTMLSelectElement).value;
  setLanguage(lang);
  await invoke("save_config", { key: "global/language", value: lang });
  await updateTrayMenu();
  updateI18nUI();
  rebuildSettingsSearchIndex();
  const langSelect = document.getElementById("lang-select") as HTMLSelectElement;
  if (langSelect) langSelect.value = lang;
});

// Theme select / 主题选择
document.getElementById("theme-select")?.addEventListener("change", async (e) => {
  const theme = (e.target as HTMLSelectElement).value;
  await invoke("save_config", { key: "global/theme", value: theme });
  applyTheme(theme);
});

// Mode select / 模式选择
document.getElementById("mode-select")?.addEventListener("change", async (e) => {
  const mode = (e.target as HTMLSelectElement).value;
  await invoke("set_mode", { mode });
  currentMode = mode as "expert" | "simple";
  await loadEntries();
  // Don't touch the launcher window while settings panel is open — it would
  // shrink the visible settings window from 700×500 to launcher dimensions.
  // hideConfigWindow re-renders the launcher in the new mode anyway.
  if (settingsVisible) return;
  if (currentMode === "simple") {
    collapsed = false;
    renderResults([]);
  } else {
    setCollapsed(true);
    renderResults([]);
  }
});

// ============================================================================
// Initialization / 初始化
// ============================================================================

/**
 * Main initialization function / 主初始化函数
 * Sets up event listeners, loads config, shows welcome if first launch
 * 设置事件监听器、加载配置、如果是首次启动则显示欢迎
 */
async function init() {
  const { listen } = await import("@tauri-apps/api/event");

  // Listen for show-settings event from tray / 监听来自托盘的 show-settings 事件
  listen("show-settings", () => {
    showConfigWindow("basic-settings");
  });

  // Listen for hotkey register failure / 监听热键注册失败事件
  listen("hotkey-register-failed", (event: any) => {
    const shortcut = event.payload || "Alt+Space";
    showToast(t("hotkey_register_failed").replace("{shortcut}", shortcut), true);
  });

  // Auto-focus search input whenever the window gains focus (e.g. via hotkey).
  // 窗口获得焦点时自动聚焦搜索框（比如按快捷键唤出）。
  getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) {
      searchInput?.focus();
      searchInput?.select();
    }
  });

  // Initialize i18n and load data / 初始化 i18n 并加载数据
  await initI18n();
  await updateTrayMenu();
  await loadConfig();
  await loadEntries();
  await initSettingsUI();
  await setupWelcomeWizard();

  updateI18nUI();

  // Show welcome if first launch / 如果是首次启动则显示欢迎
  const hasLaunched = await invoke<boolean>("get_has_launched").catch(() => false);
  if (!hasLaunched) {
    showWelcomeWindow();
  } else {
    if (currentMode === "simple") {
      collapsed = false;
      renderResults([]);
    } else {
      setCollapsed(true);
      renderResults([]);
    }
  }

  // Wire user-resize → persist (#feature-1).
  // 监听用户拖拽改变窗口大小 → 写入对应状态的持久化尺寸。
  const win = getCurrentWindow();
  const scaleFactor = await win.scaleFactor();
  let saveTimer: number | null = null;
  win.onResized(({ payload }) => {
    const w = payload.width / scaleFactor;
    const h = payload.height / scaleFactor;
    // Skip echoes from our own resize_window calls (within 2px tolerance).
    // 跳过自己 resize_window 触发的回声事件。
    if (
      lastProgrammaticSize &&
      Math.abs(lastProgrammaticSize.w - w) < 2 &&
      Math.abs(lastProgrammaticSize.h - h) < 2
    ) {
      return;
    }
    persistedSizes[currentWindowState] = [w, h];
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      invoke("save_config", { key: "global/window_sizes", value: persistedSizes }).catch(() => {});
    }, 400);
  });

  // Reveal window now that initial state, size, and content are settled.
  // 全部 init 完成、首帧渲染后再显示窗口，消除 600×40 默认尺寸闪烁。
  // Flush the debounced resize so the window opens at the correct size,
  // not the OS default 600×40 (would cause a one-frame flash on show).
  if (resizeTimer !== null && lastProgrammaticSize) {
    clearTimeout(resizeTimer);
    resizeTimer = null;
    await invoke("resize_window", {
      width: lastProgrammaticSize.w,
      height: lastProgrammaticSize.h,
    }).catch(() => {});
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await win.show();
  await win.setFocus();
}

/**
 * Initialize settings UI components / 初始化设置 UI 组件
 */
async function initSettingsUI() {
  try {
    const config = await invoke<AppConfig>("get_config");

    // Initialize selects / 初始化选择器
    const langSelect = document.getElementById("lang-select") as HTMLSelectElement;
    if (langSelect) langSelect.value = config.language || "zh";

    const welcomeLangSelect = document.getElementById("welcome-lang-select") as HTMLSelectElement;
    if (welcomeLangSelect) welcomeLangSelect.value = config.language || "zh";

    const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
    if (themeSelect) themeSelect.value = config.theme || "system";

    const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
    if (modeSelect) modeSelect.value = config.mode || "expert";

    // Browser select / 浏览器选择
    const browserSelect = document.getElementById("browser-select") as HTMLSelectElement;
    if (browserSelect) {
      try {
        const browsers = await invoke<BrowserInfo[]>("list_browsers");
        browserSelect.innerHTML = `<fluent-option value="">${escapeHtml(t("system"))}</fluent-option>` + browsers.map(b => `<fluent-option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</fluent-option>`).join("");
        browserSelect.value = config.default_browser || "";
      } catch (e) {
        console.error("Failed to list browsers:", e);
        browserSelect.innerHTML = `<fluent-option value="">${escapeHtml(t("system"))}</fluent-option>`;
      }

      browserSelect.addEventListener("change", async (e) => {
        const browserId = (e.target as HTMLSelectElement).value;
        await invoke("save_config", { key: "global/default_browser", value: browserId });
        showToast(t("browser_updated"));
      });
    }

    // Custom browser add / 添加自定义浏览器
    const btnSelectBrowserPath = document.getElementById("btn-select-browser-path");
    const btnAddCustomBrowser = document.getElementById("btn-add-custom-browser");
    const customBrowserName = document.getElementById("custom-browser-name") as HTMLInputElement;
    const customBrowserPath = document.getElementById("custom-browser-path") as HTMLInputElement;

    if (btnSelectBrowserPath && btnAddCustomBrowser && customBrowserName && customBrowserPath) {
      // File picker for browser executable / 浏览器可执行文件的文件选择器
      btnSelectBrowserPath.addEventListener("click", async () => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          filters: [{ name: "Executable", extensions: ["exe"] }]
        });
        if (selected && typeof selected === "string") {
          customBrowserPath.value = selected;
          // Auto-fill name from filename / 从文件名自动填充名称
          if (!customBrowserName.value) {
            const fileName = selected.split('\\').pop()?.split('/').pop() || "";
            customBrowserName.value = fileName.replace(".exe", "");
          }
        }
      });

      // Add custom browser / 添加自定义浏览器
      btnAddCustomBrowser.addEventListener("click", async () => {
        const name = customBrowserName.value.trim();
        const path = customBrowserPath.value.trim();
        if (!name || !path) {
          showToast(t("empty_browser"), true);
          return;
        }
        try {
          // Backend returns the id of the newly added browser so we don't have to
          // guess via list ordering. (#11)
          const newId = await invoke<string>("add_custom_browser", { name, path });
          showToast(t("add_browser_success"));
          customBrowserName.value = "";
          customBrowserPath.value = "";
          if (browserSelect) {
            const browsers = await invoke<BrowserInfo[]>("list_browsers");
            browserSelect.innerHTML = `<fluent-option value="">${escapeHtml(t("system"))}</fluent-option>` + browsers.map(b => `<fluent-option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</fluent-option>`).join("");
            browserSelect.value = newId;
            await invoke("save_config", { key: "global/default_browser", value: newId });
          }
        } catch (e) {
          showToast(String(e), true);
        }
      });
    }

    // Export/Import config — both go through native OS dialogs (#feature-import-export).
    document.getElementById("btn-export-config")?.addEventListener("click", exportConfigToFile);
    document.getElementById("btn-import-config")?.addEventListener("click", importConfigFromFile);

    // Hotkey input / 热键输入
    const hotkeyInput = document.getElementById("hotkey-input") as HTMLInputElement;
    if (hotkeyInput) {
      hotkeyInput.value = config.shortcut || "Alt+Space";

      let hotkeyInputFocused = false;

      hotkeyInput.addEventListener("focus", () => { hotkeyInputFocused = true; });
      hotkeyInput.addEventListener("blur", () => { hotkeyInputFocused = false; });

      document.addEventListener("keydown", async (e) => {
        if (!hotkeyInputFocused) return;
        e.preventDefault();
        e.stopPropagation();

        const mods: string[] = [];
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        if (e.metaKey) mods.push("Win");

        let key = e.key;
        if (key === " ") key = "Space";
        if (key === "Control" || key === "Alt" || key === "Shift" || key === "Meta") return;

        if (mods.length === 0) return;

        const shortcutStr = [...mods, key.toUpperCase()].join("+");

        try {
          const isConflict = await invoke<boolean>("check_hotkey_conflict", { modifiers: mods, key });
          if (isConflict) {
            showToast(t("hotkey_conflict"), true);
            return;
          }

          hotkeyInput.value = shortcutStr;
          await invoke("register_hotkey", { modifiers: mods, key });
          await invoke("save_config", { key: "global/shortcut", value: shortcutStr });
          showToast(t("hotkey_updated"));
        } catch (err) {
          showToast(t("hotkey_conflict"), true);
        }
      });
    }

    // Background image upload / 背景图片上传
    const btnUploadBg = document.getElementById("btn-upload-bg");
    const btnClearBg = document.getElementById("btn-clear-bg");
    const bgUploadInput = document.getElementById("bg-upload-input") as HTMLInputElement;

    if (btnUploadBg && bgUploadInput) {
      btnUploadBg.addEventListener("click", () => {
        bgUploadInput.click();
      });

      bgUploadInput.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = event.target?.result as string;
          await invoke("save_config", { key: "global/bg_image", value: base64 });
          if (configWindow) {
            configWindow.style.backgroundImage = `url(${base64})`;
            configWindow.style.backgroundColor = "transparent";
          }
          if (document.body.dataset.simpleBg === "true" && container) {
            container.style.backgroundImage = `url(${base64})`;
          }
          showToast(t("bg_updated"));
        };
        reader.readAsDataURL(file);
      });
    }

    if (btnClearBg) {
      btnClearBg.addEventListener("click", async () => {
        await invoke("save_config", { key: "global/bg_image", value: "" });
        if (configWindow) {
          configWindow.style.backgroundImage = "none";
          configWindow.style.backgroundColor = "";
        }
        if (container) {
          container.style.backgroundImage = "none";
        }
        if (bgUploadInput) {
          bgUploadInput.value = "";
        }
        showToast(t("bg_cleared"));
      });
    }

    // Background blur slider / 背景模糊滑块
    const bgBlurSlider = document.getElementById("bg-blur-slider") as HTMLInputElement;
    if (bgBlurSlider) {
      bgBlurSlider.value = (config.bg_blur ?? 20).toString();
      bgBlurSlider.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        document.documentElement.style.setProperty("--bg-blur", `${val}px`);
      });
      bgBlurSlider.addEventListener("change", async (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        await invoke("save_config", { key: "global/bg_blur", value: val });
      });
    }

    // Background opacity slider / 背景不透明度滑块
    const bgOpacitySlider = document.getElementById("bg-opacity-slider") as HTMLInputElement;
    if (bgOpacitySlider) {
      bgOpacitySlider.value = (config.bg_opacity ?? 60).toString();
      bgOpacitySlider.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        document.documentElement.style.setProperty("--bg-opacity", `${parseInt(val) / 100}`);
      });
      bgOpacitySlider.addEventListener("change", async (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        await invoke("save_config", { key: "global/bg_opacity", value: val });
      });
    }

    // Search opacity slider / 搜索不透明度滑块
    const searchOpacitySlider = document.getElementById("search-opacity-slider") as HTMLInputElement;
    if (searchOpacitySlider) {
      searchOpacitySlider.value = (config.search_opacity ?? 100).toString();
      searchOpacitySlider.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value;
        document.documentElement.style.setProperty("--search-opacity", `${parseInt(val) / 100}`);
      });
      searchOpacitySlider.addEventListener("change", async (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        await invoke("save_config", { key: "global/search_opacity", value: val });
      });
    }

    // Simple mode background toggle / 简单模式背景开关
    const simpleBgCheckbox = document.getElementById("simple-bg-checkbox") as any;
    if (simpleBgCheckbox) {
      const applySimpleBg = (enabled: boolean) => {
        if (enabled) {
          document.body.dataset.simpleBg = "true";
          if (container && configWindow) {
            const bg = configWindow.style.backgroundImage;
            if (bg && bg !== "none") {
              container.style.backgroundImage = bg;
            }
          }
        } else {
          delete document.body.dataset.simpleBg;
          if (container) {
            container.style.backgroundImage = "none";
          }
        }
      };
      simpleBgCheckbox.checked = config.simple_bg_enabled === true;
      applySimpleBg(config.simple_bg_enabled === true);
      simpleBgCheckbox.addEventListener("change", async (e: any) => {
        const enabled = e.target.checked === true;
        await invoke("save_config", { key: "global/simple_bg_enabled", value: enabled });
        applySimpleBg(enabled);
        showToast(t("save_success"));
      });
    }

    // Setup settings UI handlers / 设置 UI 处理器
    setupSimpleSettingsUI();
    setupExpertSettingsUI();
  } catch (e) {
    console.error("Failed to init settings UI:", e);
  }
  // Settings search is independent of the config-loading pipeline above,
  // so it stays outside the try/catch — a failure earlier shouldn't kill it.
  setupSettingsSearch();
}

// ============================================================================
// Settings Search / 设置搜索
// ============================================================================

/**
 * Index of searchable settings items. Rebuilt on language switch so labels
 * reflect the current locale. Each entry maps a translated label back to its
 * containing panel + DOM element, enabling click-to-navigate.
 * 设置搜索索引 — 语言切换时重建以匹配当前语言。
 */
type SettingsSearchEntry = {
  panelId: string;
  key: string;
  label: string;
  el: HTMLElement;
};
let settingsSearchIndex: SettingsSearchEntry[] = [];

function rebuildSettingsSearchIndex() {
  settingsSearchIndex = [];
  document.querySelectorAll<HTMLElement>("#config-window .content-panel").forEach((panel) => {
    panel.querySelectorAll<HTMLElement>(".setting-item").forEach((item) => {
      const labelEl = item.querySelector<HTMLElement>(".setting-label[data-i18n]");
      const key = labelEl?.dataset.i18n;
      if (!key) return;
      settingsSearchIndex.push({ panelId: panel.id, key, label: t(key), el: item });
    });
  });
}

function setupSettingsSearch() {
  const searchInput = document.getElementById("settings-search") as HTMLInputElement | null;
  const dropdown = document.getElementById("settings-search-results");
  if (!searchInput || !dropdown) return;

  rebuildSettingsSearchIndex();

  const closeDropdown = () => {
    dropdown.innerHTML = "";
    dropdown.classList.remove("visible");
  };

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      closeDropdown();
      return;
    }
    const hits = settingsSearchIndex
      .filter((e) => e.label.toLowerCase().includes(q))
      .slice(0, 10);
    if (hits.length === 0) {
      closeDropdown();
      return;
    }
    dropdown.innerHTML = hits
      .map(
        (h, i) =>
          `<div class="settings-search-item" data-idx="${i}">${escapeHtml(h.label)}</div>`,
      )
      .join("");
    dropdown.classList.add("visible");

    dropdown.querySelectorAll<HTMLElement>(".settings-search-item").forEach((node, i) => {
      node.addEventListener("click", () => {
        const hit = hits[i];
        if (!hit) return;
        switchSidebar(hit.panelId);
        // Defer scrollIntoView until panel becomes active (display change settles).
        // 延后到面板切换完成再滚动 + 高亮。
        setTimeout(() => {
          hit.el.scrollIntoView({ behavior: "smooth", block: "center" });
          hit.el.classList.add("settings-search-flash");
          setTimeout(() => hit.el.classList.remove("settings-search-flash"), 1500);
        }, 50);
        searchInput.value = "";
        closeDropdown();
      });
    });
  });

  // Close on blur (with small delay so dropdown click registers first).
  // 失焦关闭，留 150ms 给 dropdown click 事件冒泡。
  searchInput.addEventListener("blur", () => {
    setTimeout(closeDropdown, 150);
  });

  // Close on Escape.
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      closeDropdown();
      searchInput.blur();
    }
  });
}

/**
 * Setup Welcome wizard event handlers / 设置欢迎向导事件处理器
 * Extracted from initSettingsUI to survive settings initialization failures
 * 从 initSettingsUI 中提取，确保设置初始化失败时 Welcome 向导仍可工作
 */
async function setupWelcomeWizard() {
  let currentWelcomeSlide = 1;
  const totalWelcomeSlides = 6;

  const updateWelcomeSlides = () => {
    document.querySelectorAll(".welcome-slide").forEach(slide => {
      slide.classList.remove("active");
    });
    document.getElementById(`slide-${currentWelcomeSlide}`)?.classList.add("active");

    document.querySelectorAll(".welcome-dots .dot").forEach((dot, index) => {
      dot.classList.toggle("active", index === currentWelcomeSlide - 1);
    });

    const btnPrev = document.getElementById("btn-welcome-prev") as any;
    const btnNext = document.getElementById("btn-welcome-next") as any;

    if (btnPrev) btnPrev.disabled = currentWelcomeSlide === 1;
    if (btnNext) {
      if (currentWelcomeSlide === totalWelcomeSlides) {
        btnNext.style.display = "none";
      } else {
        btnNext.style.display = "inline-flex";
      }
    }
  };

  document.getElementById("btn-welcome-prev")?.addEventListener("click", () => {
    if (currentWelcomeSlide > 1) {
      currentWelcomeSlide--;
      updateWelcomeSlides();
    }
  });

  document.getElementById("btn-welcome-next")?.addEventListener("click", () => {
    if (currentWelcomeSlide < totalWelcomeSlides) {
      currentWelcomeSlide++;
      updateWelcomeSlides();
    }
  });

  try {
    const config = await invoke<AppConfig>("get_config");

    const modeGroup = document.getElementById("welcome-mode-group") as any;
    if (modeGroup) {
      modeGroup.value = config.mode;
      modeGroup.addEventListener("change", async (e: any) => {
        const mode = e.target.value;
        if (mode) {
          await invoke("set_mode", { mode });
          currentMode = mode as "expert" | "simple";
          await loadEntries();
          const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
          if (modeSelect) modeSelect.value = mode;
          showToast(`${t("mode_selected")}${t(mode === "simple" ? "simple_mode" : "expert_mode")}`);
        }
      });
    }

    document.querySelectorAll(".btn-welcome-theme").forEach(btn => {
      if (btn.getAttribute("data-theme") === (config.theme || "system")) {
        btn.setAttribute("appearance", "accent");
      } else {
        btn.removeAttribute("appearance");
      }
    });

    document.querySelectorAll(".btn-welcome-theme").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const theme = (e.currentTarget as HTMLElement).getAttribute("data-theme");
        if (theme) {
          await invoke("save_config", { key: "global/theme", value: theme });
          applyTheme(theme);
          const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
          if (themeSelect) themeSelect.value = theme;
          showToast(`${t("mode_selected")}${t(theme === "light" ? "light_mode" : theme === "dark" ? "dark_mode" : "system")}`);
          document.querySelectorAll(".btn-welcome-theme").forEach(b => b.removeAttribute("appearance"));
          (e.currentTarget as HTMLElement).setAttribute("appearance", "accent");
        }
      });
    });
  } catch (e) {
    console.error("Failed to init welcome wizard config:", e);
  }

  const btnFinishWelcome = document.getElementById("btn-finish-welcome");
  if (btnFinishWelcome) {
    btnFinishWelcome.addEventListener("click", async () => {
      await invoke("mark_launched");
      hideWelcomeWindow();
      if (currentMode === "simple") {
        collapsed = false;
        renderResults([]);
      } else {
        setCollapsed(true);
        renderResults([]);
      }
      showToast(t("press_alt_space"));
    });
  }

  const btnClearLaunched = document.getElementById("btn-clear-launched");
  if (btnClearLaunched) {
    btnClearLaunched.addEventListener("click", async () => {
      await invoke("unmark_launched");
      showToast(t("clear_launched_success"));
      setTimeout(() => {
        location.reload();
      }, 1500);
    });
  }
}

/**
 * Update tray menu labels with i18n / 用 i18n 更新托盘菜单标签
 */
async function updateTrayMenu() {
  try {
    await invoke("update_tray_menu", {
      show: t("show") || "显示",
      settings: t("setting"),
      quit: t("quit") || "退出"
    });
  } catch (e) {
    console.error("Failed to update tray menu:", e);
  }
}

// ============================================================================
// Start Application / 启动应用
// ============================================================================

init();