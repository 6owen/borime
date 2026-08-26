# Borime

[![CI](https://github.com/6owen/borime/actions/workflows/ci.yml/badge.svg)](https://github.com/6owen/borime/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Borime 是一套基于 [Rime](https://rime.im/) 的中英双语输入方案：使用雾凇拼音的小鹤双拼生成中文候选，在候选旁显示英文释义，并用异步 AI 为本地词典没有覆盖的短语补全翻译。

```text
我的帽子  my hat
```

英文只显示在候选注释中。按空格确认后，上屏内容仍然只有 `我的帽子`。

> 当前主要在 macOS 鼠须管上使用和验证；Windows 小狼毫的安装链路已有自动化测试，但仍需要更多实机反馈。

## 功能

- **雾凇拼音 + 小鹤双拼**：使用 rime-ice 的词库、Emoji、用户词频学习等能力。
- **中英候选注释**：候选正文保持中文，英文作为 comment 展示，不污染上屏文本。
- **三层翻译来源**：CC-CEDICT、本地精选词条和 AI 动态缓存按优先级合并。
- **异步 AI 翻译**：网络请求在独立 Node.js worker 中运行，Rime 按键线程不等待网络。
- **当前候选立即刷新**：macOS 上 AI 返回后自动更新候选窗，并保留用户已经选择的页码和候选位置。
- **中英混输**：支持“小鹤双拼中文前缀 + 英文”，例如 `dakdapp` 可产生 `打开 APP`。
- **自动空格**：在中文与 ASCII 字母数字的边界自动补半角空格。
- **智能回车**：未移动候选时回车上屏原始编码；移动候选后回车确认当前高亮项。
- **诊断与缓存工具**：提供状态检查、实时诊断、模型探针、缓存导入导出和发行包构建命令。
- **不占用 VS Code 终端快捷键**：`Control+grave` 留给宿主应用，Rime 方案菜单使用 `F4` 或 `Control+Shift+grave`。

## 工作方式

```text
键盘输入
  → Squirrel / Weasel + librime
  → 雾凇中文候选
  → Lua 添加本地英文注释
  → 缓存未命中时写入请求队列
  → Node.js worker 调用 DeepSeek / OpenAI-compatible API
  → 写入本地缓存并刷新候选
```

中文候选排序仍由雾凇词库和 Rime userdb 决定；AI 只负责英文注释，不会重排或替换中文候选。

## 支持范围与环境要求

| 平台 | Rime 前端 | 当前状态 | AI 返回后的候选刷新 |
| --- | --- | --- | --- |
| macOS | 鼠须管 Squirrel | 主要开发和实机验证平台 | 立即刷新并恢复原候选位置 |
| Windows | 小狼毫 Weasel | 安装与核心逻辑有 CI，仍需更多实机反馈 | 下一次正常候选重算时显示 |
| Linux / 移动端 | — | 暂不支持安装 | — |

当前只部署雾凇的 `double_pinyin_flypy`（小鹤双拼）方案，不包含全拼和其他双拼方案的 Borime 集成配置。
项目暂未维护精确的最低 Squirrel／Weasel 版本；请优先使用官方最新 Release，过旧或不含 librime-lua 的前端无法加载本项目 Lua 组件。

安装前需要：

- [Git](https://git-scm.com/)
- Node.js 22 或更高版本
- pnpm 10；项目声明的准确版本为 `10.13.1`
- macOS：[鼠须管 Releases](https://github.com/rime/squirrel/releases)
- Windows：[小狼毫 Releases](https://github.com/rime/weasel/releases)
- 可选：DeepSeek API Key 或 OpenAI-compatible API

先安装对应 Rime 前端，并确认系统输入法列表中可以切换到鼠须管／小狼毫。macOS 如果安装后没有自动出现鼠须管，需要在“系统设置 → 键盘 → 输入法”中手动添加；部分 Mac 键盘打开方案菜单时需要按 `Fn+F4`。

AI 配置不是中文输入的前提。没有 API Key 时，Rime、随项目附带的翻译和已经导入的 CC-CEDICT 仍可使用，但不会为新短语生成 AI 翻译。

## 安装

### 1. 获取代码与依赖

在 macOS Terminal 或 Windows PowerShell 中执行：

```bash
git clone --recurse-submodules https://github.com/6owen/borime.git
cd borime
corepack enable
pnpm --version
pnpm install --frozen-lockfile
```

`pnpm --version` 应显示 10.x；Corepack 会依据 `package.json` 使用 `10.13.1`。如果 Node 发行版没有附带 Corepack，可改用：

```bash
npm install --global pnpm@10.13.1
```

如果克隆时没有拉取 submodule：

```bash
git submodule update --init --recursive
```

### 2. 选择是否启用 AI

不需要 AI 时可以完全跳过本步骤，不创建 `.env`。worker 没有 API Key 就不会发起模型请求。

启用 AI 后，当前候选窗前 5 项中本地未命中的中文候选会自动发送给所配置的模型服务，并可能产生 API 费用；完整范围见[数据、隐私与同步](#数据隐私与同步)。

macOS 创建配置：

```bash
cp .env.example .env
```

Windows PowerShell 创建配置：

```powershell
Copy-Item .env.example .env
```

使用官方 DeepSeek：

```env
DEEPSEEK_API_KEY=your-api-key
DEEPSEEK_MODEL=deepseek-v4-flash
```

或使用 OpenAI-compatible 接口：

```env
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=your-api-key
MASTRA_CHAT_MODEL=your-model-id
```

存在 `OPENAI_BASE_URL` 时，兼容接口配置优先。API Key 只保存在本机明文 `.env`；该文件会设置为仅当前用户可读，并已被 Git 和发行包排除。

### 3. macOS 部署

在 Terminal 中执行：

```bash
pnpm build
pnpm install:rime
pnpm status
```

切换系统输入法到鼠须管，然后按 `F4`（部分键盘为 `Fn+F4`），在 Rime 方案菜单中选择 **小鹤双拼**。

### 4. Windows 部署

在 PowerShell 中执行：

```powershell
pnpm build
pnpm install:rime
pnpm status
```

切换系统输入法到小狼毫，然后从小狼毫方案菜单中选择 **小鹤双拼**。

如果安装器找不到 `WeaselDeployer.exe`，在 `.env` 中指定：

```env
RIME_DEPLOYER_PATH=C:\Path\To\WeaselDeployer.exe
```

Windows 当前不会在 AI 返回时主动重算正在显示的候选；新翻译会在下一次输入、退格或其他正常候选重算时出现。

### 5. 验证安装

`pnpm status` 应显示 Rime 前端、Flypy schema、Bilingual patch 和后台 worker 状态。切换到小鹤双拼后：

1. 正常输入中文，确认中文候选可以上屏。
2. 候选旁应出现已有英文释义；缓存未命中且配置了 API Key 时会先显示 `翻译中…`。
3. macOS 上等待 AI 返回，英文应自动出现；按 Down 移动过的高亮不应跳回第一项。

无 Key 安装仍会注册一个空闲的后台任务，方便以后直接补配置；此时 `pnpm status` 应显示 `Translation API key configured: false` 和 `AI candidate requests enabled: false`，不会产生模型请求。

安装器会把雾凇方案和 Borime 的 Lua/YAML 部署到 Rime 用户目录，注册后台任务并重新部署前端。首次检测到已有 Rime 用户目录时，会在其同级创建 `Rime.backup-<timestamp>` 完整备份；后续升级保留 userdb、AI 缓存和队列，但更新仓库管理的 Lua/YAML。

> macOS LaunchAgent 和 Windows 计划任务直接运行当前仓库中的 `dist/worker.js`，因此安装后不能直接移动或删除源码目录。移动目录后应在新位置重新执行 `pnpm build` 和 `pnpm install:rime`。

## 使用

### 候选翻译

默认启用中英候选。已有本地翻译会立即显示；新词先显示 `翻译中…`，AI 返回后写入本地缓存。

macOS 上，当前候选窗会立即刷新。如果你已经按 Down、Up 或翻页键移动高亮，刷新后仍保持同一绝对候选位置；只有输入编码、光标位置或该候选正文已经变化时才放弃恢复。

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Shift+space` | 同时上屏当前高亮候选及其英文提示 |
| `Control+Shift+B` | 切换“中文 / 中英”候选注释 |
| `Control+Shift+M` | 切换“单语 / 混输” |
| `Control+Shift+S` | 切换“原样 / 自动空格” |
| `F4` 或 `Control+Shift+grave` | 打开 Rime 方案菜单 |
| `Control+grave` | 不由 Borime 占用，可用于 VS Code 集成终端 |

`grave` 指常见美式键盘中数字 1 左侧的反引号键，不同键盘布局可能位于其他位置。中英候选、混输和自动空格默认都开启；这些开关只在当前 Rime 会话有效，切换方案或重新部署后会回到默认状态。

输入双拼并选中目标候选后，普通空格仍然只上屏中文；按 `Shift+space` 会按照候选窗显示的内容，同时上屏中文和整条英文提示，中间加入一个半角空格。例如候选显示 `你好  hello`，上屏结果就是 `你好 hello`。英文提示不会被分词或改写。

### 中英混输

连续输入精确命中的“小鹤双拼中文前缀 + 英文词”会生成混输候选。例如：

```text
dakdapp → 打开 APP
```

### 自动空格

同一候选及相邻 Rime 上屏记录中的中文／ASCII 字母数字边界会自动补一个半角空格，例如：

```text
打开APP设置 → 打开 APP 设置
```

手动移动光标、粘贴文本或切换到其他输入法后，Rime 无法可靠读取应用光标前的字符，因此这些场景不会保证自动补空格。

### 回车与中英文切换

- 未用方向键移动候选时，`Return` 上屏原始拼音编码。
- 移动过候选后，`Return` 确认当前高亮候选。
- 中文组合状态下按 Caps Lock 或左右 Shift，会提交当前原始编码并切换到英文模式。

## 翻译数据

翻译按以下优先级覆盖：

```text
CC-CEDICT < seed.tsv < dynamic.tsv
```

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| CC-CEDICT | Rime 用户目录下的 `bilingual/cedict.tsv` | 可选的大型基础中英词典 |
| 精选翻译 | Rime 用户目录下的 `bilingual/seed.tsv` | 首次安装由仓库 `rime/bilingual/seed.tsv` 初始化，可继续预生成 |
| AI 缓存 | Rime 用户目录下的 `bilingual/dynamic.tsv` | 自动生成，也可人工修订 |

不要在 worker 运行时直接编辑 `dynamic.tsv`：worker 的内存缓存可能在下一次写回时覆盖手工修改。先停止后台任务，完成编辑后再运行 `pnpm install:rime` 重新加载。

导入 CC-CEDICT：

```bash
pnpm import:cedict
```

该命令联网下载词典，将结果写入 Rime 用户目录的 `bilingual/cedict.tsv`，然后重启 worker 并重新部署 Rime；不调用 AI。CC-CEDICT 数据遵循 CC BY-SA 4.0，归属与转换说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

预生成更多常见词翻译：

```bash
pnpm seed -- --count 2000
```

`seed` 会把雾凇基础词库中的常用中文发送给当前模型，产生真实 API 调用和费用，并把结果直接写入 Rime 用户目录的 `bilingual/seed.tsv`。它会跳过已经存在的翻译、分批保存并递增 `cache.version`；不需要重新部署，重新输入或触发下一次候选重算即可生效。运行 `pnpm status` 可以确认精选翻译和总缓存数量已经增加。

## 状态与诊断

```bash
# 查看 Rime、worker、模型配置和缓存状态
pnpm status

# 查看最近的候选入队、模型请求、缓存写入和刷新事件
pnpm diagnose

# 持续观察
pnpm diagnose -- --watch

# 绕过 Rime，发起一次真实 API 请求
pnpm diagnose -- --probe "诊断翻译延迟"
```

探针会产生真实 API 调用。诊断数据保存在 Rime 用户目录的 `bilingual/diagnostics.jsonl`，其中可能包含你输入过的候选文字。

不要在已安装的后台 worker 运行时另外执行 `pnpm worker`，否则两个进程会争用同一个请求队列。

## 数据、隐私与同步

- `.env`、API Key、userdb、AI 缓存、请求队列和日志不会进入 Git 或发行包。
- 开启中英候选时，当前候选窗前 5 项中“含汉字且本地缓存未命中”的候选正文会进入队列；它们可能并不是你最终确认上屏的文字。
- 模型请求只包含这些候选正文和 Borime 的翻译提示词，不包含原始双拼编码、应用全文或光标前后文。服务商仍会收到普通 HTTP 连接元数据；其保留和训练政策由对应服务商决定。
- 任意 OpenAI-compatible 地址都能同时收到候选文字和为它配置的 API Key。不要用不受信任的接口处理敏感输入。
- macOS 数据通常位于 `~/Library/Rime`，Windows 通常位于 `%APPDATA%\Rime`。
- Rime userdb 保存中文选词习惯；`dynamic.tsv` 保存英文翻译缓存，两者需要分别备份。
- `cedict.tsv` 可在每台机器重新导入，不必同步。
- 请求队列、诊断和日志是本机明文文件，可能包含候选文字。默认上限为约 1 MiB；日志保留最多两份轮转备份，已消费队列达到上限后会压缩。
- `Control+Shift+B` 切到“中文”后，会同时停止英文展示和新的 AI 入队；方案重载后默认重新开启。

显式导出和合并 AI 缓存：

```bash
pnpm cache:export -- --output /private/path/borime-cache.tsv
pnpm cache:import -- --input /private/path/borime-cache.tsv
```

Windows PowerShell 可将 `/private/path/borime-cache.tsv` 替换为例如 `$HOME\Documents\borime-cache.tsv`。导出的 TSV 可能包含私人短语，应只保存到可信位置。

### 停用 AI

临时停用：按 `Control+Shift+B` 切到“中文”，当前 session 不再创建新请求。

长期停用：删除 `.env` 中的 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`，然后重新运行 `pnpm install:rime`。安装器会删除运行时的 `ai.enabled` 标记；Lua 不再显示 `翻译中…` 或写入 AI 请求，但本地中文输入和已有翻译不受影响。

如需清除历史记录，先停用后台 worker，再在文件管理器中检查并删除 Rime 用户目录 `bilingual/` 下对应的 `requests.txt`、`diagnostics.jsonl`、`failed-requests.jsonl`、`worker*.log` 或 `dynamic.tsv`。删除 `dynamic.tsv` 会永久丢失 AI 翻译缓存，请先备份。

## 后台任务、回滚与卸载

修改 `.env` 后应重新执行 `pnpm install:rime`，让 API 开关、后台任务和 Rime session 一起更新。只修改模型参数且不改变是否存在 API Key 时，也可以单独重启 worker：

macOS：

```bash
launchctl kickstart -k gui/$(id -u)/com.local.rime-bilingual
```

Windows PowerShell：

```powershell
Stop-ScheduledTask -TaskName RimeBilingualIME -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName RimeBilingualIME
```

停止并注销 Borime 后台任务：

```bash
# macOS
launchctl bootout gui/$(id -u)/com.local.rime-bilingual
```

macOS 还应通过 Finder 删除 `~/Library/LaunchAgents/com.local.rime-bilingual.plist`，避免下次登录再次加载。

```powershell
# Windows PowerShell
Unregister-ScheduledTask -TaskName RimeBilingualIME -Confirm:$false
```

这不会自动删除 Rime 用户数据。要回滚首次安装，请先备份当前 userdb 和 `bilingual/`，停止对应输入法前端，再通过文件管理器用安装器创建的 `Rime.backup-<timestamp>` 恢复 Rime 用户目录。确认后台任务已注销后，源码目录才可以安全移动或删除。

## 更新与开发

更新代码并重新部署：

```bash
git pull --recurse-submodules
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm install:rime
```

常用源码位置：

| 功能 | 位置 |
| --- | --- |
| 候选英文注释与请求入队 | `rime/lua/bilingual_filter.lua` |
| AI 刷新后恢复候选位置 | `rime/lua/selection_keeper.lua` |
| 中英混输与自动空格 | `rime/lua/mixed_input_translator.lua`、`rime/lua/mixed_spacing_filter.lua` |
| AI worker 与模型调用 | `src/worker.ts`、`src/translator.ts` |
| 安装与平台适配 | `src/install-rime.ts`、`src/platform.ts` |

完整设计说明：

- [系统架构与心智模型](ai-docs/ARCHITECTURE.zh-CN.md)
- [项目目录与产品化组织](ai-docs/PROJECT-ORGANIZATION.zh-CN.md)
- [输入体验与候选排序路线图](ai-docs/roadmap/input-experience-and-candidate-ranking.md)
- [AI 刷新时保留候选位置规格](ai-docs/spec/candidate-selection-preserving-ai-refresh.md)

生成可分发 ZIP 和 SHA-256：

```bash
pnpm package:release
```

欢迎提交 Issue 和 Pull Request。提交前请运行：

```bash
pnpm check
pnpm test
```

完整 Lua 测试需要安装 LuaJIT。Windows 没有 LuaJIT 时至少运行 `pnpm check && pnpm test:ts`；CI 会在 macOS 上执行 Lua 测试。

## 许可证

Borime 自身代码使用 [MIT License](LICENSE)。雾凇拼音、CC-CEDICT 及其他第三方内容继续遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
