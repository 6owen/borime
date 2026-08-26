# 项目目录、个人配置与产品化组织

## 1. 结论

当前系统主要涉及两个目录，但它们不是两份需要合并的源码：

```text
/Users/wangwenbo/Desktop/rime-bilingual-ime
    产品真源：源码、测试、安装器和当前正在运行的 AI worker

/Users/wangwenbo/Library/Rime
    Rime 运行目录：已部署配置、编译产物、个人词频和翻译运行数据
```

另有一个 macOS 后台服务定义：

```text
~/Library/LaunchAgents/com.local.rime-bilingual.plist
```

它目前直接执行项目目录中的 `dist/worker.js`。因此项目目录现在同时是开发仓库和已安装程序目录；移动或删除项目后必须重新安装后台服务。

推荐目标不是把两个目录物理合并，而是实现：

```text
一个产品仓库 + 一个安装入口 + 清晰分离的个人设置和运行数据
```

## 2. 为什么不能直接合并

鼠须管约定从 `~/Library/Rime` 读取用户配置，并在那里维护 userdb 和编译产物。这个目录具有运行时语义：文件会不断变化，也可能被进程加锁。

Git 仓库则需要可重复构建、可以审查和发布。把 userdb、日志、请求记录和 API Key 混入仓库会产生以下问题：

- 更新代码可能覆盖个人词频。
- Git 会持续出现与源码无关的脏文件。
- 输入记录、AI 缓存或凭据可能被误推送到 GitHub。
- macOS 和 Windows 的运行目录不同，仓库不再可移植。
- 卸载、升级和数据备份的边界无法定义。

软链接可以减少文件复制，但不会解决这些边界问题，因此不应作为发布架构。

## 3. 当前数据流

```text
Git 仓库 rime/ 与 vendor/rime-ice
             │
             │ pnpm install:rime
             ▼
       ~/Library/Rime
       ├── Lua / YAML：由安装器部署
       ├── build：Rime 编译产物
       ├── *.userdb：Rime 个人词频
       └── bilingual：翻译缓存、队列和诊断
             ▲
             │ 文件队列与 TSV 缓存
             ▼
  LaunchAgent → dist/worker.js → DeepSeek API
```

Lua filter 不直接访问网络。它只读取本地翻译缓存并把未命中候选写入队列；Node/TypeScript worker 消费最新队列快照、请求模型并写回缓存。

## 4. 三层配置模型

长期应当明确区分以下三层。

### 4.1 产品默认设置

随公共仓库发布，例如：

- 默认开启双语提示。
- 默认翻译前 5 个候选。
- 默认注释最大长度为 42。
- 默认快捷键。
- Lua 组件及其排列顺序。

默认设置必须能够安全公开，并且升级时允许改变。

### 4.2 用户个人设置

建议以后存放在：

```text
~/Library/Application Support/Rime Bilingual/settings.json
```

Windows 对应 `%AppData%` 或 `%LocalAppData%` 下的产品目录。配置可以表达：

```json
{
  "model": "deepseek-v4-flash",
  "maxCandidates": 5,
  "maxCommentLength": 42,
  "translationEnabled": true,
  "mixedInputEnabled": true,
  "smartEnterEnabled": true,
  "pinnedCandidates": {
    "you": ["有"]
  }
}
```

设置 UI 只修改这个稳定的数据模型。安装器把“产品默认设置 + 用户设置”编译成 Rime 最终需要的 YAML，而不是让 UI 对 YAML 做字符串替换。

### 4.3 运行数据

继续由 Rime 用户目录保存：

```text
~/Library/Rime/
├── rime_ice.userdb/          # 中文选词和个人词频
├── melt_eng.userdb/          # 英文用户词典数据
└── bilingual/
    ├── dynamic.tsv           # AI 翻译缓存
    ├── requests.txt          # 候选请求队列
    ├── diagnostics.jsonl     # 诊断事件，包含候选文字
    ├── failed-requests.jsonl
    └── worker.log
```

运行数据不进入公共 Git 仓库。安装和升级默认保留它；卸载时让用户选择是否删除。

最终覆盖顺序应当是：

```text
本机临时状态 > 用户个人设置 > 产品默认设置
```

## 5. 推荐的仓库结构

