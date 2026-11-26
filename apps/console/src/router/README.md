# 控制台路由与导航

页面分发、侧栏和命令面板共享此目录的路由定义。浏览器入口把路径交给应用外壳，外壳先解析内置路由，再结合当前快照查找启用的插件页。[路由定义](routes.tsx) · [外壳调用点](../app-shell.tsx)

- **增加内置路由。** 在 `CONSOLE_ROUTES` 定义 ID、路径和所属主域，在 `renderRoutePageView` 关联页面组件。需要常驻侧栏入口时更新 `CONSOLE_SIDEBAR_GROUPS`。兼容旧地址使用已有的路径映射机制。[内置路由表](routes.tsx) · [页面分发](../pages/index.ts)
- **解析访问地址。** `canonicalizeConsolePath` 处理查询串、斜线和旧地址，`resolveConsoleRoute` 返回规范路径和路径参数。页内跳转通过控制台上下文的 `navigateConsole(path)` 保留当前模式。[导航上下文](../context/ConsoleContext.tsx)
- **增加插件页。** 插件在清单的 `console_contributions.pages` 中声明路径与入口，`registeredPages(snapshot)` 从已启用扩展收集页面。与内置路径冲突或多个插件重复声明的路径会被过滤。匹配单一别名时才会选择该插件页。[动态路由解析](plugin-pages.ts) · [WebChat 清单实例](../../../../plugins/channels/webchat/ai0.extension.json)

从仓库根目录运行 `pnpm exec vitest run apps/console/src/pages/workspaces.test.ts`，检查规范路径、兼容别名和未注册页面的呈现。[路由渲染回归](../pages/workspaces.test.ts)
