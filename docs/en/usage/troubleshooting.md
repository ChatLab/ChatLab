---
outline: deep
---

# Troubleshooting Guide

This document helps users and developers troubleshoot issues encountered when using ChatLab.

## Log Files

**Access log files**: Bottom left corner **"Settings" > "Storage Management" > "Log Files" > Open Directory**

Logs are stored in the `Documents/ChatLab/logs/` directory:

```
ChatLab/logs/
├── app.log                              # Main program log
├── ai/                                  # AI-related logs
│   └── ai_YYYY-MM-DD_HH-mm.log
└── import/                              # Import logs
    └── import_{sessionId}_{timestamp}.log
```

### Log File Description

| Directory/File | Contents                                          |
| -------------- | ------------------------------------------------- |
| `app.log`      | Main program log: file parsing, database ops, IPC |
| `ai/*.log`     | AI logs: LLM calls, Agent execution, tool calls   |
| `import/*.log` | Import performance: speed, memory usage, timing   |

## Common Issues

### 1. Import Failed

**Symptoms**: Parsing error after dragging in a file

**Troubleshooting Steps**:

1. Confirm the file format is supported (.json / .jsonl / .txt)
2. Check if the file is corrupted (open with a text editor)
3. Check `[Parser]` related errors in the log files

### 2. AI Features Not Responding

**Symptoms**: No response after sending a message in AI Lab

**Troubleshooting Steps**:

1. Check if API Key is configured (Settings > AI Settings)
2. Click "Verify" to confirm API connection is working
3. Check `[LLM]` or `[Agent]` related errors in the log files

**Common Causes**:

- Invalid API Key or insufficient balance
- API provider rate limiting

### 3. Database Error

**Symptoms**: Error when opening a session

**Troubleshooting Steps**:

1. Check `[Database]` related errors in the log files
2. Verify the database file exists

## Reporting Issues

If the above methods don't solve your problem, please:

1. Collect log files
2. Describe the steps to reproduce the issue
3. Submit an Issue on GitHub

**When submitting an Issue, please include**:

- Operating system and version
- ChatLab version
- Problem description and reproduction steps
- Relevant log snippets (remember to anonymize sensitive data)
