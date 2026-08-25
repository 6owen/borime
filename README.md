# Rime Bilingual IME

鼠须管 + 雾凇小鹤双拼的中英候选原型。候选命中本地缓存时，英文只显示在候选提示中：

想系统理解词库、Rime 用户词频、Lua filter、DeepSeek sidecar 和缓存一致性，请阅读[系统心智模型与架构说明](docs/ARCHITECTURE.zh-CN.md)。

```text
我的帽子  my hat
```

按空格确认时只上屏 `我的帽子`，英文不会进入正文。

前 5 个候选的缓存缺失项会写入本地队列；停止输入约 800 毫秒后，Node.js sidecar 只取最新 5 个未命中候选，并使用 Vercel AI SDK 的官方 `@ai-sdk/deepseek` provider 批量翻译。Rime 的按键线程从不等待网络。

## 安装

```bash
pnpm install
pnpm build
pnpm install:rime
```

安装鼠须管后重新部署，选择“小鹤双拼”。默认显示英文候选提示；按 `Control+Shift+B` 或在方案菜单中选择“中文”可以临时隐藏英文提示。

## DeepSeek

```bash
cp .env.example .env
```

只在本机编辑 `.env`。可以填写官方 DeepSeek 的 `DEEPSEEK_API_KEY`，也可以使用 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和 `MASTRA_CHAT_MODEL` 接入 OpenAI 兼容服务；兼容服务配置优先。不要把 key 写入 Rime 的 Lua/YAML。sidecar 会自动处理未命中的候选。

AI 请求默认在初次失败后最多重试 3 次，采用 2 秒、4 秒、8 秒指数退避；仍失败的批次会写入 `failed-requests.jsonl` 并跳过，不会无限调用接口。可通过 `.env` 中的 `RIME_BILINGUAL_MAX_RETRIES` 调整，设为 `0` 表示不重试。

项目随附的 85 条基础翻译位于 `rime/bilingual/seed.tsv`，是首版人工整理，并非从第三方英文词库导入。执行下面的预生成命令时，中文词按雾凇拼音 `cn_dicts/base.dict.yaml` 的权重选取，英文翻译由当前配置的模型生成。

也可以导入 GitHub 上自动更新的 CC-CEDICT 中英词典：

```bash
pnpm import:cedict
```

导入器使用 `qundao/backup-cc-cedict` 镜像，生成文件位于 `~/Library/Rime/bilingual/cedict.tsv`，导入完成后会自动重载鼠须管。CC-CEDICT 数据遵循 CC BY-SA 4.0，归属与转换说明见 `THIRD_PARTY_NOTICES.md`。人工种子和 AI 动态缓存的优先级高于 CC-CEDICT。

预生成更多常用词：

```bash
pnpm seed -- --count 2000
```

生成过程中会逐批保存，重复执行会跳过已有翻译。

## 行为边界

- 初始词表和已缓存词会立即在候选注释中显示英文，但始终只上屏中文。
- 新词第一次出现时显示 `AI 翻译中…`；sidecar 完成翻译后，后续输入或再次输入会显示带 `AI ·` 标记的英文候选提示。
- 纯中文模式不会创建翻译请求。
- 动态缓存位于 `~/Library/Rime/bilingual/dynamic.tsv`，可以备份或人工修订。
- 英文注释最多显示 42 个 Unicode 字符，超长词典释义以省略号收尾；缓存仍保留完整值。
- 未移动候选时按 `Return` 上屏原始拼音；用上下／翻页键移动过候选后，`Return` 确认当前高亮候选。
- 在中文组合状态按 `Caps Lock / 中英`，会提交当前原始拼音并切换为英文模式；左右 `Shift` 也保留相同行为。再次按对应切换键可切回中文。
- 连续输入精确命中的“小鹤双拼中文前缀 + 英文词”会产生混输候选，例如 `dakdapp`（`dakd` = 打开）产生 `打开 APP`。按 `Control+Shift+M` 可临时关闭。
- 同一候选及相邻 Rime 上屏记录中的 CJK／ASCII 字母数字边界会自动补一个半角空格，例如 `打开APP设置` → `打开 APP 设置`。按 `Control+Shift+S` 可临时关闭。
- 自动空格只能利用 Rime 自己的提交历史；手动移动光标、粘贴文本或在其他输入法中输入后，它无法可靠读取应用光标前的字符。
