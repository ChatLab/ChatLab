---
name: sync-changelog
description: 将 changelogs/cn.json 的当前版本日志同步为多语言版本：生成适合英文母语者阅读的英文版、适合繁体中文用户阅读的繁中版、适合日语母语者阅读的日文版，分别更新 changelogs/en.json、changelogs/tw.json、changelogs/ja.json，并在当前项目创建 release 提交（包含 package.json 与四种语言 changelog）。用于用户提出"同步版本日志""生成并同步 changelog""发布前同步多语言日志"等请求。仅创建 commit，不执行 push。
---

# sync-changelog

按以下流程执行，任何一步失败都立即停止，不做 push。

## 1. 前置检查（必须）

1. 当前仓库必须工作区干净：
   - 执行 `git status --porcelain`。
   - 允许白名单改动：`package.json`、`changelogs/cn.json`（这两个文件可作为本次任务前置输入）。
   - 若存在白名单外改动（包含已暂存/未暂存/未跟踪），立即退出并提示用户手动处理。
2. 当前仓库必须在 `main`：
   - 若不在 `main`，仅在工作区干净时执行 `git checkout main`。

可复用脚本：`scripts/preflight_main_clean.sh` 当前仓库建议调用：

```bash
scripts/preflight_main_clean.sh . "package.json,changelogs/cn.json"
```

## 2. 读取当前版本并校验文件

1. 从 `changelogs/cn.json` 读取第一个对象作为当前版本。
2. 读取版本号 `version`（例如 `0.9.6`）。
3. **在开始翻译前，必须重新读取一次该版本的完整中文内容（`summary` 与 `changes`），并以这次读取结果作为唯一翻译源。**
4. **严禁复用之前由 `generate-changelog` 或任意草稿步骤产出的缓存文案；若用户在生成后手动修改过中文日志，必须以用户修改后的文件内容为准。**
5. 检查以下文件是否存在：
   - `changelogs/en.json`
   - `changelogs/tw.json`
   - `changelogs/ja.json`
6. 任一目标文件不存在都立即退出，不允许自动创建。

## 3. 生成多语言 changelog（AI 翻译）

1. 将当前版本中文内容分别转写为英文、繁体中文、日文，统一要求：
   - 不做逐字直译。
   - 保持原始结构：`version/date/summary/changes(type/items)`。
   - 不改动 `version`、`date`、`changes.type`。
2. 语言要求：
   - 英文：使用自然、简洁、适合英文母语用户的 release notes 语气。
   - 繁体中文：以台湾常见产品文案口吻重写，避免简体直转。
   - 日文：使用自然、简洁、适合日本用户阅读的产品更新说明语气，避免中文式表达。
3. 分别更新：
   - `changelogs/en.json`
   - `changelogs/tw.json`
   - `changelogs/ja.json`
4. 每个目标文件都遵循相同规则：
   - 若已存在该版本，替换该版本对象。
   - 若不存在，插入到数组首位。
5. 翻译时必须逐条对应当前中文条目：`summary` 与 `changes.items` 的语义都应来自最新中文文件内容，不得沿用旧版本措辞。
6. 写入后执行格式化（若项目有 Prettier，优先使用 Prettier）。

## 4. 在当前仓库创建发布提交

1. 提交文件必须包含：
   - `package.json`
   - `changelogs/cn.json`
   - `changelogs/en.json`
   - `changelogs/tw.json`
   - `changelogs/ja.json`
2. commit message：`release: v<version>`（示例：`release: v0.9.6`）。
3. 仅创建 commit，不 push。

可复用脚本：`scripts/commit_release_changelogs.sh`

## 5. 输出结果

输出以下信息给用户：

1. 当前版本号。
2. 当前仓库 release commit hash。
3. 明确声明"未执行 push"。

## 参考

- `references/english-release-style.md`
- `references/traditional-chinese-release-style.md`
- `references/japanese-release-style.md`
- `scripts/preflight_main_clean.sh`
- `scripts/commit_release_changelogs.sh`
