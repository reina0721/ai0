# Console 基础控件

页面、外壳和组合组件从 [index.ts](index.ts) 引入交互控件，由调用方传入字段值、可用选项、忙碌状态和操作回调。公共样式由浏览器入口统一加载。[控件样式](controls.css) · [样式入口](../../main.tsx)

| 使用场景 | 控件与约定 |
| --- | --- |
| 编辑配置 | `CompactInput` 接受文本，`JellySwitch` 用于布尔项，`TonalSlider` 用于区间内的数值。[输入框](CompactInput.tsx) |
| 选择枚举值 | 少量并列项可用 `SegmentedPill`。下拉字段用 `CompactSelect`，提供 `options` 和 `ariaLabel` 或 `labelId`。受控模式同时传 `value` 与 `onChange`，回调首参是选中的值。[选择框](CompactSelect.tsx) |
| 执行动作 | `RippleButton` 的 `loading` 会禁用按钮并设置 `aria-busy`。多个次要操作可放入 `CompactActionMenu`。[操作按钮](RippleButton.tsx) |
| 查看状态与详情 | `StatusBadge` 和 `ChipPool` 显示状态与标签。`CompactDisclosure` 展开详情，`SpoilerMask` 按需揭示内容。[可折叠详情](CompactDisclosure.tsx) |

编辑已有配置时，如果选择项暂未加载，`CompactSelect` 仍显示已保存的 ID。没有可选项时控件会禁用。控制台的组件边界测试会检查业务页面使用应用内的选项菜单和对话框。[选择框测试](../../compact-select.test.tsx) · [边界检查](../../component-boundaries.test.ts)

在仓库根目录验证字段行为与组件边界。

```sh
pnpm exec vitest run apps/console/src/compact-select.test.tsx apps/console/src/component-boundaries.test.ts
```
