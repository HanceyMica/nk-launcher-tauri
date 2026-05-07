import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initI18n, t, setLanguage } from "./i18n/index";
import {
  provideFluentDesignSystem,
  fluentSelect,
  fluentOption,
  fluentTextField,
  fluentButton,
  fluentRadio,
  fluentRadioGroup,
  baseLayerLuminance,
  StandardLuminance
} from "@fluentui/web-components";

provideFluentDesignSystem().register(
  fluentSelect(),
  fluentOption(),
  fluentTextField(),
  fluentButton(),
  fluentRadio(),
  fluentRadioGroup()
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
const welcomeWindow = document.getElementById("welcome-window") as HTMLDivElement;

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

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
    if (!themeSelect || themeSelect.value === "system") {
      applyTheme("system");
    }
  });
}

function updateI18nUI() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key);
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      el.setAttribute("placeholder", t(key));
    }
  });
}
function showWelcomeWindow() {
  settingsVisible = true;
  if (welcomeWindow) welcomeWindow.classList.add("visible");
  if (container) container.style.display = "none";
  if (configWindow) configWindow.classList.remove("visible");
  invoke("resize_window", { width: 700.0, height: 500.0 });
}

function hideWelcomeWindow() {
  settingsVisible = false;
  if (welcomeWindow) welcomeWindow.classList.remove("visible");
  if (container) container.style.display = "block";
}

