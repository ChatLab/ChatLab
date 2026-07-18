---
outline: deep
---

# Why ChatLab

Your chat history holds a lot of useful information: what you discussed with someone, what a group has been talking about lately, who is most active, when things get busy. But an exported chat file easily runs to tens of thousands of messages — too many to read through, and not much use if you just hand it to an AI.

ChatLab organizes your chat records into structured data first, then sends only the part that actually matters to your question to the AI — **faster, cheaper, and safer**.

## Why not send the file directly to an AI?

Dropping the entire file into an AI for analysis usually creates three problems:

- **Too large to read:** tens of thousands of messages exceed what a model can take in at once, and truncation drops important context.
- **Carries unrelated content:** you only want to ask about one thing, but a heap of unrelated conversations goes along with it.
- **No way to vet privacy:** chat records may contain passwords, bank card numbers, ID numbers, or addresses, and uploading the whole file may **expose that sensitive information to an external AI provider**.

In short, handing an AI your entire chat history means **spending more tokens, getting results that may not be any better, and taking on more privacy risk**.

Most questions only require a small, relevant slice of the record.

## How ChatLab solves it

- **Organize, then analyze:** normalizes records from different platforms into sessions, members, and messages — structured and searchable.
- **Purpose-built tools:** provides search, context, statistical analysis, member profiling, chart generation, and RAG retrieval. The AI calls them as needed and retrieves only the data required for the analysis.
- **Privacy protection:** sensitive details such as phone numbers, ID numbers, bank card numbers, email addresses, and API keys are removed and replaced with placeholders before being sent to an AI.
- **Local first:** your chat database stays on your own computer. Only the small amount of information needed for the current question is processed and sent to an AI.

## How to use ChatLab's AI features

- **[Built-in AI](/ai/chatlab-ai):** configure an AI model inside ChatLab and ask questions directly. Best if you want it to work out of the box.
- **[External AI agent](/ai/external-agent):** install the ChatLab CLI and the official Skill, and let agents like Codex or Claude Code query your chat records. Best if you already use an agent and want to reuse your existing workflow.

Both methods use records already imported into ChatLab, and **both apply desensitization and blacklist filtering by default**.
