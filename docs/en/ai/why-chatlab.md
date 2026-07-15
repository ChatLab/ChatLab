---
outline: deep
---

# Why ChatLab

Your chat history holds a lot of useful information: what you discussed with someone, what a group has been talking about lately, who is most active, when things get busy. But an exported chat file easily runs to tens of thousands of messages — too many to read through, and not much use if you just hand it to an AI.

ChatLab organizes your chat records into structured data first, then sends only the part that actually matters to your question to the AI — **faster, cheaper, and safer**.

## Why not send the file directly to an AI?

Chat exports aren't built for AI, and uploading the whole file usually runs into three problems:

- **Too large to read:** tens of thousands of messages exceed what a model can take in at once, and truncation drops important context.
- **Carries unrelated content:** you only want to ask about one thing, but a heap of unrelated conversations goes along with it.
- **No way to vet privacy:** chat records may contain passwords, bank card numbers, ID numbers, or addresses, and it's hard to check every message before uploading the whole file.

To find out "what have Alice and I discussed recently?", you don't need to upload your entire history every time.

## How ChatLab solves it

- **Organize, then analyze:** normalizes records from different platforms into sessions, members, and messages — structured and searchable.
- **Fetch on demand:** retrieves only the part your current question needs, by time, member, keyword, or statistical condition.
- **Local first:** your data stays on your own computer, and can be desensitized and blacklist-filtered before it reaches an AI.

## How to use ChatLab's AI features

- **[Built-in AI](/ai/chatlab-ai):** configure an AI model inside ChatLab and ask questions directly. Best if you want it to work out of the box.
- **[External AI agent](/ai/external-agent):** install the ChatLab CLI and the official Skill, and let agents like Codex or Claude Code query your chat records. Best if you already use an agent and want to reuse your existing workflow.

Both methods use records already imported into ChatLab, and **both apply desensitization and blacklist filtering by default**.
