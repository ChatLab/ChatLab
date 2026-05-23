# ChatLab Public Docs

This directory contains the source for the public documentation site.

- Production site: `https://docs.chatlab.fun`
- English docs source: `docs/en/`
- Simplified Chinese docs source: `docs/cn/`
- Traditional Chinese docs source: `docs/tw/`
- VitePress config: `docs/.vitepress/`
- Static assets used by documentation pages: `docs/public/`

## Content Boundaries

- Keep product documentation, user guides, integration specs, and public product philosophy in this directory.
- Keep internal engineering notes in `.docs/`.
- Keep website-only content such as homepage, roadmap, download marketing content, and community landing pages in `chatlab.fun`.
- Keep release changelog JSON files in root `changelogs/`, not in `docs/public/`.

## Maintenance Notes

- The VitePress public entry pages are `en/index.md`, `cn/index.md`, and `tw/index.md`.
- `README.md` and `README.zh-CN.md` are source-maintenance entry points and are excluded from the VitePress build.
- When adding or moving public docs, update the sidebar in `docs/.vitepress/config.mts`.
- When adding images or attachments referenced by docs pages, place only the required assets under `docs/public/`.

See `.docs/features/public-docs.md` for internal build and deployment notes.
