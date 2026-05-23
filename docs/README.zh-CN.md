# ChatLab 公开文档

此目录是公开文档站的源码。

- 生产站点：`https://docs.chatlab.fun`
- 英文文档源码：`docs/en/`
- 简体中文文档源码：`docs/cn/`
- 繁体中文文档源码：`docs/tw/`
- VitePress 配置：`docs/.vitepress/`
- 文档页面使用的静态资源：`docs/public/`
- 包配置：`docs/package.json`

## 内容边界

- 产品文档、用户指南、集成规格、公开产品理念放在此目录。
- 内部工程说明放在 `.docs/`。
- 官网首页、路线图、下载营销内容、社群落地页等官网专属内容放在 `chatlab.fun`。
- 发布用 changelog JSON 放在根目录 `changelogs/`，不放在 `docs/public/`。

## 维护说明

- VitePress 公开入口页是 `en/index.md`、`cn/index.md`、`tw/index.md`。
- 文档站依赖维护在 `docs/package.json` 中；根目录 `pnpm docs:*` 脚本只转发到这个 workspace package。
- `README.md` 和 `README.zh-CN.md` 是源码维护入口，已从 VitePress 构建中排除。
- 新增或移动公开文档时，需要同步更新 `docs/.vitepress/config.mts` 里的侧边栏。
- 新增图片或附件时，只把文档页面实际引用的资源放入 `docs/public/`。

内部构建与部署说明见 `.docs/features/public-docs.md`。
