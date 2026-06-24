---
outline: deep
---

# Export Chat Records Guide

ChatLab focuses on analyzing exported data - we don't provide data extraction features. You'll need to first use official features or third-party tools from the open-source community to export your chat records, then import them into ChatLab for analysis.

Tips: Welcome to join the [ChatLab Community](https://chatlab.fun/other/community) to discuss issues and share feedback.

## WhatsApp

For WhatsApp, we currently support the official "Export Chat" feature.

We currently support exports in English and Chinese languages. For other language needs, please contact the developer.

- **Export Method**:
  1. Open WhatsApp and go to the conversation you want to export.
  2. Tap the contact name at the top -> Export Chat.
  3. Select "Without Media".
- **Format**: Extract the `txt` file from the exported `.zip` package and drag the `txt` file into ChatLab.

## Discord

For Discord, we currently support the JSON format exported by **DiscordChatExporter**.

- **Project URL**: [https://github.com/Tyrrrz/DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter)
- **Supported Platforms**: Windows / macOS / Linux
- **Usage Guide**: Refer to the project README.
- **Tip**: Please make sure to select **JSON** as the export format for ChatLab to parse correctly.

## Instagram

For Instagram, we currently support the official export feature.

- **Export Method**:
  1. Open the Instagram app or web version, go to "Settings".
  2. Click "Accounts Center" -> "Your information and permissions" -> "Download your information".
  3. Select "Some of your information", then check "Messages".
  4. Select format as **JSON**, and date range as "All time".
  5. Click "Submit request" and wait for Instagram to process, then download.
- **Format**: After extracting the downloaded archive, find the `message_1.json` file in the `your_instagram_activity/messages/inbox/` directory for the corresponding chat, and drag it into ChatLab.
- **Tip**: If the conversation has a lot of content, there may be multiple `message_*.json` files. We recommend importing them one by one.

## iMessage

For iMessage, **imessage-chatlab** now supports exporting to the ChatLab standard JSON format.

- **Project URL**: [https://github.com/gamesme/imessage-chatlab](https://github.com/gamesme/imessage-chatlab)
- **Supported Platform**: macOS
- **Installation**: If you have the Rust toolchain installed, run `cargo install imessage-chatlab`. You can also install from source by following the project README.
- **Export Method**: Refer to the project README. For example, run `imessage-chatlab -c clone -o ~/imessage_chatlab_export` to export local iMessage data.
- **Format**: The tool exports one ChatLab standard JSON file per conversation. Drag the exported `.json` files into ChatLab.
- **Tip**: This tool reads the local macOS Messages database. Please read the project documentation carefully and make sure you have legal permission to access and analyze the relevant chat records.

## LINE

For LINE, we currently support the official chat export feature.

- **Export Method**:
  1. Open LINE and go to the conversation you want to export.
  2. On mobile: tap the menu in the top-right corner of the chat -> Settings -> Export chat history.
  3. On desktop (Windows / macOS): open Chats, enter the target conversation, then click the top-right menu -> Save chat.
  4. Save or share the exported text file.
- **Format**: Drag the exported `.txt` file directly into ChatLab.
- **Tip**: According to LINE's official help, the desktop app only saves messages that are currently loaded and visible in the chat window.

## Telegram

For Telegram, we currently support the official export feature provided by Telegram Desktop.

- **Export Method**:
  1. Open the latest version of Telegram Desktop.
  2. Go to `Settings` -> `Advanced` -> `Export Telegram data`.
  3. In the export panel, select the chats you want to export.
  4. Choose **Machine-readable JSON** as the format. If you also want a readable copy, you can choose **Both**, but JSON must be included.
  5. Choose the export folder and wait for Telegram to finish processing.
- **Format**: Import the main JSON file from the export folder (usually `result.json`) into ChatLab.
- **Tip**: Telegram's official export entry is on desktop. For some accounts, the first export request may be delayed for security reasons and must be completed later on the same device.

## Google Chat

For Google Chat, we currently support the ZIP archive exported by Google Takeout.

- **Export Method**:
  1. Go to [Google Takeout](https://takeout.google.com/) and sign in with your Google account.
  2. Click "Deselect all", then check only **Google Chat** to reduce the export size.
  3. Select **.zip** as the file type (**.tgz is not currently supported**).
  4. Click "Create export" and wait for Google to process it — you'll receive an email when the download is ready.
- **Format**: Drag the downloaded `.zip` file directly into ChatLab. ChatLab will scan all conversations inside the archive and show a selection list. Check the conversations you want and import them one by one.
- **Tips**:
  - Only ZIP format is supported. If Google Takeout offers .tgz, re-export and select .zip instead.
  - The first export request may take several hours to process.
  - Attachments (images, files, etc.) are not imported along with the chat history in the current version.

## Q&A: Can I analyze chat records from other chat applications?

For various chat analysis needs, here's a unified response:

ChatLab's function is to **analyze exported chat records in fixed text formats**, but the prerequisite is that **you have already exported chat records through legal and compliant channels**.

We **do not provide any decryption, packet capture, or export tools and scripts**. We only support compatibility with exported chat record formats. As long as you can provide anonymized chat record text samples, we can try to support analysis.

If you have some technical background, you can try using **AI-assisted conversion** to convert your data to the standard format. For details, please check the [AI Conversion Guide](../standard/ai-converter.md).

Additionally, if you're a developer and have already supported chat record export for other chat applications, you're welcome to [make it compatible with ChatLab format](../standard/chatlab-format.md), and we'll add your GitHub link here.

## ⚠️ Legal & Security Disclaimer

Before attempting to analyze data from the above applications, please be aware:

- **Legal Authorization Principle**: You may only process chat records that **you personally participated in**. If privacy of others is involved, please ensure you have obtained informed consent from the relevant parties.
- **Prohibited Illegal Use**: It is strictly forbidden to use this software for stealing, monitoring, or analyzing unauthorized private information of others, or for any behavior that infringes on others' rights.
- **Compliance Self-responsibility**: Obtaining data from third-party platforms is your personal behavior. If your analysis violates the original data source platform's terms of service resulting in account restrictions or other consequences, ChatLab assumes no responsibility.
- **No Commercial Use**: It is strictly forbidden for any individual or organization to use this software or analysis results for any form of commercial profit.
- **Result Accuracy**: Analysis results generated by the software may contain errors or "hallucinations" and are for technical reference only. They should not be used as legal evidence or decision-making basis.
