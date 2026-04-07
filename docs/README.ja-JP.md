<div align="center">

<img src="../public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

AI Agent でチャット履歴をローカル分析し、あなたのソーシャルな記憶を掘り起こす

[English](../README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | 日本語

[公式サイト](https://chatlab.fun/ja/) · [ダウンロードガイド](https://chatlab.fun/ja/?type=download) · [ドキュメント](https://chatlab.fun/ja/usage/) · [Roadmap](https://chatlabfun.featurebase.app/roadmap) · [Issue](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab は、チャット履歴を深く理解するためのローカル完結型アプリです。AI Agent と柔軟な SQL エンジンを組み合わせることで、会話データを自由に調べ、分解し、新しい視点で読み解けます。

現在対応：WhatsApp、LINE、QQ、Discord、Instagram、Telegram。今後対応予定：iMessage、Messenger、KakaoTalk。

## 主な機能

- 🚀 **大規模データでも快適**：ストリーミング処理とマルチワーカー構成により、数百万件規模の履歴でも安定して取り込みと分析を行えます。
- 🔒 **プライバシーを優先**：チャット履歴と設定はローカルに保持され、分析も基本的に端末上で完結します（AI 機能を除く）。
- 🤖 **実データを扱える AI Agent**：10 以上の Function Calling ツールを備え、文脈に応じて動的に呼び分けながら履歴を掘り下げます。
- 📊 **多面的な可視化**：アクティブ度の推移、時間帯の傾向、メンバーランキングなどを分かりやすく確認できます。
- 🧩 **形式差分を吸収する標準化**：異なるチャットアプリのエクスポート形式を統一モデルに変換し、同じ視点で比較・分析できます。

## ガイド

- [ChatLab ダウンロードガイド](https://chatlab.fun/ja/?type=download)
- [チャット履歴の書き出しガイド](https://chatlab.fun/ja/usage/how-to-export.html)
- [標準フォーマット仕様](https://chatlab.fun/ja/standard/chatlab-format.html)
- [トラブルシューティング](https://chatlab.fun/ja/usage/troubleshooting.html)

## プレビュー

その他の画面は公式サイト [chatlab.fun](https://chatlab.fun/ja/) を参照してください。

![Preview Interface](../public/images/intro_en.png)

## システムアーキテクチャ

### 設計原則（Architecture Principles）

- **Local-first by default**：生のチャット履歴、インデックス、設定は原則として端末内に保持し、プライバシー境界を優先します。
- **Streaming over buffering**：ストリーミング解析と増分処理を中心に据え、大きなエクスポートでも安定した処理性能を保ちます。
- **Composable intelligence**：AI 機能は Agent + Tool Calling の組み合わせで構成し、単一モデルの固定ロジックに閉じません。
- **Schema-first evolution**：統一データモデルを軸に取り込み、検索、分析、可視化を設計し、将来の拡張を進めやすくします。

### 実行時アーキテクチャ（Runtime Architecture）

- **Main Process（制御層）**：`electron/main/index.ts` がライフサイクルとウィンドウを管理し、`electron/main/ipc/` がドメイン別 IPC を提供します。`electron/main/ai/` と `electron/main/i18n/` は AI と多言語化の基盤です。
- **Worker Layer（計算層）**：`electron/main/worker/` が `workerManager` を通じて取り込み、索引作成、検索処理を分離し、UI スレッドの負荷を抑えます。
- **Renderer Layer（表示・操作層）**：Vue 3 + Nuxt UI + Tailwind CSS を基盤に、管理画面、個別チャット、グループチャット、分析画面を構成します。`electron/preload/index.ts` から限定的な API を公開し、安全な境界を保ちます。

### データパイプライン（Data Pipeline）

1. **取り込み**：`parser/` が形式を判定し、対応するパーサーに処理を振り分けます。
2. **保存**：ストリーミング書き込みで、セッション、メンバー、メッセージなどの主要データをローカルに保存します。
3. **索引作成**：セッション軸と時間軸の索引を生成し、タイムライン表示や検索を支えます。
4. **検索と分析**：`worker/query/*` がアクティブ度分析、関係性分析、SQL Lab、AI 補助分析を支えます。
5. **表示**：レンダラー側で結果をグラフ、ランキング、タイムライン、対話型分析に変換します。

## ローカル開発

### 必要環境

- Node.js >= 20
- pnpm

### セットアップ

```bash
# 依存関係をインストール
pnpm install

# 開発モードで起動
pnpm dev
```

Electron の起動時に例外が発生する場合は、`electron-fix` を試してください。

```bash
npm install electron-fix -g
electron-fix start
```

## プライバシーポリシーと利用規約

利用前に [プライバシーポリシーと利用規約](../src/assets/docs/agreement_ja.md) を確認してください。

## コミュニティ

Pull Request を送る前に、次の方針を確認してください。

- 明らかなバグ修正はそのまま提出して構いません
- 新機能は先に Issue で相談してください。**事前の議論がない PR はクローズされます**
- 1 つの PR は 1 つの目的に絞り、変更が大きい場合は分割を検討してください

ChatLab に貢献してくださったすべての方に感謝します！

<a href="https://github.com/hellodigua/ChatLab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hellodigua/ChatLab" />
</a>

## License

AGPL-3.0 License
