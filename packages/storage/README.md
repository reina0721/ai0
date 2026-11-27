# @ai0/storage · 宿主与存档持久化（L0 Kernel + L1 Subsystems）

`@ai0/storage` 采用双层微内核分层，零历史兼容种子表与零人设枚举硬编码：
- `./kernel`（L0 不可约内核）：SQLite WAL / FTS5 驱动（`CoordinatorStorageMutator`）、追加式事件日志、SQL 层受众可见性守卫检索（`HybridMemoryRetriever`）与五表拓扑级联 `HardForgetEngine`。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 治理子系统）：`SoulDirectoryLayout`、`SoulArchiveManager`（快照回滚与 `redaction_ledger.json` 防复活重放）、宿主基础设施与加密 Vault 存储、Character Card V3 无损净化导入，以及中立开放的 `RolePresetIdSchema` 工作台配置。[L1 入口](src/subsystems/index.ts)

## 验证

```sh
pnpm exec vitest run packages/storage
```
