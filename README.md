# Rime Bilingual IME

鼠须管／小狼毫 + 雾凇小鹤双拼的中英候选扩展。候选命中本地缓存时，英文只显示在候选提示中：

想系统理解词库、Rime 用户词频、Lua filter、DeepSeek sidecar 和缓存一致性，请阅读[系统心智模型与架构说明](docs/ARCHITECTURE.zh-CN.md)。

```text
我的帽子  my hat
```

按空格确认时只上屏 `我的帽子`，英文不会进入正文。

前 5 个候选的缓存缺失项会写入本地队列；停止输入约 800 毫秒后，Node.js sidecar 只取最新 5 个未命中候选并批量翻译。新输入出现时，正在进行的旧模型请求会在约一个轮询周期内取消，旧结果不会写入缓存。Rime 的按键线程从不等待网络。

## 获取代码

```bash
git clone --recurse-submodules <repository-url> rime-bilingual-ime
cd rime-bilingual-ime
pnpm install --frozen-lockfile
cp .env.example .env
```

需要 Node.js 22 或更高版本、pnpm 10，以及已经安装好的 Rime 前端：macOS 使用鼠须管 Squirrel，Windows 使用小狼毫 Weasel。API Key 只写在每台机器自己的 `.env`，不得提交到 Git。

如果克隆时漏了 submodule：

```bash
git submodule update --init --recursive
```

## macOS 安装

```bash
pnpm build
pnpm install:rime
```

安装器会部署到 `~/Library/Rime`、注册 LaunchAgent、重载鼠须管。之后选择“小鹤双拼”。

## Windows 安装

在 PowerShell 中执行相同命令：

```powershell
pnpm build
pnpm install:rime
```

安装器会部署到 `%AppData%\Rime`，查找 `WeaselDeployer.exe`，注册当前用户登录时启动的 `RimeBilingualIME` 计划任务，并重新部署小狼毫。如果小狼毫安装在非标准目录，在 `.env` 设置：

```env
RIME_DEPLOYER_PATH=C:\Path\To\WeaselDeployer.exe
```

Windows 安装逻辑已有单元测试和 CI 配置，但尚未在你的 Windows 实机上完成首次验证；第一次安装建议保留安装器自动生成的 Rime 目录备份。

## 发行包

```bash
pnpm package:release
```

产物位于 `.release/`，包括 ZIP 和 SHA-256 校验文件。ZIP 内会展开雾凇词库并包含 macOS／Windows 安装代码，但不会包含 `.env`、API Key、个人 userdb、AI 动态缓存、请求队列或日志。

默认显示英文候选提示；按 `Control+Shift+B` 或在方案菜单中选择“中文”可以临时隐藏英文提示。

## DeepSeek

```bash
cp .env.example .env
```

只在本机编辑 `.env`。可以填写官方 DeepSeek 的 `DEEPSEEK_API_KEY`，也可以使用 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和 `MASTRA_CHAT_MODEL` 接入 OpenAI 兼容服务；兼容服务配置优先。不要把 key 写入 Rime 的 Lua/YAML。sidecar 会自动处理未命中的候选。

OpenAI 兼容路径只要求普通 `/chat/completions`，不会发送 `response_format`；模型返回的 JSON 文本由本地 Zod 校验。因此 curl 能调用、但不支持 `json_schema`／`json_object` 的兼容接口也可以使用。

翻译任务会显式关闭 DeepSeek thinking。这个任务只需要短 JSON；默认 high thinking 可能耗尽输出 token、导致正文为空或 JSON 被截断。AI SDK 自带重试已关闭，由可观测、可配置的 worker 重试层统一处理。

AI 请求默认在初次失败后最多重试 3 次，采用 2 秒、4 秒、8 秒指数退避；仍失败的批次会写入 `failed-requests.jsonl` 并跳过，不会无限调用接口。可通过 `.env` 中的 `RIME_BILINGUAL_MAX_RETRIES` 调整，设为 `0` 表示不重试。

项目随附的 85 条基础翻译位于 `rime/bilingual/seed.tsv`，是首版人工整理，并非从第三方英文词库导入。执行下面的预生成命令时，中文词按雾凇拼音 `cn_dicts/base.dict.yaml` 的权重选取，英文翻译由当前配置的模型生成。

