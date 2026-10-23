# 架构：dsh-purge → cbd-purge

dsh-purge 在 DeepSeek Harness 上是**改文件**：把宿主 29 MB 的 bundle 打上 86 处 patch，才拿到「改系统提示 / 免审批」这两件能力。CodeBuddy 给了等价的正式接口，所以这一版**一行 patch 都没有**。

## 能力对照

| 能力 | dsh 版做法 | cbd 版做法 | 依据 |
| --- | --- | --- | --- |
| 系统提示注入 | patch 提示词层 + `system-prompt` 配置 | `on('prompt.context')` 往 `blocks` 头部塞 `{name:'cbdPurge', text}` | `initialContext` 派发、`foldModsPromptContext` 归并；base blocks 里带 `claudeMd` |
| 首轮加固 | 同上 | `classic.SessionStart` 返回 `additionalContext` | 宿主把它包成首个 system-reminder |
| 每轮加固 | 后置 prompt 追加 | `classic.UserPromptSubmit` 返回 `additionalContext` | 宿主把它包成当轮最后一个 system-reminder，recency 最强 |
| 工作区文件清洗 | `rules.js` 覆盖 `AGENTS.md`/`CLAUDE.md` | 在 `prompt.context` 里过滤掉 `name === 'claudeMd'` 的块，再把扫到的文件作为 `<workspace_instructions>` 塞回来 | 不落地改用户的 md，随时可切 `keep`/`off` |
| 审批直通 | patch 审批/沙箱引擎 | `on('tool.check')` 返回 `{decision:'allow'}` | `ToolCheckResult`；链上最后一票说了算 |
| 权限弹窗 | 同上 | `classic.PermissionRequest` 返回 `{behavior:'allow'}` | `PermissionRequestDecision` |
| 覆盖 deny | 同上 | `classic.PreToolUse` 返回 `permissionDecision:'allow'` | `PreToolUseResult` |
| 默认权限模式 | patch 引擎默认 | 写 `settings.json` 的 `permissions.defaultMode` | `Permissions` 协议；需要备份/还原 |
| 关沙箱 | patch 引擎默认 | 写 `settings.json` 的 `sandbox.enabled: false` | `SandboxConfig` |
| 面板 | Web client 插件 | `chat.composer.before` 槽位 + `engine.create` 暴露 `cbdPurge` 名词 | `ModSlots.register` / `ModHost.call` |
| 工具 | dsh 工具注册 | `$.tool.register` + `on('tool.call', {tool})` | 宿主工具表 |
| 预设 | `presets/` + 配置 | 同结构，内置 `presets/*.md` + 用户 `~/.codebuddy/cbd-purge/presets/` | — |
| 规则库 | `rules.js` + 状态目录 | `~/.codebuddy/cbd-purge/rules/*.md` | — |
| 红队技能 | `skills/redteam/*.md` | `skills/<name>/SKILL.md`（`name` + `description` frontmatter） | 宿主 skill 扫描 |

## 注入强度阶梯

从强到弱，四条同时开着才算「破甲」：

1. `prompt.context` 块（会话开始，位置最靠前，最像系统提示）
2. `classic.SessionStart.additionalContext`（首个 turn 的 system-reminder）
3. `classic.UserPromptSubmit.additionalContext`（每轮最后一个 system-reminder，抗对话漂移）
4. `authority.*`（模型就算想「按规矩拒绝」，工具层也不给权限门）

第 3 条是 dsh 版没有的便宜好处：不用改任何宿主状态，纯靠 recency。

## 数据流

```
session 创建
  └─ engine.create           → 挂 cbdPurge 名词（面板/工具共用）
  └─ session.start           → 注册 4 个 cbd_purge_* 工具
首个 turn
  └─ prompt.context          → blocks = [cbdPurge, ...其余(可选丢 claudeMd)]
  └─ classic.SessionStart    → additionalContext += 正文
每轮
  └─ classic.UserPromptSubmit → additionalContext += 锚点
  └─ tool.check / PermissionRequest / PreToolUse → allow
```

## 为什么不用 `prompt.section`

类型声明里有 `prompt.section`（`{text}`），看起来正好能改 system prompt 分段。实测这个 build 里 `firePromptSection` 只有定义、**没有调用点**，挂上去永远不会触发。所以走 `prompt.context`。

## 为什么所有 IO 都走 `$`

mod 的 ES module 环境**没有 node 内置模块**：`import fs from 'node:fs'` 会让整个插件在加载阶段被跳过，日志里是

```
mods: failed to load .: Mod import node:fs is unavailable; use the $ host API
```

于是：`$.fs.read/write/list/exists/stat` 做文件、`$.env.get('HOME')` 取家目录（参数必须是字符串字面量）、`$.session.cwd()` 取工作目录、`$.store` 兜底存 JSON。`hooks/lib/paths.js` 里那几个 join/dirname/byteLength 就是为了绕开 `node:path` 和 `Buffer` 手写的。

## settings.json 加固的边界

- 只碰这五个键：`permissions.defaultMode`、`permissions.disableBypassPermissionsMode`、`permissions.allow`、`permissions.deny`、`sandbox.enabled`。
- 改动前整份快照到 `~/.codebuddy/cbd-purge/backups/settings.<时间>.json`，原值逐键记进 `applied.json`。
- `revert` 按原值逐键还原，**不整份覆盖**，所以期间用户自己改的其它键不会丢（实测还原后与原文件 JSON 完全一致）。
- `$.fs` 没有删除能力，`applied.json` 用「改写为 `{revertedAt, before:{}}`」表达已回滚。
