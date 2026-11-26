# Console 设计系统

控制台页面、插件页面宿主和应用外壳共用这里的 React 组件与主题。五个模块由 [index.ts](index.ts) 汇总导出，浏览器入口按主题、控件、领域组件的顺序载入样式。[样式入口](../main.tsx)

| 开发需求 | 从哪里开始 |
| --- | --- |
| 让控件、图标和弹层随角色配色、明暗模式切换 | [tokens · 主题与图标](tokens/README.md) |
| 添加输入、选项、开关或操作按钮 | [primitives · 基础控件](primitives/README.md) |
| 变更跨页导航、命令面板、实例标识或检查器 | [shell · 应用外壳](shell/README.md) |
| 组合配置编辑、审批、追踪或遥测操作 | [composites · 组合组件入口](composites/index.ts) |
| 呈现特定领域的数据与工作台，如记忆血缘图、具身时间线或插件页面 | [domain-visualizers · 领域组件入口](domain-visualizers/index.ts) |

从现有页面跟踪实际用法时，可看控制台外壳如何装配全局组件，再到页面目录查看业务状态如何传给具体控件。[应用外壳](../app-shell.tsx) · [页面入口](../pages/index.ts)
