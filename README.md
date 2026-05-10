# nk-launcher

Windows 桌面端快速启动器，基于 **Bun + Rust + Tauri v2 + SQLite**。

版本：**0.1.0**

## 功能

- **专家模式**：搜索框 + 模糊匹配，支持打开 URL 或启动本地应用
- **简单模式**：九宫格布局，数字键快速导航
- **模式互通**：简单与专家模式可互相识别并执行对方的启动项
- **右键上下文菜单**：格子和输入框均支持右键操作，网格项支持修改/删除/复制，输入框支持编辑和快捷命令
- **全局快捷键**：`Alt + Space` 呼出/隐藏，支持自定义
- **浏览器枚举**：自动识别系统已安装浏览器
- **配置导入/导出**：JSON 格式，SQLite 持久化
- **多语言**：中文、English、日本語

## 编译

### 环境要求

- Windows 10/11
- [Bun](https://bun.sh) >= 1.0
- [Rust](https://rust-lang.org) >= 1.77.2

### 步骤

```bash
# 安装依赖
bun install

# 开发模式
bun run tauri dev

# 生产构建
bun run tauri build
```

产物位于 `src-tauri/target/release/nk-launcher-tauri.exe`（或 NSIS 安装包）。

## 配置

- 数据目录：`%LOCALAPPDATA%\nk-launcher-tauri\`
- 日志目录：`%LOCALAPPDATA%\nk-launcher-tauri\logs\`
- 数据库：`%LOCALAPPDATA%\nk-launcher-tauri\config.db`

### 导入/导出格式

```json
{
  "version": "0.1.0",
  "kv": [
    ["global", "mode", "\"expert\""],
    ["expert", "bd", "{\"command\":\"bd\",\"kind\":\"website\",\"title\":\"百度\",\"url\":\"https://www.baidu.com\"}"]
  ]
}
```

## 命令模式

在搜索框输入 `/` 进入：

- `/s` → 打开设置
- `/d` → 暗黑模式
- `/l` → 明亮模式
- `/w` → 跟随系统
- `/i` → 导入配置
- `/o` → 导出配置
- `/a` → 关于
- `/e` → 隐藏到托盘
- `/q` → 退出应用

## 作者

- HarveyMica
- github.com/HanceyMica
- x.com/HanceyMica