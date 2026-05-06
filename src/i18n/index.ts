type TranslationDict = {
  [key: string]: string;
};

const translations: Record<string, TranslationDict> = {
  zh: {
    setting: "设置",
    dark: "暗黑",
    light: "明亮",
    system: "跟随系统",
    import: "导入配置",
    export: "导出配置",
    about: "关于",
    search_placeholder: "输入搜索...",
    no_results: "无结果",
    mode_switch: "切换模式",
    hotkey: "快捷键",
    theme: "主题",
    language: "语言",
    browser: "默认浏览器",
    save: "保存",
    cancel: "取消",
    confirm: "确认",
    author: "作者",
    version: "版本",
    welcome: "欢迎使用 nk-launcher",
    press_alt_space: "按下 Alt+Space 唤醒",
    browser_updated: "默认浏览器已更新",
    import_success: "导入成功",
    export_success: "导出成功",
    hotkey_conflict: "快捷键冲突",
    save_entry: "保存条目",
    delete_entry: "删除条目",
    add_entry: "添加条目",
    command: "命令",
    title: "标题",
    url: "网址",
    path: "路径",
    type: "类型",
    website: "网站",
    app: "应用",
    show: "显示",
    quit: "退出"
  },
  en: {
    setting: "Setting",
    dark: "Dark",
    light: "Light",
    system: "System",
    import: "Import Config",
    export: "Export Config",
    about: "About",
    search_placeholder: "Search...",
    no_results: "No results",
    mode_switch: "Switch Mode",
    hotkey: "Hotkey",
    theme: "Theme",
    language: "Language",
    browser: "Default Browser",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    author: "Author",
    version: "Version",
    welcome: "Welcome to nk-launcher",
    press_alt_space: "Press Alt+Space to activate",
    browser_updated: "Default browser updated",
    import_success: "Import successful",
    export_success: "Export successful",
    hotkey_conflict: "Hotkey conflict",
    save_entry: "Save Entry",
    delete_entry: "Delete Entry",
    add_entry: "Add Entry",
    command: "Command",
    title: "Title",
    url: "URL",
    path: "Path",
    type: "Type",
    website: "Website",
    app: "App",
    show: "Show",
    quit: "Quit"
  },
  ja: {
    setting: "設定",
    dark: "ダーク",
    light: "ライト",
    system: "システム",
    import: "設定をインポート",
    export: "設定をエクスポート",
    about: "について",
    search_placeholder: "検索...",
    no_results: "結果なし",
    mode_switch: "モード切替",
    hotkey: "ホットキー",
    theme: "テーマ",
    language: "言語",
    browser: "デフォルトブラウザ",
    save: "保存",
    cancel: "キャンセル",
    confirm: "確認",
    author: "著者",
    version: "バージョン",
    welcome: "nk-launcherへようこそ",
    press_alt_space: "Alt+Spaceで起動",
    browser_updated: "デフォルトブラウザを更新しました",
    import_success: "インポート成功",
    export_success: "エクスポート成功",
    hotkey_conflict: "ホットキー競合",
    save_entry: "エントリを保存",
    delete_entry: "エントリを削除",
    add_entry: "エントリを追加",
    command: "コマンド",
    title: "タイトル",
    url: "URL",
    path: "パス",
    type: "タイプ",
    website: "ウェブサイト",
    app: "アプリ",
    show: "表示",
    quit: "終了"
  },
};

let currentLang = "zh";

export async function initI18n() {
  try {
    const config = await import("@tauri-apps/api/core").then(m => m.invoke<string>("get_config").catch(() => null));
    if (config) {
      const parsed = JSON.parse(config);
      currentLang = parsed.language || "zh";
    }
  } catch {
    currentLang = "zh";
  }
}

export function setLanguage(lang: string) {
  if (translations[lang]) {
    currentLang = lang;
  }
}

export function t(key: string): string {
  return translations[currentLang]?.[key] || translations.zh[key] || key;
}

export function getCurrentLanguage(): string {
  return currentLang;
}