# 参考插件与扩展接入

这个目录里的实现展示了扩展作者如何把能力提供给宿主。原生插件通过 `ai0.extension.json` 声明入口、切面和权限，再通过 `@ai0/sdk` 提供实现。daemon 的 `RuntimePluginLoader` 负责发现、加载和卸载，插件与宿主通过公共契约交互。[SDK 接入说明](../packages/sdk/README.md) · [运行时加载器](../apps/daemon/src/plugin-loader.ts)

| 要提供的能力 | 可参照的实现 |
| --- | --- |
| 把通道、表达端点和专属页面装在同一个包 | WebChat 在一份清单中声明多项切面和页面入口。[WebChat 清单](channels/webchat/ai0.extension.json) · [注册入口](channels/webchat/src/index.ts) |
| 感知事件去抖与撤稿 | 会话过滤器在激活时读配置，按通道、主体和受众保存暂存事件，卸载时清理。[会话过滤器](perception-filters/conversational-gate/src/index.ts) |
| 向话轮补充资料 | Lorebook 贡献者从获准读取的黑板域取数，把命中条目截入可用预算，并返回目标槽位。[上下文贡献者](cognitive-organs/lorebook-contributor/src/index.ts) |
| 将媒体播放进度接入回执 | TTS 插件注册媒体转码切面，其中的播放游标换算供表达层消费。[媒体插件](media-pipelines/emotion-tts-sideband/src/index.ts) |
| 提供声明式资源 | Skill 的入口是带元数据的 Markdown，流程资产由插件清单与流程文件描述。宿主将受支持的载体声明投影到能力接点。[Skill 示例](skills-and-mcp/daily-companion-review/SKILL.md) · [流程清单](flows-and-assets/late-night-coding-care/ai0.extension.json) · [载体投影](../apps/daemon/src/carrier-projections.ts) |

原生包通常位于 `plugins/<类别>/<包名>/`，清单的 `entry` 指向构建产物。改动源码后从仓库根目录构建插件，再检查工作区依赖边界。原生插件可直接引用的内部包为 `@ai0/protocol` 和 `@ai0/sdk`。[工作区清单](../pnpm-workspace.yaml) · [边界检查脚本](../scripts/verify-architecture-boundaries.mjs)

```bash
pnpm build:plugins
pnpm verify:boundaries
```
