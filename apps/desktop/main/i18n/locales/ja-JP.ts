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

  windowsTray: {
    quitApp: 'ChatLab を終了',
    showApp: 'ChatLab を表示',
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
    requiredTitle: 'ChatLab の更新が必要です',
    requiredMessage: '現在のバージョン {{currentVersion}} では、このデータディレクトリを開けません',
    requiredDetail:
      'このデータディレクトリには ChatLab {{minRuntimeVersion}} 以降が必要です。データを保護するため、現在のバージョンではデータベースを開きません。\n\n「今すぐ更新」を選ぶとバックグラウンドでダウンロードし、完了後にインストーラーを起動します。ダウンロード中はメイン画面を開きません。公式ダウンロードページを開くこともできます。\nデータディレクトリ：{{userDataDir}}',
    updateNow: '今すぐ更新',
    openDownloadPage: 'ダウンロードページを開く',
    quit: '終了',
    requiredUpdateFailedTitle: '自動更新に失敗しました',
    requiredUpdateFailedMessage: '必要なバージョンに更新できませんでした',
    requiredUpdateFailedDetail:
      '公式ダウンロードページから ChatLab {{minRuntimeVersion}} 以降をインストールして、アプリを再度開いてください。',
    openDownloadFailed: 'ダウンロードページを開けませんでした。次の URL を手動で開いてください：',
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
    migrationV4Desc: '旧バージョンのデータベース移行順序を維持',
    migrationV4Message: '廃止された検索データを再構築せず、軽量な互換処理のみ実行します',
    migrationV5Desc: '旧バージョンのメンバーおよびメッセージフィールドを修復',
    migrationV5Message: '現在のバージョンと互換性を保つため、旧データベースのフィールドを更新します',
    migrationV6Desc: 'セッションインデックスを segment スキーマに更新',
    migrationV6Message: '既存のインデックスと要約を保持したまま、セッションインデックス構造を更新します',
    migrationV7Desc: '欠落したセッションメッセージの関連付けを修復',
    migrationV7Message: '既存のセッションと要約を保持したまま、欠落したメッセージの関連付けを修復します',
    migrationV8Desc: '分析ツールのパフォーマンスインデックスを追加',
    migrationV8Message:
      '分析ツールのクエリを高速化するパフォーマンスインデックスを追加します（既存データには影響しません）',
    migrationV9Desc: '廃止された会話単位の全文検索インデックスを削除',
    migrationV9Message: '使用されていない派生検索インデックスのみ削除し、チャットデータは保持します',
    migrationV10Desc: 'セグメント要約が参照したメッセージ数を記録',
    migrationV10Message: '各セグメント要約が参照したメッセージ数を記録し、古い要約を再生成できるようにします',
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
