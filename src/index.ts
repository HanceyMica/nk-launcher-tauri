import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initI18n, t, setLanguage } from "./i18n/index";
import {
  provideFluentDesignSystem,
  fluentSelect,
  fluentOption,
  fluentTextField,
  fluentButton
} from "@fluentui/web-components";

provideFluentDesignSystem().register(
  fluentSelect(),
  fluentOption(),
  fluentTextField(),
  fluentButton()
);

export interface Entry {
  command: string;
  kind: string;
  title: string;
  url?: string;
  path?: string;
}

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
}

export interface BrowserInfo {
  id: string;
  name: string;
  exe_path?: string;
}

let currentMode: "expert" | "simple" = "expert";
let entries: Entry[] = [];
let searchQuery = "";
let commandMode = false;
let selectedIndex = 0;
let collapsed = true;
let settingsVisible = false;
let aboutVisible = false;

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const resultList = document.getElementById("result-list") as HTMLDivElement;
const container = document.getElementById("container") as HTMLDivElement;
const configWindow = document.getElementById("config-window") as HTMLDivElement;

function showConfigWindow(targetId: string = "basic-settings") {
  settingsVisible = true;
  if (configWindow) configWindow.classList.add("visible");
  if (container) container.style.display = "none";
  invoke("resize_window", { width: 700.0, height: 500.0 });
  switchSidebar(targetId);
}

function hideConfigWindow() {
  settingsVisible = false;
  if (configWindow) configWindow.classList.remove("visible");
  if (container) container.style.display = "block";
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

function switchSidebar(targetId: string) {
  document.querySelectorAll(".sidebar-item").forEach(item => {
    item.classList.toggle("active", item.getAttribute("data-target") === targetId);
  });
  document.querySelectorAll(".content-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === targetId);
  });

  if (targetId === "simple-settings") {
    loadAndRenderSimpleEntries();
  } else if (targetId === "expert-settings") {
    loadAndRenderExpertEntries();
  }
}

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