也可以导入 GitHub 上自动更新的 CC-CEDICT 中英词典：

```bash
pnpm import:cedict
```

导入器使用 `qundao/backup-cc-cedict` 镜像，生成文件位于 Rime 用户目录下的 `bilingual/cedict.tsv`，导入完成后会自动重载鼠须管或小狼毫。CC-CEDICT 数据遵循 CC BY-SA 4.0，归属与转换说明见 `THIRD_PARTY_NOTICES.md`。人工种子和 AI 动态缓存的优先级高于 CC-CEDICT。

预生成更多常用词：

```bash
pnpm seed -- --count 2000
```

生成过程中会逐批保存，重复执行会跳过已有翻译。

## AI 翻译诊断

查看最近候选是否入队、防抖是否被后续输入打断、模型调用耗时、重试、失败和缓存写入：

```bash
pnpm diagnose
```

边打字边观察完整链路：

```bash
pnpm diagnose -- --watch
```

绕过 Rime 和队列，直接测试当前模型/API 的响应时间：

```bash
pnpm diagnose -- --probe "诊断翻译延迟"
```

探针会产生一次真实 API 请求。结构化事件保存在 Rime 用户目录的
`bilingual/diagnostics.jsonl`，包含输入过的候选文字，文件权限仅限当前用户，且不会进入发行包。
AI 写入缓存后，已经打开的候选窗不会自行刷新；诊断出现 `cache ready` 后重新输入该词即可看到英文。

## 行为边界

- 初始词表和已缓存词会立即在候选注释中显示英文，但始终只上屏中文。
- 新词第一次出现时显示 `AI 翻译中…`；sidecar 完成翻译后，后续输入或再次输入会显示带 `AI ·` 标记的英文候选提示。
- 纯中文模式不会创建翻译请求。
- 动态缓存位于 Rime 用户目录下的 `bilingual/dynamic.tsv`，可以私下备份或人工修订，不应提交到公开仓库。
- 英文注释最多显示 42 个 Unicode 字符，超长词典释义以省略号收尾；缓存仍保留完整值。
- 未移动候选时按 `Return` 上屏原始拼音；用上下／翻页键移动过候选后，`Return` 确认当前高亮候选。
- 在中文组合状态按 `Caps Lock / 中英`，会提交当前原始拼音并切换为英文模式；左右 `Shift` 也保留相同行为。再次按对应切换键可切回中文。
- 连续输入精确命中的“小鹤双拼中文前缀 + 英文词”会产生混输候选，例如 `dakdapp`（`dakd` = 打开）产生 `打开 APP`。按 `Control+Shift+M` 可临时关闭。
- 同一候选及相邻 Rime 上屏记录中的 CJK／ASCII 字母数字边界会自动补一个半角空格，例如 `打开APP设置` → `打开 APP 设置`。按 `Control+Shift+S` 可临时关闭。
- 自动空格也覆盖从中文切到 ASCII 模式后输入的第一个英文字符，但只能利用 Rime 自己的提交历史；手动移动光标、粘贴文本或在其他输入法中输入后，它无法可靠读取应用光标前的字符。
- 中文候选学习由 Rime userdb 按方案和编码路径记录。小鹤双拼中“有/又”的标准码是 `yz`；输入全拼式的 `you` 不等同于 `yz` 的个人词频路径，Emoji 滤镜还可能额外插入一个同字候选。

## 多机器同步

- GitHub 仓库同步代码、Lua、YAML 和安装脚本。
- Rime 自带的“用户资料同步”同步中文个人词频和造词记录；每台机器配置不同的 `installation_id`，让 `sync_dir` 指向同一个私有云盘目录。
- `dynamic.tsv` 是私人 AI 翻译缓存，Rime 默认不会同步 TSV；需要时单独通过私有云盘或备份脚本复制。
- `cedict.tsv` 可以在每台机器重新执行 `pnpm import:cedict` 生成，不必同步。
- `.env` 和 API Key 必须逐台配置。

显式导出和合并 AI 缓存：

```bash
pnpm cache:export -- --output /private/path/rime-ai-cache.tsv
pnpm cache:import -- --input /private/path/rime-ai-cache.tsv
```

导入采用合并语义，同名词条以导入文件为准；它不会覆盖整份本机缓存，也不会处理个人中文词频。
