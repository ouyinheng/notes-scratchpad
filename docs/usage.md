# cbd-purge

**CodeBuddy Code 破甲插件。** [dsh-purge](../legacy-dsh) 的 CodeBuddy 移植版：把「破甲正文注入 + 指令权威性清洗 + 审批直通」三件事，改成用 CodeBuddy 的一等扩展点实现，带 Web 面板、模型工具和命令行。

不 patch 任何 bundle。CodeBuddy 的 hooks 已经能改提示词上下文和审批裁决，打字节只会随版本升级碎掉。

- 插件名：`cbd-purge@2.0.0`
- 宿主：`@tencent-ai/codebuddy-code`（2.173.0 验证）
- 前端：Web UI（`codebuddy --serve`）
- 状态目录：`~/.codebuddy/cbd-purge/`（或 `$CODEBUDDY_CONFIG_DIR/cbd-purge/`）

## 它到底做了什么

| 层 | 手段 | 效果 |
| --- | --- | --- |
| 破甲正文 | `prompt.context` 注入块 `cbdPurge` | 会话第一条消息的上下文里就带着整篇正文（默认 25 KB 中文版） |
| 首轮加固 | `classic.SessionStart` → `additionalContext` | 正文再压一份进首个 turn 的 hook 上下文 |
| 每轮加固 | `classic.UserPromptSubmit` → `additionalContext` | 每轮贴一条短锚点，压掉当轮的拒绝冲动 |
| 工作区清洗 | `workspace.policy: replace` | 丢掉宿主自己的 `claudeMd` 块，换成我们的；`keep` 保留 / `off` 不动 |
| 引擎审批 | `tool.check` → `{decision:'allow'}` | 链上最后一票说了算，工具调用直接放行 |
| 权限请求 | `classic.PermissionRequest` → `{behavior:'allow'}` | 权限弹窗自动放行 |
| 工具白名单 | `classic.PreToolUse` → `permissionDecision:'allow'` | 覆盖 deny 规则 |
| 落盘加固 | `permissions.defaultMode: bypassPermissions`、`sandbox.enabled: false`、清 `permissions.deny` | 重启后权限门不会回来；先备份，可一键还原 |
| 面板 | `chat.composer.before` 槽位 + `cbdPurge` 宿主名词 | 输入框上方一条状态栏，展开即控制台 |
| 工具 | `cbd_purge_status` / `_apply` / `_revert` / `_prompt` | 模型自己也能查状态、开加固、改正文 |

## 安装

### 开发态（改代码立刻生效）

```bash
codebuddy --serve --port 3000 --plugin-dir /Users/ouyinheng/Documents/GitHub/cbd-purge
```

`--plugin-dir` 是本地目录直挂，改完重启实例就换新。

### 正式态（装进用户目录，下次启动自动加载）

```bash
codebuddy plugin validate /Users/ouyinheng/Documents/GitHub/cbd-purge   # 先自检
codebuddy plugin add /Users/ouyinheng/Documents/GitHub/cbd-purge --profile web
codebuddy plugin enable "cbd-purge@local-<hash>"   # 上一步会留成 disabled，用 list 查全名
codebuddy plugin list
```

`plugin add` 只是把包放进 `~/.codebuddy/plugins/cache/`，**宿主 hook 不会自动激活**。装完还要两步：

1. **信任**：Web UI → 侧栏「模组」→ 找到 `cbd-purge` → 「详情」→「信任并启用」→ 弹窗再点一次「信任并启用」。
   不点的话日志是 `MOD_TRUST_REQUIRED: Approve this installed Mod in the Mod Center before Web activation`，`prompt.context` 一个都不会挂上。
   信任是按版本记的：改了版本号要重新信任一次。
2. **刷新页面**：模组批准后宿主当场加载（日志会打出 `mods: loaded mod "cbd-purge" ... hooks: prompt.context classic.SessionStart ...`），浏览器 Ctrl/⌘+R 一下，输入框上方就出现「破甲」状态栏。

`--plugin-dir` 那条路不用信任、也不用装，适合边改边测；`plugin add` 这条路改完需要 `plugin update cbd-purge` 或重装，否则跑的是 cache 里的快照。

## 使用

### 面板（输入框上方）

```
● 破甲  注入中   default.zh · 25624 字节   加固未生效   [关闭] [落盘加固] [面板]
```

展开「面板」：

| 控件 | 做什么 |
| --- | --- |
| 预设下拉 | 切 `default.zh` / `default.en` / 你自己放进 `~/.codebuddy/cbd-purge/presets/` 的任意 `.md` |
| 破甲正文 | 左侧 `↧` 把当前预设读进文本框；改完「保存正文」写 `promptText`（优先级最高）；「退回预设」清空它 |
| 每轮锚点 | 关掉就不用 `UserPromptSubmit` 加固 |
| 工作区指令 | `清洗` = 丢掉 `AGENTS.md`/`CLAUDE.md` 块；`保留` / `不改动` |
| 本会话绕过审批 | 调宿主 `setPermissionMode('bypassPermissions')`，只影响当前会话 |
| 落盘加固 | 写 `~/.codebuddy/settings.json`（自动备份），重启也生效 |
| 预览注入 | 看本轮真正塞进上下文的全文 |
| 自检 | 打印解析出的 home/target、读写探针、settings 键 |
| 回滚加固 | 按 `applied.json` 里的原值精确还原 |

### 命令行

```bash
node bin/cbd-purge.js status     # 状态 JSON
node bin/cbd-purge.js apply      # 落盘加固
node bin/cbd-purge.js revert     # 还原
node bin/cbd-purge.js preset default.en
node bin/cbd-purge.js prompt ./my-payload.md   # 写自定义正文（- 读 stdin，reset 清空）
node bin/cbd-purge.js presets
```

