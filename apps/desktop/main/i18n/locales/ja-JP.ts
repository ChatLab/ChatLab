/**
 * メインプロセス日本語翻訳
 *
 * AI 共有翻訳は @openchatlab/node-runtime から導入。
 * Electron 固有翻訳はこのファイルで定義。
 */
import aiLocale from '@openchatlab/node-runtime/src/ai/i18n/locales/ja-JP'

export default {
  // ===== 共通 =====
  common: {
    error: 'エラー',
  },

  // ===== P0: アップデートダイアログ =====
  update: {
    newVersionTitle: '新バージョン v{{version}} が見つかりました',
    newVersionMessage: '新バージョン v{{version}} が見つかりました',
    newVersionDetail: '今すぐダウンロードしてインストールしますか？',
    downloadNow: '今すぐダウンロード',
    cancel: 'キャンセル',
    downloadComplete: 'ダウンロード完了',
    readyToInstall: '新バージョンの準備ができました。今すぐインストールしますか？',
    install: 'インストール',
    remindLater: '後で通知',
    installOnQuit: '後で（アプリ終了時に自動インストール）',
    upToDate: '最新バージョンです',
  },

  // ===== P0: ファイル/ディレクトリダイアログ =====
  dialog: {
    selectChatFile: 'チャット履歴ファイルを選択',
    chatRecords: 'チャット履歴',
    allFiles: 'すべてのファイル',
    import: 'インポート',
    selectDirectory: 'ディレクトリを選択',
    selectFolder: 'フォルダーを選択',
    selectFolderError: 'フォルダー選択中にエラーが発生しました：',
  },

  // ===== P1: データベースマイグレーション =====
  database: {
    migrationV1Desc: 'meta テーブルに owner_id フィールドを追加',
    migrationV1Message: '「Owner」機能に対応。メンバー一覧で自分の立場を設定できます',
    migrationV2Desc: 'roles、reply_to_message_id、platform_message_id フィールドを追加',
    migrationV2Message: 'メンバーロール、メッセージ返信関係、返信内容プレビューをサポート',
    migrationV3Desc:
      'セッションインデックス関連テーブル（segment、message_context）と session_gap_threshold フィールドを追加',
    migrationV3Message: 'セッションのタイムライン表示と AI 拡張分析に対応',
    migrationV4Desc: 'FTS5 全文検索インデックス（message_fts）を作成しインデックスデータを構築',
    migrationV4Message: '全文検索に対応し、キーワード検索速度が大幅に向上',
    migrationV5Desc: '旧バージョンのメンバーおよびメッセージフィールドを修復',
    migrationV5Message: '現在のバージョンと互換性を保つため、旧データベースのフィールドを更新します',
    migrationV6Desc: 'セッションインデックスを segment スキーマに更新',
    migrationV6Message: '既存のインデックスと要約を保持したまま、セッションインデックス構造を更新します',
    migrationV7Desc: '欠落したセッションメッセージの関連付けを修復',
    migrationV7Message: '既存のセッションと要約を保持したまま、欠落したメッセージの関連付けを修復します',
    integrityError:
      'データベース構造が不完全です：meta テーブルがありません。このデータベースファイルを削除して再インポートすることをお勧めします。',
    checkFailed: 'データベースチェックに失敗しました: {{error}}',
  },

  // ===== ツールシステム =====
  tools: {
    notRegistered: 'ツール "{{toolName}}" は登録されていません',
  },

  // AI shared translations (from @openchatlab/node-runtime)
  ...aiLocale,
}