function showConfigWindow(targetId: string = "basic-settings") {
  settingsVisible = true;
  if (welcomeWindow) welcomeWindow.classList.remove("visible");
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

document.querySelector(".btn-welcome-minimize")?.addEventListener("click", () => {
  getCurrentWindow().minimize();
});

document.querySelector(".btn-welcome-maximize")?.addEventListener("click", async () => {
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

document.querySelector(".btn-welcome-close")?.addEventListener("click", () => {
  hideWelcomeWindow();
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
    applyTheme(config.theme || "system");
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
      invoke("resize_window", { width: 340.0, height: 40.0 });
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
        
        // 格式化提示文本，比如 "1：跳转到 百度"
        const actionText = entry.kind === "website" ? "跳转到" : "打开";
        const formattedEntry = {
          ...entry,
          title: `${searchQuery}：${actionText} ${entry.title}`,
          url: "", // 不显示多余信息
          path: ""
        };
        
        renderResults([formattedEntry]);
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
    
    // 对于某些命令或执行可能已经隐藏了窗口，或者还需要清空搜索栏
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
    { cmd: "s", label: t("setting"), icon: `<i class="fa-solid fa-cog"></i>`, action: () => showConfigWindow("settings-content") },
    { cmd: "d", label: t("dark"), icon: `<i class="fa-solid fa-moon"></i>`, action: async () => { await invoke("save_config", { key: "global/theme", value: "dark" }); applyTheme("dark"); } },
    { cmd: "l", label: t("light"), icon: `<i class="fa-solid fa-sun"></i>`, action: async () => { await invoke("save_config", { key: "global/theme", value: "light" }); applyTheme("light"); } },
    { cmd: "w", label: t("system"), icon: `<i class="fa-solid fa-desktop"></i>`, action: async () => { await invoke("save_config", { key: "global/theme", value: "system" }); applyTheme("system"); } },
    { cmd: "i", label: t("import"), icon: `<i class="fa-solid fa-file-import"></i>`, action: () => {
      const configImportInput = document.getElementById("config-import-input") as HTMLInputElement;
      if (configImportInput) configImportInput.click();
    } },
    { cmd: "o", label: t("export"), icon: `<i class="fa-solid fa-file-export"></i>`, action: async () => { const json = await invoke<string>("export_config"); downloadJson(json); } },
    { cmd: "a", label: t("about"), icon: `<i class="fa-solid fa-info-circle"></i>`, action: () => showConfigWindow("about-content") },
  ];

  const filtered = commands.filter(c => c.cmd.startsWith(searchQuery.slice(1).toLowerCase()));
  const html = filtered.map((c, i) => `<div class="result-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">${c.icon} /${c.cmd} → ${c.label}</div>`).join("");
  resultList.innerHTML = html;

  const targetWidth = currentMode === "simple" ? 340.0 : currentSearchWidth;
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
    d: async () => { await invoke("save_config", { key: "global/theme", value: "dark" }); applyTheme("dark"); },
    l: async () => { await invoke("save_config", { key: "global/theme", value: "light" }); applyTheme("light"); },
    w: async () => { await invoke("save_config", { key: "global/theme", value: "system" }); applyTheme("system"); },
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
        invoke("resize_window", { width: 340.0, height: 40.0 });
      }
    }
    return;
  }

  // Always resize window for results
  const targetWidth = currentMode === "simple" ? 340.0 : currentSearchWidth;
  const height = Math.min(40 + results.length * 36, 400);
  invoke("resize_window", { width: targetWidth, height: height });

  const html = results.map((entry, i) => {
    const icon = entry.kind === "website" ? `<i class="fa-solid fa-globe"></i>` : `<i class="fa-solid fa-box"></i>`;
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

function renderSimpleGrid(prefix: string = "") {
  // 增加高度，为新的自适应网格提供足够的空间展示，包含外边距等
  invoke("resize_window", { width: 340.0, height: 380.0 });
  
  // Fill 1-9
  let html = `<div id="nine-grid">`;
  for (let i = 1; i <= 9; i++) {
    const cmd = prefix + String(i);
    const entry = entries.find(e => e.command === cmd);
    const name = entry ? entry.title : "未设置";
    let icon = `<i class="fa-solid fa-plus"></i>`;
    if (entry) {
      if (entry.kind === "website") icon = `<i class="fa-solid fa-globe"></i>`;
      else if (entry.kind === "app") icon = `<i class="fa-solid fa-box"></i>`;
      else if (entry.kind === "subgrid") icon = `<i class="fa-solid fa-folder"></i>`;
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
    <fluent-button id="btn-settings" appearance="stealth"><i class="fa-solid fa-cog"></i> ${t("setting")}</fluent-button>
    <fluent-button id="btn-theme" appearance="stealth"><i class="fa-solid fa-moon"></i> ${t("theme")}</fluent-button>
    <fluent-button id="btn-about" appearance="stealth"><i class="fa-solid fa-info-circle"></i> ${t("about")}</fluent-button>
  </div>`;
  
  resultList.innerHTML = html;

  document.querySelectorAll(".grid-item").forEach((item) => {
    item.addEventListener("click", () => {
      const cmd = item.getAttribute("data-cmd");
      if (cmd) {
        searchInput.value = cmd;
        searchQuery = cmd;
        
        const entry = entries.find(e => e.command === cmd);
        if (entry && entry.kind !== "subgrid") {
          collapsed = false;
          
          // 格式化提示文本，比如 "1：跳转到 百度"
          const actionText = entry.kind === "website" ? "跳转到" : "打开";
          const formattedEntry = {
            ...entry,
            title: `${searchQuery}：${actionText} ${entry.title}`,
            url: "", // 不显示多余信息
            path: ""
          };
          
          renderResults([formattedEntry]);
        } else {
          searchInput.dispatchEvent(new Event("input"));
        }
      }
    });
  });

  document.getElementById("btn-settings")?.addEventListener("click", () => showConfigWindow("settings-content"));
  document.getElementById("btn-about")?.addEventListener("click", () => showConfigWindow("about-content"));
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
      <div class="settings-grid-item" data-cmd="${cmd}">
        <div class="settings-grid-item-header">
          <span>${t("grid")} ${i}</span>
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

          showToast(t("clear_grid_success"));
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

async function loadAndRenderExpertEntries() {
  expertEntries = await invoke<Entry[]>("get_entries", { namespace: "expert" });
  renderExpertEntries();
}

function renderExpertEntries() {
  const list = document.getElementById("expert-entries-list");
  if (!list) return;
  list.innerHTML = expertEntries.map(e => {
    let icon = "";
    if (e.kind === "website") icon = `<i class="fa-solid fa-globe"></i>`;
    else if (e.kind === "app") icon = `<i class="fa-solid fa-box"></i>`;
    
    return `
    <div class="entry-item-row">
      <div class="entry-item-info">
        <strong>[${e.command}] ${icon} ${e.title}</strong>
        <span>${t("type")}: ${t(e.kind)} | ${t("target")}: ${e.url || e.path || t("none")}</span>
      </div>
      <div>
        <fluent-button class="btn-edit-expert" data-cmd="${e.command}">${t("edit")}</fluent-button>
        <fluent-button class="btn-delete-expert" data-cmd="${e.command}" style="color: var(--error-color);">${t("delete")}</fluent-button>
      </div>
    </div>
  `}).join("");

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
        showToast(t("delete_entry_success") || "条目已删除");
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

function updateSelection() {
  document.querySelectorAll(".result-item").forEach((item, i) => {
    item.classList.toggle("selected", i === selectedIndex);
  });
}

document.addEventListener("click", (e) => {
  const target = e.target as Node;
  // 如果点击的目标元素在事件冒泡过程中被移除了（例如点击格子后重新渲染），则不触发隐藏
  if (!document.contains(target)) {
    return;
  }
  
  if (!container.contains(target) && !configWindow?.contains(target) && !welcomeWindow?.contains(target)) {
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
  updateI18nUI();
  const welcomeLangSelect = document.getElementById("welcome-lang-select") as HTMLSelectElement;
  if (welcomeLangSelect) welcomeLangSelect.value = lang;
});

document.getElementById("welcome-lang-select")?.addEventListener("change", async (e) => {
  const lang = (e.target as HTMLSelectElement).value;
  setLanguage(lang);
  await invoke("save_config", { key: "global/language", value: lang });
  await updateTrayMenu();
  updateI18nUI();
  const langSelect = document.getElementById("lang-select") as HTMLSelectElement;
  if (langSelect) langSelect.value = lang;
});

document.getElementById("theme-select")?.addEventListener("change", async (e) => {
  const theme = (e.target as HTMLSelectElement).value;
  await invoke("save_config", { key: "global/theme", value: theme });
  applyTheme(theme);
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
  
  updateI18nUI();

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
}

async function initSettingsUI() {
  try {
    const config = await invoke<AppConfig>("get_config");
    const langSelect = document.getElementById("lang-select") as HTMLSelectElement;
    if (langSelect) langSelect.value = config.language || "zh";
    
    const welcomeLangSelect = document.getElementById("welcome-lang-select") as HTMLSelectElement;
    if (welcomeLangSelect) welcomeLangSelect.value = config.language || "zh";

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

      const btnSelectBrowserPath = document.getElementById("btn-select-browser-path");
      const btnAddCustomBrowser = document.getElementById("btn-add-custom-browser");
      const customBrowserName = document.getElementById("custom-browser-name") as HTMLInputElement;
      const customBrowserPath = document.getElementById("custom-browser-path") as HTMLInputElement;

      if (btnSelectBrowserPath && btnAddCustomBrowser && customBrowserName && customBrowserPath) {
        btnSelectBrowserPath.addEventListener("click", async () => {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const selected = await open({
            multiple: false,
            filters: [{ name: "Executable", extensions: ["exe"] }]
          });
          if (selected && typeof selected === "string") {
            customBrowserPath.value = selected;
            if (!customBrowserName.value) {
              const fileName = selected.split('\\').pop()?.split('/').pop() || "";
              customBrowserName.value = fileName.replace(".exe", "");
            }
          }
        });

        btnAddCustomBrowser.addEventListener("click", async () => {
          const name = customBrowserName.value.trim();
          const path = customBrowserPath.value.trim();
          if (!name || !path) {
            showToast(t("empty_browser"), true);
            return;
          }
          try {
            await invoke("add_custom_browser", { name, path });
            showToast(t("add_browser_success"));
            customBrowserName.value = "";
            customBrowserPath.value = "";
            // Refresh browser list
            if (browserSelect) {
              const browsers = await invoke<BrowserInfo[]>("list_browsers");
              browserSelect.innerHTML = `<fluent-option value="">${t("system")}</fluent-option>` + browsers.map(b => `<fluent-option value="${b.id}">${b.name}</fluent-option>`).join("");
              browserSelect.value = browsers[browsers.length - 1].id;
              await invoke("save_config", { key: "global/default_browser", value: browserSelect.value });
            }
          } catch (e) {
            showToast(String(e), true);
          }
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
              showToast(t("import_restarting"));
              setTimeout(() => {
                location.reload();
              }, 1500);
            } catch (err) {
              showToast(t("import_failed") + ": " + String(err), true);
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
          
          try {
            const isConflict = await invoke<boolean>("check_hotkey_conflict", { modifiers: mods, key });
            if (isConflict) {
              showToast(t("hotkey_conflict"), true);
              hotkeyInput.value = config.shortcut || "Alt+Space";
              return;
            }
            
            hotkeyInput.value = shortcutStr;
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
          if (bgUploadInput) {
            bgUploadInput.value = "";
          }
          showToast(t("bg_cleared"));
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

      // Initialize welcome radio states
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