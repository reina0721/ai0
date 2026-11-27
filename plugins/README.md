# 参考插件与扩展接入

这个目录里的实现展示了扩展作者如何把能力提供给宿主。原生插件通过 `ai0.extension.json` 声明入口、切面和权限，再通过 `@ai0/sdk` 提供实现。daemon 的 `RuntimePluginLoader` 负责发现、加载和卸载，插件与宿主通过公共契约交互。[SDK 接入说明](../packages/sdk/README.md) · [运行时加载器](../apps/daemon/src/plugin-loader.ts)

| 要提供的能力 | 可参照的实现 |
| --- | --- |
| 受控工作区文件、补丁、只读 Git 诊断与沙箱命令 | 工作区工具箱同时提供 9 项主动工具（含 `glob_files`、`apply_patch`、`git_status_diff`）与可选文件变更感知源。[工作区清单](agent-tools/workspace-tools/ai0.extension.json) · [实现入口](agent-tools/workspace-tools/src/index.ts) |
| 防 SSRF 联网搜索与网页抓取 | 联网工具箱提供 `web.search` 与 `web.fetch_url`，返回结果固定标记 `untrusted_external` 以联动同轮写/执行熔断。[联网清单](agent-tools/web-tools/ai0.extension.json) · [SSRF 守卫](agent-tools/web-tools/src/ssrf-guard.ts) |
| 零副作用精确计算与时间/JSON 辅助 | 辅助工具箱默认启用，提供无 `eval` 数学求值、IANA 时区换算与 JSON 路径查询。[辅助清单](agent-tools/utility-tools/ai0.extension.json) · [数学求值器](agent-tools/utility-tools/src/math-eval.ts) |
| 渐进式无头 MCP 标准协议桥 | MCP 桥接包读取标准 `mcpServers` 配置，以 3 个固定工具按需代理任意 `stdio/SSE/HTTP` MCP 服务。[MCP 桥清单](agent-tools/mcp-bridge/ai0.extension.json) · [桥接实现](agent-tools/mcp-bridge/src/index.ts) |
| 把通道、表达端点和专属页面装在同一个包 | WebChat 在一份清单中声明多项切面和页面入口。[WebChat 清单](channels/webchat/ai0.extension.json) · [注册入口](channels/webchat/src/index.ts) |
| 感知事件去抖与撤稿 | 会话过滤器在激活时读配置，按通道、主体和受众保存暂存事件，卸载时清理。[会话过滤器](perception-filters/conversational-gate/src/index.ts) |
| 向话轮补充资料 | Lorebook 贡献者从获准读取的黑板域取数，把命中条目截入可用预算，并返回目标槽位。[上下文贡献者](cognitive-organs/lorebook-contributor/src/index.ts) |
| 将媒体播放进度接入回执 | TTS 插件注册媒体转码切面，其中的播放游标换算供表达层消费。[媒体插件](media-pipelines/emotion-tts-sideband/src/index.ts) |
| 提供声明式资源与通用/伴侣 `SKILL.md` | 包含通用代码工程 SOP、多源调研核验 SOP 与伴侣晚安复盘技能，支持通过 `agent.list_skills / activate_skill` 按需渐进激活。[代码工程技能](skills-and-mcp/systematic-code-engineering/SKILL.md) · [核验调研技能](skills-and-mcp/verified-research-synthesis/SKILL.md) · [伴侣复盘技能](skills-and-mcp/daily-companion-review/SKILL.md) · [流程清单](flows-and-assets/late-night-coding-care/ai0.extension.json) |

原生包通常位于 `plugins/<类别>/<包名>/`，清单的 `entry` 指向构建产物。改动源码后从仓库根目录构建插件，再检查工作区依赖边界。原生插件可直接引用的内部包为 `@ai0/protocol` 和 `@ai0/sdk`。[工作区清单](../pnpm-workspace.yaml) · [边界检查脚本](../scripts/verify-architecture-boundaries.mjs)

```bash
pnpm build:plugins
pnpm verify:boundaries
```
