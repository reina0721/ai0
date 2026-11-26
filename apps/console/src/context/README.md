# 控制台共享上下文

`ConsoleProvider` 挂在路由器下面，为应用外壳、工作区和检视面板提供同一份实例状态。组件用 `useConsole()` 取得当前模式、快照、加载状态、导航和请求方法。独立渲染在 Provider 外的组件会得到 `null`。[上下文接口](ConsoleContext.tsx) · [生产挂载点](../main.tsx)

- **读取状态。** Provider 按 LIVE 和沙盒分别缓存快照，启动时调用 bootstrap，随后通过遥测事件和轮询刷新。表单需要单独读取管理资源时，用 `getAdmin` 或页面层的 `useAdminResource`。管理请求默认携带当前 `target_instance`。[客户端](../api/README.md) · [工作区用法](../pages/README.md)
- **发起变更。** 使用对应的 `postAdmin`、`patchAdmin` 或 `postStudio`。Studio 在沙盒中会拒绝指定的正式存档写操作。跨页编辑器可用 `registerDirtyEditor` 登记保存与丢弃回调，卸载时调用它返回的清理函数。[请求与导航实现](ConsoleContext.tsx)
- **保存外观偏好。** 主题、明暗、导航栏和检视器偏好从配置快照读取，在具备 Owner 令牌且就绪的 LIVE 模式下写回。偏好 hook 将连续更改排队提交，并处理较旧的刷新响应。[偏好持久化](console-preferences.ts)
- **挂载前端扩展。** 应用外壳传给 `ConsoleExtensions` 当前快照和导航注册函数。它为已启用扩展加载贡献模块，调用模块的 `activate(scope)`。卸载时释放绑定。`useExtensionComposition()` 取得该子树的组合实例。[扩展上下文](ExtensionContext.tsx) · [应用外壳](../app-shell.tsx)

静态测试可通过 `renderConsoleApp` 注入初始快照。偏好保存后的页面刷新、沙盒只读行为和写入失败后的回滚见[浏览器偏好测试](../../tests/console-preferences.spec.ts)。
