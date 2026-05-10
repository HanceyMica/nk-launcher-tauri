/**
 * Internationalization (i18n) Module / 国际化 (i18n) 模块
 * Provides multi-language support for UI strings / 为 UI 字符串提供多语言支持
 * Supported languages: zh (Chinese), en (English), ja (Japanese)
 * 支持的语言：zh（中文）、en（英语）、ja（日语）
 * @module i18n
 */

// ============================================================================
// Type Definitions / 类型定义
// ============================================================================

/**
 * Translation dictionary type / 翻译字典类型
 * Maps translation keys to translated strings / 将翻译键映射到翻译后的字符串
 * @typedef {Record<string, string>} TranslationDict
 */
type TranslationDict = {
  [key: string]: string;
};

// ============================================================================
// Translation Data / 翻译数据
// ============================================================================

/**
 * All translations indexed by language code / 按语言代码索引的所有翻译
 */
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
    mode: "模式",
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
    hotkey_conflict: "快捷键冲突，已被其他程序占用",
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
    quit: "退出",
    basic_settings: "基础设置",
    simple_settings: "简单模式设置",
    expert_settings: "专家模式设置",
    appearance_settings: "外观设置",
    expert_mode: "专家模式",
    simple_mode: "简单模式",
    add_custom_browser: "添加自定义浏览器",
    browser_name: "浏览器名称",
    exe_path: "exe路径",
    select_file: "选择文件",
    add: "添加",
    config_management: "配置管理",
    grid_to_config: "需要配置的网格：",
    main_grid: "主网格",
    edit_grid: "编辑格子",
    display_name: "显示名称",
    local_app: "本地应用",
    subgrid: "子网格",
    url_placeholder: "URL (网站填写)",
    path_placeholder: "路径 (应用填写)",
    delete: "删除",
    refresh: "刷新",
    edit_expert_entry: "新增/编辑专家模式条目",
    trigger_keyword: "触发关键字",
    bg_image: "背景图片",
    upload_image: "上传图片",
    clear_bg: "清除背景",
    bg_blur: "背景模糊度",
    content_opacity: "内容透明度",
    search_opacity: "搜索框透明度",
    search_width: "搜索框长度",
    restart_welcome: "重新观看欢迎向导",
    welcome_desc1: "这是一个以键盘操作为主要使用手段的九宫格快速启动器。",
    simple_mode_intro: "简单模式介绍",
    simple_mode_desc: "通过九宫格直观展示配置，输入数字即可快速触发动作。",
    expert_mode_intro: "专家模式介绍",
    expert_mode_desc: "基于缩写命令的极速匹配，支持模糊搜索，满足高级用户的高效需求。",
    select_mode: "请选择使用模式",
    select_mode_desc: "选择最适合您的启动方式。",
    select_theme: "请选择外观主题",
    select_theme_desc: "选择您偏好的界面颜色。",
    light_mode: "明亮模式",
    dark_mode: "暗黑模式",
    all_set: "所有设置完毕！",
    all_set_desc: "配置完毕后，按下 Alt+Space 即可随时唤醒主窗口。",
    close_and_start: "关闭并开始使用",
    simple_bg_enabled: "简单模式下应用设置背景",
    hotkey_updated: "快捷键已更新",
    prev_step: "上一步",
    next_step: "下一步",
    placeholder_desc: "图片/视频位占位说明",
    unconfigured: "未配置",
    click_to_config: "点击配置",
    subgrid_desc: "子网格包含9个格子，不可再嵌套",
    grid: "格子",
    target: "目标",
    none: "无",
    edit: "编辑",
    delete_entry_success: "条目已删除",
    save_success: "保存成功",
    empty_display_name: "显示名称不能为空",
    empty_keyword: "关键字和显示名称不能为空",
    empty_url: "网站类型的 URL 不能为空",
    empty_path: "应用类型的路径不能为空",
    empty_browser: "请输入浏览器名称并选择路径",
    add_browser_success: "自定义浏览器添加成功",
    import_failed: "导入失败",
    clear_grid_success: "格子已清空",
    bg_updated: "背景图片已更新",
    bg_cleared: "背景图片已清除",
    clear_launched_success: "已清空初次使用状态，即将重启...",
    import_restarting: "配置导入成功，即将重启...",
    mode_selected: "已选择：",
    jump_to: "跳转到",
    open_action: "打开",
    unset: "未设置",
    edit_grid_with_cmd: "编辑格子 {cmd}",
    hotkey_register_failed: "⚠ 全局快捷键 {shortcut} 注册失败，可能被其他程序占用",
    search_settings: "搜索设置"
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
    mode: "Mode",
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
    hotkey_conflict: "Hotkey conflict, already used by another program",
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
    quit: "Quit",
    basic_settings: "Basic Settings",
    simple_settings: "Simple Mode Settings",
    expert_settings: "Expert Mode Settings",
    appearance_settings: "Appearance",
    expert_mode: "Expert Mode",
    simple_mode: "Simple Mode",
    add_custom_browser: "Add Custom Browser",
    browser_name: "Browser Name",
    exe_path: "Exe Path",
    select_file: "Select File",
    add: "Add",
    config_management: "Config Management",
    grid_to_config: "Grid to config:",
    main_grid: "Main Grid",
    edit_grid: "Edit Grid",
    display_name: "Display Name",
    local_app: "Local App",
    subgrid: "Subgrid",
    url_placeholder: "URL (for website)",
    path_placeholder: "Path (for app)",
    delete: "Delete",
    refresh: "Refresh",
    edit_expert_entry: "Add/Edit Expert Entry",
    trigger_keyword: "Trigger Keyword",
    bg_image: "Background Image",
    upload_image: "Upload Image",
    clear_bg: "Clear Background",
    bg_blur: "Background Blur",
    content_opacity: "Content Opacity",
    search_opacity: "Search Opacity",
    search_width: "Search Width",
    restart_welcome: "Restart Welcome Guide",
    welcome_desc1: "A fast 9-grid launcher mainly operated by keyboard.",
    simple_mode_intro: "Simple Mode Intro",
    simple_mode_desc: "Visual configuration via 9-grid, trigger actions quickly with numbers.",
    expert_mode_intro: "Expert Mode Intro",
    expert_mode_desc: "Fast matching based on abbreviation commands with fuzzy search.",
    select_mode: "Please select mode",
    select_mode_desc: "Choose the best launching way for you.",
    select_theme: "Please select theme",
    select_theme_desc: "Choose your preferred interface color.",
    light_mode: "Light Mode",
    dark_mode: "Dark Mode",
    all_set: "All set!",
    all_set_desc: "Press Alt+Space to activate the main window anytime.",
    close_and_start: "Close and Start",
    simple_bg_enabled: "Apply settings background in simple mode",
    hotkey_updated: "Hotkey updated",
    prev_step: "Previous",
    next_step: "Next",
    placeholder_desc: "[Image/Video Placeholder]",
    unconfigured: "Unconfigured",
    click_to_config: "Click to config",
    subgrid_desc: "Subgrid contains 9 grids, cannot be nested",
    grid: "Grid",
    target: "Target",
    none: "None",
    edit: "Edit",
    delete_entry_success: "Entry deleted",
    save_success: "Saved successfully",
    empty_display_name: "Display name cannot be empty",
    empty_keyword: "Keyword and display name cannot be empty",
    empty_url: "URL cannot be empty for website",
    empty_path: "Path cannot be empty for app",
    empty_browser: "Please enter browser name and select path",
    add_browser_success: "Custom browser added successfully",
    import_failed: "Import failed",
    clear_grid_success: "Grid cleared",
    bg_updated: "Background image updated",
    bg_cleared: "Background image cleared",
    clear_launched_success: "Welcome state cleared, restarting...",
    import_restarting: "Import successful, restarting...",
    mode_selected: "Selected: ",
    jump_to: "Go to",
    open_action: "Open",
    unset: "Not set",
    edit_grid_with_cmd: "Edit grid {cmd}",
    hotkey_register_failed: "⚠ Failed to register global hotkey {shortcut}, may be in use by another program",
    search_settings: "Search settings"
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
    mode: "モード",
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
    hotkey_conflict: "ショートカットキーが競合しています。他のプログラムが使用中です",
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
    quit: "終了",
    basic_settings: "基本設定",
    simple_settings: "シンプルモード設定",
    expert_settings: "エキスパートモード設定",
    appearance_settings: "外観",
    expert_mode: "エキスパートモード",
    simple_mode: "シンプルモード",
    add_custom_browser: "カスタムブラウザ追加",
    browser_name: "ブラウザ名",
    exe_path: "Exe パス",
    select_file: "ファイルを選択",
    add: "追加",
    config_management: "設定管理",
    grid_to_config: "設定するグリッド:",
    main_grid: "メイングリッド",
    edit_grid: "グリッドを編集",
    display_name: "表示名",
    local_app: "ローカルアプリ",
    subgrid: "サブグリッド",
    url_placeholder: "URL (ウェブサイト用)",
    path_placeholder: "パス (アプリ用)",
    delete: "削除",
    refresh: "更新",
    edit_expert_entry: "エキスパートエントリ追加/編集",
    trigger_keyword: "トリガーキーワード",
    bg_image: "背景画像",
    upload_image: "画像をアップロード",
    clear_bg: "背景をクリア",
    bg_blur: "背景のぼかし",
    content_opacity: "コンテンツの不透明度",
    search_opacity: "検索の不透明度",
    search_width: "検索幅",
    restart_welcome: "ウェルカムガイドを再起動",
    welcome_desc1: "キーボード操作を主とする高速な9グリッドランチャーです。",
    simple_mode_intro: "シンプルモード紹介",
    simple_mode_desc: "9グリッドによる視覚的な設定。数字入力で即座にアクション。",
    expert_mode_intro: "エキスパートモード紹介",
    expert_mode_desc: "略語コマンドに基づく高速マッチング。あいまい検索をサポート。",
    select_mode: "モードを選択してください",
    select_mode_desc: "最適な起動方法を選択してください。",
    select_theme: "テーマを選択してください",
    select_theme_desc: "お好みのインターフェースの色を選択してください。",
    light_mode: "ライトモード",
    dark_mode: "ダークモード",
    all_set: "設定完了！",
    all_set_desc: "Alt+Space を押すことでいつでもメインウィンドウを起動できます。",
    close_and_start: "閉じて開始",
    simple_bg_enabled: "シンプルモードで設定背景を適用",
    hotkey_updated: "ショートカットキーが更新されました",
    prev_step: "戻る",
    next_step: "次へ",
    placeholder_desc: "[画像/動画プレースホルダー]",
    unconfigured: "未設定",
    click_to_config: "クリックして設定",
    subgrid_desc: "サブグリッドには9つのグリッドが含まれ、ネストできません",
    grid: "グリッド",
    target: "ターゲット",
    none: "なし",
    edit: "編集",
    delete_entry_success: "エントリを削除しました",
    save_success: "保存しました",
    empty_display_name: "表示名は空にできません",
    empty_keyword: "キーワードと表示名は空にできません",
    empty_url: "ウェブサイトのURLは空にできません",
    empty_path: "アプリのパスは空にできません",
    empty_browser: "ブラウザ名を入力し、パスを選択してください",
    add_browser_success: "カスタムブラウザを追加しました",
    import_failed: "インポート失敗",
    clear_grid_success: "グリッドをクリアしました",
    bg_updated: "背景画像を更新しました",
    bg_cleared: "背景をクリアしました",
    clear_launched_success: "初期状態をクリアしました。再起動します...",
    import_restarting: "インポート成功。再起動します...",
    mode_selected: "選択：",
    jump_to: "ジャンプ",
    open_action: "開く",
    unset: "未設定",
    edit_grid_with_cmd: "グリッド {cmd} を編集",
    hotkey_register_failed: "⚠ グローバルホットキー {shortcut} の登録に失敗しました。他のプログラムが使用中の可能性があります",
    search_settings: "設定を検索"
  },
};