document.querySelectorAll(".sidebar-item").forEach(item => {
  item.addEventListener("click", () => {
    const target = item.getAttribute("data-target");
    if (target) switchSidebar(target);
  });
});
async function loadConfig() {
  try {
    const config = await invoke<AppConfig>("get_config");
    currentMode = config.mode as "expert" | "simple";
    if (config.theme === "dark") {
      document.body.dataset.theme = "dark";
    } else if (config.theme === "light") {
      document.body.dataset.theme = "light";
    } else {
      delete document.body.dataset.theme;
    }
    setLanguage(config.language || "zh");
    
    if (config.bg_image) {
      if (configWindow) {
        configWindow.style.backgroundImage = `url(${config.bg_image})`;
        configWindow.style.backgroundColor = "transparent";
      }
    } else {
      if (configWindow) {
        configWindow.style.backgroundImage = "none";
        configWindow.style.backgroundColor = "";
      }
    }
    
    // Apply blur & opacity
    const blur = config.bg_blur !== undefined ? config.bg_blur : 20;
    const opacity = config.bg_opacity !== undefined ? config.bg_opacity : 60;
    const searchOpacity = config.search_opacity !== undefined ? config.search_opacity : 100;
    currentSearchWidth = config.search_width !== undefined ? config.search_width : 600.0;
    
    document.documentElement.style.setProperty("--bg-blur", `${blur}px`);
    document.documentElement.style.setProperty("--bg-opacity", `${opacity / 100}`);
    document.documentElement.style.setProperty("--search-opacity", `${searchOpacity / 100}`);

    if (currentMode === "expert" && collapsed && !settingsVisible) {
      invoke("resize_window", { width: currentSearchWidth, height: 40.0 });
    }





      const searchWidthSlider = document.getElementById("search-width-slider") as HTMLInputElement;
      if (searchWidthSlider) {
        searchWidthSlider.value = config.search_width !== undefined ? config.search_width.toString() : "600";
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

async function loadEntries() {
  const namespace = currentMode === "expert" ? "expert" : "simple";
  try {
    entries = await invoke<Entry[]>("get_entries", { namespace });
  } catch (e) {
    console.error("Failed to load entries:", e);
    entries = [];
  }
}

async function searchEntries(query: string): Promise<Entry[]> {
  if (!query.trim()) return [];
  return await invoke<Entry[]>("fuzzy_search", { query, entries });
}

let currentSearchWidth = 600.0;

function setCollapsed(collapse: boolean) {
  collapsed = collapse;
  if (collapse) {
    if (currentMode === "simple") {
      invoke("resize_window", { width: 300.0, height: 40.0 });
    } else {
      invoke("resize_window", { width: currentSearchWidth, height: 40.0 });
    }
  }
}

// Replaced by showConfigWindow


searchInput?.addEventListener("input", async (e) => {
  searchQuery = (e.target as HTMLInputElement).value;
  commandMode = searchQuery.startsWith("/");
  selectedIndex = 0;

  if (commandMode) {
    renderCommandSuggestions();
  } else if (currentMode === "simple" && /^[1-9]{1,2}$/.test(searchQuery)) {
    const entry = entries.find(e => e.command === searchQuery);
    if (searchQuery.length === 1 && entry?.kind === "subgrid") {
      collapsed = false;
      renderSimpleGrid(searchQuery);
    } else {
      if (entry && entry.kind !== "subgrid") {
        collapsed = false;
        renderResults([entry]);
      } else {
        renderResults([]);
      }
    }
  } else if (collapsed && searchQuery.length > 0) {
    const results = await searchEntries(searchQuery);
    if (results.length > 0) {
      collapsed = false;
    }
    renderResults(results);
  } else if (!searchQuery) {
    if (currentMode === "simple") {
      collapsed = false;
      renderSimpleGrid();
    } else {
      setCollapsed(true);
      renderResults([]);
    }
  } else {
    const results = await searchEntries(searchQuery);
    renderResults(results);
  }
});

searchInput?.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    if (commandMode) {
      await executeCommand(searchQuery.slice(1));
    } else {
      const results = await searchEntries(searchQuery);
      if (results[selectedIndex]) {
        await executeEntry(results[selectedIndex]);
      }
    }
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
    selectedIndex = Math.min(selectedIndex + 1, entries.length - 1);
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

function renderCommandSuggestions() {
  const commands = [
    { cmd: "s", label: t("setting"), action: () => showConfigWindow("settings-content") },
    { cmd: "d", label: t("dark"), action: async () => { await invoke("save_config", { key: "global/theme", value: "dark" }); document.body.dataset.theme = "dark"; } },
    { cmd: "l", label: t("light"), action: async () => { await invoke("save_config", { key: "global/theme", value: "light" }); document.body.dataset.theme = "light"; } },
    { cmd: "w", label: t("system"), action: async () => { await invoke("save_config", { key: "global/theme", value: "system" }); delete document.body.dataset.theme; } },
    { cmd: "i", label: t("import"), action: () => {
      const configImportInput = document.getElementById("config-import-input") as HTMLInputElement;
      if (configImportInput) configImportInput.click();
    } },
    { cmd: "o", label: t("export"), action: async () => { const json = await invoke<string>("export_config"); downloadJson(json); } },
    { cmd: "a", label: t("about"), action: () => showConfigWindow("about-content") },
  ];

  const filtered = commands.filter(c => c.cmd.startsWith(searchQuery.slice(1).toLowerCase()));
  const html = filtered.map((c, i) => `<div class="result-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">/${c.cmd} → ${c.label}</div>`).join("");
  resultList.innerHTML = html;

  const targetWidth = currentMode === "simple" ? 300.0 : currentSearchWidth;
  const height = Math.min(40 + filtered.length * 36, 400);
  invoke("resize_window", { width: targetWidth, height: height });

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

async function executeCommand(cmd: string) {
  const commands: Record<string, () => Promise<void>> = {
    s: () => { showConfigWindow("settings-content"); return Promise.resolve(); },
    d: async () => { await invoke("save_config", { key: "global/theme", value: "dark" }); document.body.dataset.theme = "dark"; },
    l: async () => { await invoke("save_config", { key: "global/theme", value: "light" }); document.body.dataset.theme = "light"; },
    w: async () => { await invoke("save_config", { key: "global/theme", value: "system" }); delete document.body.dataset.theme; },
    i: () => {
      const configImportInput = document.getElementById("config-import-input") as HTMLInputElement;
      if (configImportInput) configImportInput.click();
      return Promise.resolve();
    },
    o: async () => { const json = await invoke<string>("export_config"); downloadJson(json); },
    a: () => { showConfigWindow("about-content"); return Promise.resolve(); },
  };

  if (commands[cmd]) {
    await commands[cmd]();
  }
}

function downloadJson(json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nk-launcher-config.json";
  a.click();
  URL.revokeObjectURL(url);
}

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

function renderResults(results: Entry[]) {
  if (results.length === 0) {
    if (currentMode === "simple" && !searchQuery) {
      renderSimpleGrid();
    } else {
      resultList.innerHTML = "";
      if (currentMode === "simple" && searchQuery) {
        invoke("resize_window", { width: 300.0, height: 40.0 });
      }
    }
    return;
  }

  // Always resize window for results
  const targetWidth = currentMode === "simple" ? 300.0 : currentSearchWidth;
  const height = Math.min(40 + results.length * 36, 400);
  invoke("resize_window", { width: targetWidth, height: height });

  const html = results.map((entry, i) => {
    const icon = entry.kind === "website" ? "🌐" : "📦";
    const desc = entry.url || entry.path || "";
    return `<div class="result-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">${icon} ${entry.title}<span class="desc">${desc}</span></div>`;
  }).join("");

  resultList.innerHTML = html;

  document.querySelectorAll(".result-item").forEach((item, i) => {
    item.addEventListener("mouseenter", () => {
      selectedIndex = i;
      updateSelection();
    });
    item.addEventListener("click", async () => {
      const results = await searchEntries(searchQuery);
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

function renderSimpleGrid(prefix: string = "") {
  invoke("resize_window", { width: 300.0, height: 234.0 });
  
  // Fill 1-9
  let html = `<div id="nine-grid">`;
  for (let i = 1; i <= 9; i++) {
    const cmd = prefix + String(i);
    const entry = entries.find(e => e.command === cmd);
    const name = entry ? entry.title : "未设置";
    let icon = "➕";
    if (entry) {
      if (entry.kind === "website") icon = "🌐";
      else if (entry.kind === "app") icon = "📦";
      else if (entry.kind === "subgrid") icon = "📁";
    }
    html += `
      <div class="grid-item" data-cmd="${cmd}">
        <span class="number">${i}</span>
        <span class="icon">${icon}</span>
        <span class="name" title="${name}">${name}</span>
      </div>
    `;
  }
  html += `</div>`;
  
  html += `<div id="simple-actions">
    <fluent-button id="btn-settings" appearance="stealth">${t("setting")}</fluent-button>
    <fluent-button id="btn-theme" appearance="stealth">${t("theme")}</fluent-button>
    <fluent-button id="btn-about" appearance="stealth">${t("about")}</fluent-button>
  </div>`;
  
  resultList.innerHTML = html;

  document.querySelectorAll(".grid-item").forEach((item) => {
    item.addEventListener("click", () => {
      const cmd = item.getAttribute("data-cmd");
      if (cmd) {
        searchInput.value = cmd;
        searchQuery = cmd;
        searchInput.dispatchEvent(new Event("input"));
      }
    });
  });

  document.getElementById("btn-settings")?.addEventListener("click", () => showConfigWindow("settings-content"));
  document.getElementById("btn-about")?.addEventListener("click", () => showConfigWindow("about-content"));
  document.getElementById("btn-theme")?.addEventListener("click", async () => {
    const currentTheme = document.body.dataset.theme;
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    await invoke("save_config", { key: "global/theme", value: newTheme });
    document.body.dataset.theme = newTheme;
    const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
    if (themeSelect) themeSelect.value = newTheme;
  });
}

let simpleEntries: Entry[] = [];
let expertEntries: Entry[] = [];
let currentSimpleGridLevel = "main"; // "main" or "1", "2"... "9"

async function loadAndRenderSimpleEntries() {
  simpleEntries = await invoke<Entry[]>("get_entries", { namespace: "simple" });
  updateSimpleGridLevelOptions();
  renderSimpleSettingsGrid();
}

function renderSimpleSettingsGrid() {
  const gridContainer = document.getElementById("simple-settings-grid");
  if (!gridContainer) return;

  const prefix = currentSimpleGridLevel === "main" ? "" : currentSimpleGridLevel;
  let html = "";

  for (let i = 1; i <= 9; i++) {
    const cmd = prefix + String(i);
    const entry = simpleEntries.find(e => e.command === cmd);
    
    let kindBadge = "未配置";
    let title = "点击配置";
    let desc = "";
    let badgeClass = "";

    if (entry) {
      if (entry.kind === "website") {
        kindBadge = "网址";
        desc = entry.url || "";
      } else if (entry.kind === "app") {
        kindBadge = "应用";
        desc = entry.path || "";
      } else if (entry.kind === "subgrid") {
        kindBadge = "套娃格子";
        badgeClass = "subgrid";
        desc = "子网格包含9个格子，不可再嵌套";
      }
      title = entry.title;
    }

    html += `
      <div class="settings-grid-item" data-cmd="${cmd}">
        <div class="settings-grid-item-header">
          <span>格子 ${i}</span>
          <span class="settings-grid-item-badge ${badgeClass}">${kindBadge}</span>
        </div>
        <div class="settings-grid-item-content">
          <span class="settings-grid-item-title">${title}</span>
          <span class="settings-grid-item-desc">${desc}</span>
        </div>
      </div>
    `;
  }
  
  gridContainer.innerHTML = html;

  document.querySelectorAll(".settings-grid-item").forEach(item => {
    item.addEventListener("click", (e) => {
      document.querySelectorAll(".settings-grid-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      
      const cmd = item.getAttribute("data-cmd") || "";
      const entry = simpleEntries.find(x => x.command === cmd);
      
      const form = document.getElementById("simple-entry-form");
      const titleEl = document.getElementById("simple-entry-form-title");
      if (form && titleEl) {
        titleEl.textContent = `编辑格子 ${cmd}`;
        (document.getElementById("simple-cmd") as HTMLInputElement).value = cmd;
        (document.getElementById("simple-title") as HTMLInputElement).value = entry?.title || "";
        (document.getElementById("simple-kind") as HTMLSelectElement).value = entry?.kind || "website";
        (document.getElementById("simple-url") as HTMLInputElement).value = entry?.url || "";
        (document.getElementById("simple-path") as HTMLInputElement).value = entry?.path || "";
        form.classList.add("active");
        
        // Hide delete button if no entry exists
        const btnDelete = document.getElementById("btn-delete-simple");
        if (btnDelete) {
          btnDelete.style.display = entry ? "block" : "none";
        }

        // Toggle URL/Path inputs based on kind
        const kindSelect = document.getElementById("simple-kind") as HTMLSelectElement;
        const urlInput = document.getElementById("simple-url") as HTMLInputElement;
        const pathInput = document.getElementById("simple-path") as HTMLInputElement;

        const updateVisibility = () => {
          urlInput.style.display = kindSelect.value === "website" ? "block" : "none";
          pathInput.style.display = kindSelect.value === "app" ? "block" : "none";
        };

        updateVisibility();
        kindSelect.removeEventListener("change", updateVisibility);
        kindSelect.addEventListener("change", updateVisibility);
      }
    });
  });
}

function updateSimpleGridLevelOptions() {
  const select = document.getElementById("simple-grid-level-select") as HTMLSelectElement;
  if (!select) return;

  // keep main option
  let html = `<fluent-option value="main">主网格</fluent-option>`;
  
  // Find all subgrids
  const subgrids = simpleEntries.filter(e => e.kind === "subgrid" && e.command.length === 1);
  subgrids.forEach(sg => {
    html += `<fluent-option value="${sg.command}">子网格: ${sg.title} (${sg.command})</fluent-option>`;
  });
  
  select.innerHTML = html;
  
  // ensure current level is still valid
  if (currentSimpleGridLevel !== "main" && !subgrids.find(sg => sg.command === currentSimpleGridLevel)) {
    currentSimpleGridLevel = "main";
  }
  select.value = currentSimpleGridLevel;
}

function setupSimpleSettingsUI() {
  const levelSelect = document.getElementById("simple-grid-level-select") as HTMLSelectElement;
  if (levelSelect) {
    levelSelect.addEventListener("change", (e) => {
      currentSimpleGridLevel = (e.target as HTMLSelectElement).value;
      document.getElementById("simple-entry-form")?.classList.remove("active");
      renderSimpleSettingsGrid();
    });
  }

  document.getElementById("btn-cancel-simple")?.addEventListener("click", () => {
    document.getElementById("simple-entry-form")?.classList.remove("active");
    document.querySelectorAll(".settings-grid-item").forEach(el => el.classList.remove("active"));
  });

  document.getElementById("btn-delete-simple")?.addEventListener("click", async () => {
    const cmd = (document.getElementById("simple-cmd") as HTMLInputElement).value;
    if (cmd) {
      await invoke("delete_entry", { namespace: "simple", key: cmd });
      
      // Also delete all child entries if it's a subgrid
      const entry = simpleEntries.find(e => e.command === cmd);
      if (entry && entry.kind === "subgrid") {
        for (let i = 1; i <= 9; i++) {
          await invoke("delete_entry", { namespace: "simple", key: cmd + String(i) });
        }
      }

      // If we delete a subgrid that we are currently viewing, switch to main
      if (cmd === currentSimpleGridLevel) {
        currentSimpleGridLevel = "main";
      }

      showToast("格子已清空");
      document.getElementById("simple-entry-form")?.classList.remove("active");
      await loadAndRenderSimpleEntries();
      updateSimpleGridLevelOptions();
    }
  });

  document.getElementById("btn-save-simple")?.addEventListener("click", async () => {
    const cmd = (document.getElementById("simple-cmd") as HTMLInputElement).value.trim();
    const title = (document.getElementById("simple-title") as HTMLInputElement).value.trim();
    const kind = (document.getElementById("simple-kind") as HTMLSelectElement).value;
    const url = (document.getElementById("simple-url") as HTMLInputElement).value.trim();
    const path = (document.getElementById("simple-path") as HTMLInputElement).value.trim();

    if (!cmd || !title) {
      showToast("显示名称不能为空", true);
      return;
    }

    const entry: Entry = { command: cmd, title, kind };
    if (kind === "website") {
      if (!url) { showToast("网站类型的 URL 不能为空", true); return; }
      entry.url = url;
    } else if (kind === "app") {
      if (!path) { showToast("应用类型的路径不能为空", true); return; }
      entry.path = path;
    }

    try {
      await invoke("save_entry", { namespace: "simple", entry });
      showToast("保存成功");
      document.getElementById("simple-entry-form")?.classList.remove("active");
      await loadAndRenderSimpleEntries();
      updateSimpleGridLevelOptions();
    } catch (e) {
      showToast(String(e), true);
    }
  });
}

async function loadAndRenderExpertEntries() {
  expertEntries = await invoke<Entry[]>("get_entries", { namespace: "expert" });
  const list = document.getElementById("expert-entries-list");
  if (!list) return;
  list.innerHTML = expertEntries.map(e => `
    <div class="entry-item-row">
      <div class="entry-item-info">
        <strong>[${e.command}] ${e.title}</strong>
        <span>类型: ${e.kind} | 目标: ${e.url || e.path || "无"}</span>
      </div>
      <div>
        <fluent-button class="btn-edit-expert" data-cmd="${e.command}">编辑</fluent-button>
        <fluent-button class="btn-delete-expert" data-cmd="${e.command}" style="color: var(--error-color);">删除</fluent-button>
      </div>
    </div>
  `).join("");

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

  document.querySelectorAll(".btn-delete-expert").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const cmd = (e.target as HTMLElement).getAttribute("data-cmd");
      if (cmd) {
        await invoke("delete_entry", { namespace: "expert", key: cmd });
        showToast("条目已删除");
        loadAndRenderExpertEntries();
      }
    });
  });
}

function setupExpertSettingsUI() {
  document.getElementById("btn-refresh-expert")?.addEventListener("click", loadAndRenderExpertEntries);
  
  document.getElementById("btn-add-expert")?.addEventListener("click", () => {
    (document.getElementById("expert-cmd") as HTMLInputElement).value = "";
    (document.getElementById("expert-title") as HTMLInputElement).value = "";
    (document.getElementById("expert-kind") as HTMLSelectElement).value = "website";
    (document.getElementById("expert-url") as HTMLInputElement).value = "";
    (document.getElementById("expert-path") as HTMLInputElement).value = "";
    document.getElementById("expert-entry-form")?.classList.add("active");
  });

  document.getElementById("btn-cancel-expert")?.addEventListener("click", () => {
    document.getElementById("expert-entry-form")?.classList.remove("active");
  });

  document.getElementById("btn-save-expert")?.addEventListener("click", async () => {
    const cmd = (document.getElementById("expert-cmd") as HTMLInputElement).value.trim();
    const title = (document.getElementById("expert-title") as HTMLInputElement).value.trim();
    const kind = (document.getElementById("expert-kind") as HTMLSelectElement).value;
    const url = (document.getElementById("expert-url") as HTMLInputElement).value.trim();
    const path = (document.getElementById("expert-path") as HTMLInputElement).value.trim();

    if (!cmd || !title) {
      showToast("关键字和显示名称不能为空", true);
      return;
    }

    const entry: Entry = { command: cmd, title, kind };
    if (kind === "website") {
      if (!url) { showToast("网站类型的 URL 不能为空", true); return; }
      entry.url = url;
    } else if (kind === "app") {
      if (!path) { showToast("应用类型的路径不能为空", true); return; }
      entry.path = path;
    }

    try {
      await invoke("save_entry", { namespace: "expert", entry });
      showToast("保存成功");
      document.getElementById("expert-entry-form")?.classList.remove("active");
      loadAndRenderExpertEntries();
    } catch (e) {
      showToast(String(e), true);
    }
  });
}

function updateSelection() {
  document.querySelectorAll(".result-item").forEach((item, i) => {
    item.classList.toggle("selected", i === selectedIndex);
  });
}

document.addEventListener("click", (e) => {
  if (!container.contains(e.target as Node) && !configWindow?.contains(e.target as Node)) {
    invoke("hide_window");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (settingsVisible) {
      hideConfigWindow();
    } else {
      invoke("hide_window");
    }
  }
});

document.getElementById("close-config")?.addEventListener("click", () => {
  hideConfigWindow();
});

document.getElementById("close-about-config")?.addEventListener("click", () => {
  hideConfigWindow();
});

document.getElementById("lang-select")?.addEventListener("change", async (e) => {
  const lang = (e.target as HTMLSelectElement).value;
  setLanguage(lang);
  await invoke("save_config", { key: "global/language", value: lang });
  await updateTrayMenu();
  // refresh UI text if needed
});

document.getElementById("theme-select")?.addEventListener("change", async (e) => {
  const theme = (e.target as HTMLSelectElement).value;
  await invoke("save_config", { key: "global/theme", value: theme });
  if (theme === "dark") {
    document.body.dataset.theme = "dark";
  } else if (theme === "light") {
    document.body.dataset.theme = "light";
  } else {
    delete document.body.dataset.theme;
  }
});

document.getElementById("mode-select")?.addEventListener("change", async (e) => {
  const mode = (e.target as HTMLSelectElement).value;
  await invoke("set_mode", { mode });
  currentMode = mode as "expert" | "simple";
  await loadEntries();
  if (currentMode === "simple") {
    collapsed = false;
    renderResults([]);
  } else {
    setCollapsed(true);
    renderResults([]);
  }
});

async function init() {
  const { listen } = await import("@tauri-apps/api/event");
  listen("show-settings", () => {
    showConfigWindow("settings-content");
  });
  
  // Try to set window initial size
  invoke("resize_window", { width: 600.0, height: 40.0 }).catch(() => {});

  await initI18n();
  await updateTrayMenu();
  await loadConfig();
  await loadEntries();
  await initSettingsUI();

  const hasLaunched = await invoke<boolean>("get_has_launched").catch(() => false);
  if (!hasLaunched) {
    showConfigWindow("about-content");
    await invoke("mark_launched");
  } else {
    if (currentMode === "simple") {
      collapsed = false;
      renderResults([]);
    } else {
      setCollapsed(true);
      renderResults([]);
    }
  }
}

async function initSettingsUI() {
  try {
    const config = await invoke<AppConfig>("get_config");
    const langSelect = document.getElementById("lang-select") as HTMLSelectElement;
    if (langSelect) langSelect.value = config.language || "zh";
    
    const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
    if (themeSelect) themeSelect.value = config.theme || "system";
    
    const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
    if (modeSelect) modeSelect.value = config.mode || "expert";
    
      const browserSelect = document.getElementById("browser-select") as HTMLSelectElement;
      if (browserSelect) {
        const browsers = await invoke<BrowserInfo[]>("list_browsers");
        browserSelect.innerHTML = `<fluent-option value="">${t("system")}</fluent-option>` + browsers.map(b => `<fluent-option value="${b.id}">${b.name}</fluent-option>`).join("");
        browserSelect.value = config.default_browser || "";
        
        browserSelect.addEventListener("change", async (e) => {
          const browserId = (e.target as HTMLSelectElement).value;
          await invoke("save_config", { key: "global/default_browser", value: browserId });
          showToast(t("browser_updated"));
        });
      }
      
      const btnExportConfig = document.getElementById("btn-export-config");
      const btnImportConfig = document.getElementById("btn-import-config");
      const configImportInput = document.getElementById("config-import-input") as HTMLInputElement;

      if (btnExportConfig) {
        btnExportConfig.addEventListener("click", async () => {
          const json = await invoke<string>("export_config");
          downloadJson(json);
        });
      }

      if (btnImportConfig && configImportInput) {
        btnImportConfig.addEventListener("click", () => {
          configImportInput.click();
        });

        configImportInput.addEventListener("change", (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (event) => {
            const content = event.target?.result as string;
            try {
              await invoke("import_config", { json: content });
              showToast("配置导入成功，即将重启...");
              setTimeout(() => {
                location.reload();
              }, 1500);
            } catch (err) {
              showToast("导入失败: " + String(err), true);
            }
          };
          reader.readAsText(file);
        });
      }

      const hotkeyInput = document.getElementById("hotkey-input") as HTMLInputElement;
      if (hotkeyInput) {
        hotkeyInput.value = config.shortcut || "Alt+Space";
        hotkeyInput.addEventListener("keydown", async (e) => {
          e.preventDefault();
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
          hotkeyInput.value = shortcutStr;
          
          try {
            await invoke("register_hotkey", { modifiers: mods, key });
            await invoke("save_config", { key: "global/shortcut", value: shortcutStr });
          } catch (err) {
            showToast(t("hotkey_conflict"), true);
            hotkeyInput.value = config.shortcut || "Alt+Space";
          }
        });
      }

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
            showToast("背景图片已更新");
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
          if (bgUploadInput) {
            bgUploadInput.value = "";
          }
          showToast("背景图片已清除");
        });
      }

      const bgBlurSlider = document.getElementById("bg-blur-slider") as HTMLInputElement;
      if (bgBlurSlider) {
        bgBlurSlider.value = config.bg_blur !== undefined ? config.bg_blur.toString() : "20";
        bgBlurSlider.addEventListener("input", (e) => {
          const val = (e.target as HTMLInputElement).value;
          document.documentElement.style.setProperty("--bg-blur", `${val}px`);
        });
        bgBlurSlider.addEventListener("change", async (e) => {
          const val = parseInt((e.target as HTMLInputElement).value);
          await invoke("save_config", { key: "global/bg_blur", value: val });
        });
      }

      const bgOpacitySlider = document.getElementById("bg-opacity-slider") as HTMLInputElement;
      if (bgOpacitySlider) {
        bgOpacitySlider.value = config.bg_opacity !== undefined ? config.bg_opacity.toString() : "60";
        bgOpacitySlider.addEventListener("input", (e) => {
          const val = (e.target as HTMLInputElement).value;
          document.documentElement.style.setProperty("--bg-opacity", `${parseInt(val) / 100}`);
        });
        bgOpacitySlider.addEventListener("change", async (e) => {
          const val = parseInt((e.target as HTMLInputElement).value);
          await invoke("save_config", { key: "global/bg_opacity", value: val });
        });
      }

      const searchOpacitySlider = document.getElementById("search-opacity-slider") as HTMLInputElement;
      if (searchOpacitySlider) {
        searchOpacitySlider.value = config.search_opacity !== undefined ? config.search_opacity.toString() : "100";
        searchOpacitySlider.addEventListener("input", (e) => {
          const val = (e.target as HTMLInputElement).value;
          document.documentElement.style.setProperty("--search-opacity", `${parseInt(val) / 100}`);
        });
        searchOpacitySlider.addEventListener("change", async (e) => {
          const val = parseInt((e.target as HTMLInputElement).value);
          await invoke("save_config", { key: "global/search_opacity", value: val });
        });
      }

      setupSimpleSettingsUI();
      setupExpertSettingsUI();
  } catch (e) {
    console.error("Failed to init settings UI:", e);
  }
}

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

init();