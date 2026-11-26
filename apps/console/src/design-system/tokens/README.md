# Console 主题与图标

控制台在根元素写入 `data-soul-theme` 和 `data-appearance`。CSS 按这两个属性提供三种角色配色及其明暗变体。组件可以直接使用 `var(--ai0-on-surface)`、`var(--ai0-surface-main-card)` 等语义变量，控件尺寸、间距、动效时长也在同一处定义。[主题样式](console-theme.css) · [应用外壳](../../app-shell.tsx)

- **页面与导航**从目录入口导入 `ConsoleSoulTheme`、`CONSOLE_SOUL_THEMES` 和 `renderConsoleIcon(name, size?)`。可用图标名称由 `ConsoleIconName` 约束。[目录入口](index.ts) · [图标映射](icons.ts)
- **MUI 组件**通过外壳的 `ThemeProvider` 获取 `consoleMaterialThemes[appearance]`。这个对象在 `material-theme.ts` 中单独导出，其中的弹层配置将 Dialog、Drawer 等组件挂到 `[data-console-root]`，以继承当前实例的主题变量。[MUI 主题](material-theme.ts)
- **live 与 sandbox 实例**使用固定标识色。调整角色主题时，保留 live 的绿色与 sandbox 的琥珀色、紫色，用户可以据此区分当前操作目标。[实例外框](../shell/SovereigntyViewportFrame.tsx)

在仓库根目录运行主题用例，检查配色、实例标识和控件状态。

```sh
pnpm exec vitest run apps/console/src/console-m6.test.ts
```