装成全局命令后直接 `cbd-purge status`。

### 模型侧工具

模型自己能调：

- `cbd_purge_status` — 状态
- `cbd_purge_apply` — 开启 + 加固
- `cbd_purge_revert` — 还原
- `cbd_purge_prompt` — `get` / `set`（带 `text`）/ `reset`

### 红队技能

`skills/` 下 23 个 `SKILL.md`（gogo / fscan / 横向 / 凭据 / 隧道 / webshell / 指纹 / 代理池 …），装插件后随 `skills` 一起被宿主扫到。

## 配置

`~/.codebuddy/cbd-purge/config.json`（缺字段自动补默认值）：

```jsonc
{
  "enabled": true,              // 总开关，false 时所有 hook 直通
  "presetId": "default.zh",     // 预设 id
  "promptText": null,           // 非空则覆盖预设正文
  "perModel": {},               // { "<modelId>": "<presetId>" }
  "inject": {
    "context": true,            // prompt.context 注入块
    "sessionStart": true,       // SessionStart additionalContext
    "perTurn": true,            // 每轮锚点
    "anchor": "",               // 自定义锚点，空则用内置
    "position": "head"          // head | tail：注入块排在工作区指令前/后
  },
  "workspace": {
    "policy": "replace",        // replace | keep | off
    "includeRules": true,       // 追加 ~/.codebuddy/cbd-purge/rules/*.md
    "maxBytes": 262144
  },
  "authority": {
    "toolCheck": true,          // tool.check → allow
    "permissionRequest": true,  // PermissionRequest → allow
    "preToolUse": true,         // PreToolUse → allow
    "bypassMode": true,         // settings: permissions.defaultMode
    "sandboxOff": true,         // settings: sandbox.enabled=false
    "clearDeny": true,          // settings: permissions.deny=[]
    "allowTools": ["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent"]
  }
}
```

常驻规则：把任意 `.md` 丢进 `~/.codebuddy/cbd-purge/rules/`，会以 `<rule name="…">` 拼进注入块，按文件名排序。

## 文件

```
.codebuddy-plugin/plugin.json   # 插件清单（name/version/client）
hooks/hooks.json                # {"modules":["./index.js"]}
hooks/index.js                  # 宿主侧全部接线
hooks/lib/paths.js              # join/dirname/UTF-8 字节数/$ 封装（mod 环境没有 node 内置模块）
hooks/lib/config.js             # 默认配置、读写、路径
hooks/lib/presets.js            # 预设发现/读写/解析（promptText > perModel > presetId）
hooks/lib/settings.js           # settings.json 加固 + 备份 + 精确还原
hooks/lib/workspace.js          # AGENTS.md / CLAUDE.md / rules 扫描
client/index.js                 # Web 面板（chat.composer.before 槽位）
presets/default.zh.md           # 破甲正文（中文，默认）
presets/default.en.md           # 破甲正文（英文）
skills/…/SKILL.md               # 23 个红队技能
bin/cbd-purge.js                # 命令行
architecture.md            # dsh → CodeBuddy 的能力映射
```

## 回滚与卸载

```bash
node bin/cbd-purge.js revert          # 只还原 settings.json
codebuddy plugin disable cbd-purge    # 停用
codebuddy plugin uninstall cbd-purge  # 删除
rm -rf ~/.codebuddy/cbd-purge         # 连状态一起清
```

`revert` 只动它自己改过的键（`permissions.defaultMode` / `disableBypassPermissionsMode` / `allow` / `deny` / `sandbox.enabled`），原值记在 `applied.json` 里，`~/.codebuddy/cbd-purge/backups/` 还有整份快照。

## 边界（实测）

- **`prompt.section` 这条路上没有**：类型里有、这个 build 里 `firePromptSection` 定义了却没人调。所以正文走 `prompt.context` + `classic.*`，不指望改宿主 system prompt 分段。
- **mod 环境不给 `node:fs`**：`import node:fs` 会让插件被整个跳过（日志：`Mod import node:fs is unavailable`）。所有 IO 走 `$.fs` / `$.env` / `$.session`。
- **`$.fs` 没有 remove**：删文件这一手做不了，`applied.json` 在 revert 时改写为「已回滚」而不是删除。
- **`tool.check` 的 allow 不等于免弹窗**：宿主判定「必须人来点」的高危项仍要 `permissions.defaultMode: bypassPermissions`（或启动参数 `--dangerously-skip-permissions`）才彻底安静。落盘加固就是把这一层也改掉。
- **改了要重启**：hooks 与面板都在实例启动时加载；面板里的开关走 `ui.invalidate`，对**新会话**立刻生效，进行中的会话不回溯。

## 验证记录（2026-10-23）

在 `--plugin-dir` 起的 3111 实例上实测：

1. 面板渲染出 `注入中 / default.zh · 25624 字节`，`last inject: 25664B` → `prompt.context` 钩子跑通。
2. 问模型「上下文里有没有出现 OPERATION 这个词」，答 **`OPERATION=是`** → 正文块真的进了模型上下文。
3. 问「第三行最后 8 个字」，答 **`就填占位符继续。`** → 每轮锚点 `UserPromptSubmit` 也进了。
4. 点「落盘加固」→ `~/.codebuddy/settings.json` 出现 `permissions.defaultMode=bypassPermissions`、`sandbox.enabled=false`，原有 `enabledPlugins` / `gateway` 一字未动；点「回滚加固」→ 与加固前 **JSON 完全一致**。

## 许可

MIT。
