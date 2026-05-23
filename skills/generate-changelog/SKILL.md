---
name: generate-changelog
description: 根据当前项目 package.json 版本与 Git 提交记录生成中文版本日志。用于用户提出"生成版本日志""生成 changelog""发布新版本并生成更新记录"等请求时，自动读取当前版本号、定位上一版本、汇总版本区间 commit，并更新 changelogs/cn.json（新增版本、生成中文 summary、按类型归类变更）。
---

# generate-changelog

按以下流程更新 `changelogs/cn.json`。

## 1. 读取版本与日志现状

1. 读取 `package.json` 中的 `version` 作为 `currentVersion`。
2. 读取 `changelogs/cn.json`，确认是否已存在 `currentVersion`。
3. 若已存在：停止新增流程，改为"就地更新该版本内容"。
4. 计算 `previousVersion`：
   - 若 `currentVersion` 已存在于 changelog：取它的下一条记录版本号。
   - 若 `currentVersion` 不存在于 changelog：取第一条记录版本号。
5. 若无法读取 `previousVersion`，报错并停止。

## 2. 确定 commit 区间

优先按以下规则确定区间：

1. 若存在 tag `v{currentVersion}`：使用 `v{previousVersion}..v{currentVersion}`。
2. 若不存在 tag `v{currentVersion}`：使用 `v{previousVersion}..HEAD`。
3. 若 `v{previousVersion}` 不存在：回退为从首个提交到 `HEAD`，并在结果中明确标注"缺少上一版本 tag，采用全量范围"。

使用命令：

```bash
git log --no-merges --pretty=format:'%h%x09%s' <RANGE>
```

必要时读取正文：

```bash
git show -s --format='%B' <commit>
```

## 3. 归类与清洗

将 commit 按以下类型归类到 `changes[].type`：

- `feat`
- `fix`
- `refactor`
- `perf`
- `style`
- `docs`
- `test`
- `build`
- `ci`
- `chore`
- `revert`
- `other`（无法识别前缀时）

归类规则：

1. 优先从 Conventional Commit 前缀识别（如 `feat:`, `fix(scope):`）。
2. 无前缀时，根据语义判断；无法判断放入 `other`。
3. 忽略纯发布噪音提交（如仅版本号、仅锁文件且无业务影响的提交），除非用户明确要求保留。
4. 将每条 item 改写为简洁中文短句，避免直接照搬英文标题。

端标记规则：

1. 只有某个端或某个集成入口专属的变更，才在 item 前加中文全角前缀。
2. 跨端共享、用户感知一致或底层统一能力的变更不加前缀，保持自然描述。
3. 推荐前缀：
   - `【桌面端】`：仅 Electron 桌面端可见或仅影响桌面端。
   - `【CLI Web】`：仅通过 CLI 启动的 Web UI 可见或仅影响 Web 模式。
   - `【CLI】`：仅命令行、npm 包、CLI 启动/发布链路相关。
   - `【MCP】`：仅 MCP Server、MCP 设置或 MCP 工具集相关。
4. 如果同一能力在多端都有入口，但实现或体验不同，可拆成多条专属 item；如果重点是统一后的共享能力，则写成不带前缀的跨端 item。
5. `summary` 可概括提及端名，但不使用前缀格式。
6. 同一个 `type` 下的 `items` 排序：先放不带端前缀的通用/跨端变更，再放带端前缀的专属变更；专属变更内部按影响范围和用户可感知程度排序。

## 4. 生成 summary

为本版本生成 1 句中文 summary：

1. 优先覆盖用户可感知变化（功能、修复、性能、体验）。
2. 保持与历史风格一致（简洁、非营销语气）。
3. 长度控制在 18-60 字。

## 5. 更新 JSON 文件

目标文件：`changelogs/cn.json`

更新规则：

1. 构造新对象：
   - `version`: `currentVersion`
   - `date`: 当前日期（`YYYY-MM-DD`）
   - `summary`: 新生成摘要
   - `changes`: 分类后的数组（每个元素为 `{ "type": string, "items": string[] }`）
2. 若不存在当前版本，插入到数组首位。
3. 若已存在当前版本，替换该版本对象，但保持其在数组中的原位置。
4. 保持 JSON 可读格式（2 空格缩进，UTF-8，无注释）。
5. 写入后必须执行格式化，优先使用项目 Prettier，确保与"手动保存"风格一致：

```bash
npx prettier --write changelogs/cn.json
```

6. 若环境没有 Prettier，回退为 `JSON.stringify(..., null, 2)` 的最小格式保证，并在输出中明确提示"未执行 Prettier 格式化"。

## 6. 自检

写入后执行以下检查：

1. JSON 语法合法。
2. `version` 无重复。
3. `changes` 中每个 `items` 至少 1 条。
4. 与 commit 区间相比，无明显遗漏的关键变更（特别是 `feat` / `fix`）。

若自检失败，修复后再输出结果。

补充检查：

5. 确认 `changelogs/cn.json` 已经过 Prettier（若可用）。

## 7. 任务完成后询问

自检通过并输出结果后，必须询问用户：

> "changelog 已生成完毕。是否继续执行 sync-changelog 技能，将本版本日志同步为多语言版本并提交？"

- 若用户确认，立即读取并执行同目录下的 `../sync-changelog/SKILL.md`。
- 若用户拒绝或未明确回应，结束当前任务。

## 参考文件

需要查看项目格式细节时，读取：

- `references/changelog-format.md`
- `scripts/extract_commits_for_changelog.sh`
- `scripts/format_changelog.sh`
