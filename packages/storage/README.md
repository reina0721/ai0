# @ai0/storage · 宿主与 Soul 持久化

daemon 通过 `@ai0/storage` 保存宿主基础设施、静态角色卡及各个 `.soul` 实例的运行数据。接入时先确定数据的所有者，再选择文件存储、数据库写入或只读检索入口。[公开导出](src/index.ts) · [存档结构](../../docs/architecture/02-storage-and-soul-archive-schema.md)

| 数据归属 | 应使用的入口 |
| --- | --- |
| 宿主共享的模型供应方、Vault 引用与角色卡 | `readHostInfrastructureConfig` 等接口接收宿主目录。静态卡用 `saveHostCharacterCard` 保存，显式唤醒时由 `awakenSoulFromCard` 创建独立实例。[宿主配置](src/snapshot-git/host-infrastructure-store.ts) · [角色卡存储](src/snapshot-git/character-card-store.ts) |
| 单个 Soul 的事件、记忆、检查点与话轮轨迹 | `initializeSoulDirectory` 返回布局，宿主用 `layout.soulCoreDatabasePath` 打开 `CoordinatorStorageMutator`。需要一起落库的同步写操作可用 `runInTransaction`。持有连接的一方负责 `close()`。[目录布局](src/snapshot-git/soul-directory.ts) · [数据库驱动](src/sqlite/database-driver.ts) |
| 查询记忆与知识片段 | 将 `ReadOnlyStorageView` 注入 `HybridMemoryRetriever`。记忆查询提供 `audience_scope`、`principal_trust` 和 `current_virtual_ts`，驱动在 SQL 层按受众筛选候选，再对候选评分。[检索实现](src/audience-guard/hybrid-retriever.ts) |
| 快照与遗忘 | `previewHardForgetRadius` 计算波及范围，`executeHardForget` 处理目标及派生数据。`SoulArchiveManager.rollbackToSnapshot` 恢复后合并并重放遗忘记录，返回恢复后的写连接。[遗忘引擎](src/lineage-dag/hard-forget-engine.ts) · [快照管理](src/snapshot-git/soul-archive-manager.ts) |

## 给调用方注入存储

检索或 Worker 只需要读取能力时，参数类型使用 `ReadOnlyStorageView`。现有写连接的 `asReadOnlyView()` 在 TypeScript 层收窄接口，底层仍是同一个连接。在 daemon 中，`createReadOnlyView` 通过回调访问相应实例，切换活跃 Soul 后可读到新存档。沙盒使用自己的存储实例。[daemon 装配](../../apps/daemon/src/index.ts) · [受众隔离与回滚测试](src/lineage-dag/storage-m2.test.ts)

存储回归使用 Node.js 24+，覆盖 SQLite 表结构、宿主配置、角色卡和快照恢复。在仓库根目录执行以下命令。

```sh
pnpm exec vitest run packages/storage
```
