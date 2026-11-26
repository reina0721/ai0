# 页面与工作区

内置页面由 `renderRoutePageView` 根据路由 ID 选择组件。新增工作区时先在路由表中定义地址，再在这里接入视图。页面可以直接消费传入的快照，也可以用共享 hook 读取独立的管理资源。[页面分发](index.ts) · [路由层](../router/README.md)

## 配置表单的读写路径

1. 使用 `useAdminResource<T>(path)` 读取当前实例的数据，它在路径或目标切换时取消旧请求。通过 `WorkspaceReadState` 展示读取中、失败重试或空结果。[数据与表单工具](workspace.tsx)
2. 将源数据传给 `useWorkspaceDraft`，用 `value` 和 `setValue` 绑定表单。把草稿的 `dirty`、`discard`、保存操作交给 `useWorkspaceSave`，传入稳定的编辑器 ID 可接入离页保护。[配置文件页示例](config-profiles-page.tsx)
3. `WorkspaceSaveButton` 使用保存 hook 返回的状态。正式写入需要 LIVE 和 Owner 令牌。保存流程执行写入、刷新快照并确认草稿。并发点击复用进行中的保存请求。[保存实现](workspace.tsx)

页面骨架使用 `WorkspacePage`、`WorkspaceSection`、`WorkspaceField` 等布局组件。选择控件、开关和按钮从设计系统取用。[布局组件](workspace-layout.tsx) · [设计系统](../design-system/README.md)

以下测试在仓库根目录运行，覆盖页面路由与标题。

```bash
pnpm exec vitest run apps/console/src/pages/workspaces.test.ts
```