// ============================================================================
// State / 状态
// ============================================================================

/** Currently active language code / 当前活跃的语言代码 */
let currentLang = "zh";

// ============================================================================
// Initialization / 初始化
// ============================================================================

/**
 * Initialize i18n system from backend config / 从后端配置初始化 i18n 系统
 * Loads language preference from Tauri config / 从 Tauri 配置加载语言偏好
 * Falls back to "zh" on error / 出错时回退到 "zh"
 */
export async function initI18n() {
  try {
    const config = await import("@tauri-apps/api/core").then(m => m.invoke<{ language: string }>("get_config").catch(() => null));
    if (config) {
      currentLang = (config as any).language || "zh";
    }
  } catch {
    currentLang = "zh";
  }
}

// ============================================================================
// Translation Functions / 翻译函数
// ============================================================================

/**
 * Set current language / 设置当前语言
 * @param {string} lang - Language code (zh/en/ja) / 语言代码
 * @description Does nothing if language not supported / 如果语言不支持则什么都不做
 */
export function setLanguage(lang: string) {
  if (translations[lang]) {
    currentLang = lang;
  }
}

/**
 * Translate a key / 翻译一个键
 * @param {string} key - Translation key / 翻译键
 * @returns {string} - Translated string, falls back to Chinese if key not found in current language
 * @description Returns the translation for the key in the current language.
 * Falls back to Chinese (zh) if the key is not found in the current language.
 */
export function t(key: string): string {
  return translations[currentLang]?.[key] ?? translations['zh']?.[key] ?? key;
}

/**
 * Get current language code / 获取当前语言代码
 * @returns {string} - Current language code (zh/en/ja)
 */
export function getCurrentLanguage(): string {
  return currentLang;
}