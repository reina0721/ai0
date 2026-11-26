# Console 应用外壳

这里的组件承载各工作区共用的顶栏、导航、内容区和检查器。`app-shell.tsx` 从控制台上下文与快照取值，再把当前路由、实例、扩展入口和操作回调传给这些组件。[装配位置](../../app-shell.tsx) · [组件入口](index.ts)

| 需要更改的位置 | 组件与输入 |
| --- | --- |
| 全局布局与实例标识 | `SovereigntyViewportFrame` 接收 `targetInstance` 和 `topBar`、`navigationRail`、`main`、`contextInspector`、`overlays` 插槽。沙箱实例会显示独立提示条。[布局](SovereigntyViewportFrame.tsx) |
| 顶栏及待审批操作 | `HybridTopBar` 接收角色、主题、审批列表与回调。批准、拒绝和切换实例的动作由外壳调用方执行。[顶栏](HybridTopBar.tsx) |
| 工作区导航 | `PolymorphicNavRail` 接收当前路径、导航模式和 `extensionLinks`。应用同时将扩展入口传给 `CommandPaletteModal` 的 `extensionItems`，使页面在导航栏和命令面板中都可找到。[导航栏](PolymorphicNavRail.tsx) · [命令面板](CommandPaletteModal.tsx) |
| 内置页面的内容区 | `MainRoundedCardOutlet` 组合子导航与滚动正文，子导航从控制台路由表解析当前工作区。[内容区](MainRoundedCardOutlet.tsx) · [路由表](../../router/routes.tsx) |
| 话轮与沙箱对比 | `PolymorphicContextInspector` 接收当前追踪记录及 live、sandbox 对比记录，按 `mini`、`trace` 或 `sandbox-diff` 模式显示。[检查器](PolymorphicContextInspector.tsx) |

在仓库根目录运行外壳的渲染测试，覆盖内置路由、沙箱标识及插件页面不可用时的展示。

```sh
pnpm exec vitest run apps/console/src/console-m6.test.ts
```
