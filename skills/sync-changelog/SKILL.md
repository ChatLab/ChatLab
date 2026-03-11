---
name: sync-changelog
description: 将 docs/changelogs_cn.json 的当前版本日志同步为多语言版本：生成适合英文母语者阅读的英文版、适合繁体中文用户阅读的繁中版、适合日语母语者阅读的日文版，分别更新 docs/changelogs_en.json、docs/changelogs_tw.json、docs/changelogs_ja.json，并在当前项目创建 release 提交（包含 package.json 与四种语言 changelog）；随后同步四种语言 changelog 到同级仓库 ../chatlab.fun 并创建文档提交。用于用户提出“同步版本日志”“生成并同步 changelog”“发布前同步多语言日志”等请求。仅创建 commit，不执行 push。
---

# sync-changelog

按以下流程执行，任何一步失败都立即停止，不做 push。

## 1. 前置检查（必须）

1. 当前仓库必须工作区干净：
   - 执行 `git status --porcelain`。
   - 允许白名单改动：`package.json`、`docs/changelogs_cn.json`（这两个文件可作为本次任务前置输入）。
   - 若存在白名单外改动（包含已暂存/未暂存/未跟踪），立即退出并提示用户手动处理。
2. 当前仓库必须在 `main`：
   - 若不在 `main`，仅在工作区干净时执行 `git checkout main`。
3. 目标仓库固定为 `../chatlab.fun`。
4. 目标仓库也必须满足：
   - 工作区干净，否则退出。
   - 位于 `main`，否则在干净前提下切换。

可复用脚本：`scripts/preflight_main_clean.sh` 当前仓库建议调用：

```bash
scripts/preflight_main_clean.sh . "package.json,docs/changelogs_cn.json"
```

`chatlab.fun` 仓库仍需严格干净（不传白名单参数）。

## 2. 读取当前版本并校验文件

1. 从 `docs/changelogs_cn.json` 读取第一个对象作为当前版本。
2. 读取版本号 `version`（例如 `0.9.6`）。
3. 检查以下文件是否存在：
   - `docs/changelogs_en.json`
   - `docs/changelogs_tw.json`
   - `docs/changelogs_ja.json`
4. 任一目标文件不存在都立即退出，不允许自动创建。

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
   - `docs/changelogs_en.json`
   - `docs/changelogs_tw.json`
   - `docs/changelogs_ja.json`
4. 每个目标文件都遵循相同规则：
   - 若已存在该版本，替换该版本对象。
   - 若不存在，插入到数组首位。
5. 写入后执行格式化（若项目有 Prettier，优先使用 Prettier）。

## 4. 在当前仓库创建发布提交

1. 提交文件必须包含：
   - `package.json`
   - `docs/changelogs_cn.json`
   - `docs/changelogs_en.json`
   - `docs/changelogs_tw.json`
   - `docs/changelogs_ja.json`
2. commit message：`release: v<version>`（示例：`release: v0.9.6`）。
3. 仅创建 commit，不 push。

可复用脚本：`scripts/commit_release_changelogs.sh`

## 5. 同步到 chatlab.fun 并提交

1. 从当前仓库复制：
   - `docs/changelogs_cn.json` -> `../chatlab.fun/docs/public/cn/changelogs.json`
   - `docs/changelogs_en.json` -> `../chatlab.fun/docs/public/en/changelogs.json`
   - `docs/changelogs_tw.json` -> `../chatlab.fun/docs/public/tw/changelogs.json`
   - `docs/changelogs_ja.json` -> `../chatlab.fun/docs/public/ja/changelogs.json`
2. 目标路径必须存在；不存在则报错退出，不自动创建目录。
3. 在 `../chatlab.fun` 提交：
   - 仅提交上述四个文件。
   - commit message：`docs: changelogs update`
4. 仅创建 commit，不 push。

可复用脚本：`scripts/sync_to_chatlab_fun.sh`

## 6. 输出结果

输出以下信息给用户：

1. 当前版本号。
2. 当前仓库 release commit hash。
3. `chatlab.fun` 仓库 docs commit hash。
4. 明确声明“未执行 push”。

## 参考

- `references/english-release-style.md`
- `references/traditional-chinese-release-style.md`
- `references/japanese-release-style.md`
- `scripts/preflight_main_clean.sh`
- `scripts/commit_release_changelogs.sh`
- `scripts/sync_to_chatlab_fun.sh`