现阶段不需要为了形式立刻拆 monorepo。等 UI 开始开发后，可以逐步演进为：

```text
rime-bilingual-ime/
├── apps/
│   └── desktop/                 # 设置窗口、托盘和安装体验
├── packages/
│   ├── core/                    # 翻译、缓存、队列、重试
│   ├── cli/                     # install/status/diagnose/backup
│   ├── platform/                # macOS/Windows 平台适配
│   └── rime-integration/        # Lua、YAML 模板、配置生成器
├── profiles/
│   └── default/                 # 可公开的默认 profile
├── vendor/
│   └── rime-ice/
├── docs/
└── tests/
```

拆分标准是模块是否已经有独立生命周期，而不是文件数量。当前 `src/` 保持扁平并不妨碍先完成配置边界。

## 6. 哪些内容可以公开

适合提交和发布：

- TypeScript 与 Lua 源码。
- Rime patch 模板。
- 不含隐私的基础翻译。
- 安装、升级、诊断和测试代码。
- 文档、许可证与第三方声明。

不得进入公开发行包：

- `.env` 和 API Key。
- `*.userdb` 个人词频。
- `dynamic.tsv` 私人 AI 缓存。
- `requests.txt`、诊断事件和日志。
- Rime 的运行时 build 目录。

即使发布桌面应用，也不能内置开发者自己的 DeepSeek Key；桌面客户端中的共享密钥可以被提取。公开产品应使用 BYOK，由用户填写自己的 Key。后续应把凭据保存到 macOS Keychain 或 Windows Credential Manager，而不是普通 JSON。

## 7. UI 的合理职责

第一版设置 UI 应聚焦可诊断、可恢复的能力：

- 安装状态和 Rime 前端版本。
- Worker 是否运行。
- API Base URL、模型和 Key 配置。
- API 连通性与耗时探针。
- 双语提示、候选数量、注释长度和混输开关。
- 缓存条目数、导入、导出和清除。
- 最近请求的入队、模型耗时、缓存写入和候选刷新状态。
- 一键部署、修复、备份和恢复。

现有实现是 Node.js + TypeScript。产品化时 Electron 的主进程可以承载平台安装逻辑，渲染进程只负责 UI；两者通过受限 IPC 通信。AI worker 应继续作为独立 worker/utility process，避免模型请求或文件轮询阻塞界面。

如果短期只想验证交互，可以先在现有 Node 进程中增加 localhost 设置页；但这仍要求用户安装 Node。面向普通用户的一键安装版本最终需要把运行时和应用一起打包。

## 8. 安装器应当托管什么

安装器必须维护一份 manifest，记录它负责的文件。升级时只覆盖这些受管文件：

- 双语 Lua 组件。
- 产品生成的 schema patch。
- 默认资源和版本标记。
- 后台服务定义。

以下数据只读取或迁移，不能无条件覆盖：

- userdb。
- AI 动态缓存。
- 用户 settings/profile。
- 用户自己的 Rime 扩展。

还应提供四个对称动作：

```text
install → upgrade → repair → uninstall
```

`uninstall` 默认保留个人数据，并明确提示数据位置。

## 9. 多机器与 Windows

不同类型的数据采用不同同步方式：

- GitHub：同步公共代码、默认配置和安装器。
- Rime 用户资料同步：同步个人词频和造词。
- 私有备份：同步 `dynamic.tsv` AI 缓存。
- 每台机器单独配置：API Key 和系统后台服务。
- 可重新生成：CC-CEDICT 等公共词典缓存。

macOS 的目标目录是 `~/Library/Rime`，Windows 通常是 `%AppData%\Rime`。平台层应负责解析路径、安装后台任务、重载前端；core 和 UI 不应硬编码这些路径。

## 10. 推荐实施顺序

1. 定义版本化 `settings.json`，区分默认设置与用户设置。
2. 让安装器生成 YAML，并只管理 manifest 中声明的文件。
3. 增加配置迁移、卸载、修复、备份和恢复。
4. 把 status/diagnose 形成稳定的内部服务接口。
5. 实现本地设置页面。
6. 再包装为 macOS/Windows 桌面应用和安装包。

判断架构是否健康可以用一句话检验：

> 删除并重新安装程序后，个人词频和翻译缓存仍在；复制公开仓库后，不会带走任何个人输入、凭据或日志。
