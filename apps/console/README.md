# Owner 控制台

控制台把 daemon 的 `ConsoleLiveSnapshot` 映射为页面、导航和可执行的管理操作。浏览器入口创建路由器，在其下挂载 `ConsoleProvider` 和 `ConsoleApp`。快照类型也供 daemon 构建响应时使用。新增快照字段时，可从生产端一路追到页面。[快照类型](src/live-snapshot.ts) · [快照生产端](../daemon/src/index.ts) · [浏览器入口](src/main.tsx)

| 开发任务 | 入口 |
| --- | --- |
| 读取或刷新实例状态，保存设置，注册扩展贡献 | [共享上下文](src/context/README.md) |
| 调整启动握手、JSON 请求或遥测订阅 | [HTTP 与 SSE 客户端](src/api/README.md) |
| 注册页面地址、导航或插件页 | [路由解析](src/router/README.md) |
| 新增配置表单、列表或详情工作区 | [页面与工作区](src/pages/README.md) |
| 复用控件、主题、常驻外壳或领域视图 | [设计系统](src/design-system/README.md) |

要验证页面在给定快照下的输出，可以用 `renderConsoleDocumentHtml({ pathname, snapshot })`。它使用内存路由和关闭自动抓取的 Provider，适合检查页面、主题和空状态。[静态渲染辅助函数](src/ssr-test-helper.ts) · [控制台渲染测试](src/console-m6.test.ts)

以下命令从仓库根目录运行控制台单元测试。

```bash
pnpm exec vitest run apps/console/src
```
