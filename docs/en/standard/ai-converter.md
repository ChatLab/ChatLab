---
outline: deep
---

# AI Conversion Guide

If your chat record format (such as CSV, HTML, TXT, or other database exports) is not directly supported by ChatLab, you can use AI (like ChatGPT, Claude, DeepSeek, etc.) to quickly write a conversion script to transform your data into ChatLab's standard format.

## Preparation

1. **Download the standard specification**: <a href="/en/docs/chatlab-format.md" download="chatlab-format.md">Click to download ChatLab Standard Format Specification v0.0.1 (.md)</a>
2. **Prepare your data**: Have your exported original chat record file ready (if using online services, we recommend providing only a few hundred anonymized samples).

## Choose Target Format

Select the appropriate prompt based on your data size.

### Scenario 1: Small to Medium Data (Recommended)

- **Target Format**: JSON (`.json`)
- **Use Case**: Less than 1 million records, file size < 100MB.
- **Features**: Clear structure, best compatibility.

#### Copy JSON Conversion Prompt

```markdown
**Role Setting**:
You are an expert in data processing and script writing.

**Task Objective**:
Based on the [ChatLab Standard Format Specification] (chatlab-format.md) I provide, please write a script to convert my uploaded [original chat records] into the compliant **JSON format**.

**Requirements**:

1. **Analyze Structure**: Analyze the text patterns or data structure of the original chat records.
2. **Field Mapping**:
   - Map original fields to ChatLab standard fields (`timestamp`, `sender`, `content`, `type`, etc.).
   - If the original data lacks `sender` (user ID), please automatically generate a unique hash or virtual ID based on `accountName` (username).
   - Default `type` to 0 (text). If you can identify images, voice, or other types from the content, please try to map them.
3. **Script Generation**:
   - Please write a **complete, executable script** (Python or Node.js recommended).
   - **Output Structure**: The script should build a complete JSON object containing `chatlab`, `meta`, `members`, `messages`, and write it to a file at once.
   - The script should include necessary error handling and print progress.
4. **Result Validation**:
   - Ensure the generated JSON structure strictly conforms to the definitions in `chatlab-format.md`.

**Output**:
Please provide the code directly and briefly explain how to run the script.
```

### Scenario 2: Very Large Data

- **Target Format**: JSONL (`.jsonl`)
- **Use Case**: More than 1 million records, or very large file size.
- **Features**: Streaming read/write, extremely low memory usage, won't crash due to large data volumes.

#### Copy JSONL Conversion Prompt

```markdown
**Role Setting**:
You are an expert in big data processing and stream computing.

**Task Objective**:
Based on the [ChatLab Standard Format Specification] (chatlab-format.md) I provide, please write a script to convert my uploaded [original chat records] into the compliant **JSONL (JSON Lines) format**.

**Requirements**:

1. **Analyze Structure**: Analyze the text patterns of the original chat records.
2. **Stream Processing**:
   - **Must use streaming read/write** (Line-by-Line) approach; do not load all data into memory at once.
   - Read the original file line by line, write to the target file line by line.
3. **JSONL Structure Requirements**:
   - **First line**: Must write the `_type: "header"` line (containing `chatlab` and `meta` information).
   - **Member information**: If possible, scan once or collect member information during processing, write `_type: "member"` lines.
   - **Message records**: Each chat record writes one `_type: "message"` line.
4. **Script Generation**:
   - Please write an **efficient Python script**.
   - Ensure constant memory usage during processing, suitable for GB-level large files.

**Output**:
Please provide the code directly and briefly explain how to run the script.
```

## Next Steps

1. **Run the script**: Run the AI-generated script in your local environment.
2. **Check results**: Open the generated file and confirm the format is correct.
3. **Import to ChatLab**: Import the generated file into ChatLab for analysis.
