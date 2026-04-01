# changelog-format

本项目中文更新日志文件：`docs/changelogs_cn.json`

## 顶层结构

- 顶层为数组
- 每个元素代表一个版本对象
- 版本按时间倒序（最新在前）

## 版本对象字段

- `version`: 版本号字符串（示例：`0.9.3`）
- `date`: 发布日期（`YYYY-MM-DD`）
- `summary`: 中文一句话摘要
- `changes`: 分类变更数组

## changes 子项结构

- `type`: 分类类型（如 `feat`、`fix`、`refactor`、`chore`）
- `items`: 该分类下的中文要点数组

## 风格约束

- 保持简洁叙述，避免营销语。
- `summary` 聚焦用户可感知变化。
- `items` 使用短句，尽量一条表达一个改动。
- 若某分类无条目，不写该分类。
