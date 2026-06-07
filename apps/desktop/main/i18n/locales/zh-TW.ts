/**
 * 主程序繁體中文翻譯
 *
 * AI 共享翻譯自 @openchatlab/node-runtime 匯入，
 * Electron 專有翻譯在本檔案定義。
 */
import aiLocale from '@openchatlab/node-runtime/src/ai/i18n/locales/zh-TW'

export default {
  // ===== 通用 =====
  common: {
    error: '錯誤',
  },

  // ===== P0: 更新彈窗 =====
  update: {
    newVersionTitle: '發現新版本 v{{version}}',
    newVersionMessage: '發現新版本 v{{version}}',
    newVersionDetail: '是否立即下載並安裝新版本？',
    downloadNow: '立即下載',
    cancel: '取消',
    downloadComplete: '下載完成',
    readyToInstall: '新版本已準備就緒，是否現在安裝？',
    install: '安裝',
    remindLater: '稍後提醒',
    installOnQuit: '稍後（應用退出後自動安裝）',
    upToDate: '已是最新版本',
  },

  // ===== P0: 檔案/目錄對話框 =====
  dialog: {
    selectChatFile: '選擇聊天紀錄檔案',
    chatRecords: '聊天紀錄',
    allFiles: '所有檔案',
    import: '匯入',
    selectDirectory: '選擇目錄',
    selectFolder: '選擇資料夾',
    selectFolderError: '選擇資料夾時發生錯誤：',
  },

  // ===== P1: 資料庫遷移 =====
  database: {
    migrationV1Desc: '在 meta 資料表新增 owner_id 欄位',
    migrationV1Message: '支援「Owner」功能，可在成員清單中設定自己的身份',
    migrationV2Desc: '新增 roles、reply_to_message_id、platform_message_id 欄位',
    migrationV2Message: '支援成員角色、訊息回覆關係和回覆內容預覽',
    migrationV3Desc: '新增會話索引相關資料表（segment、message_context）及 session_gap_threshold 欄位',
    migrationV3Message: '支援會話時間軸瀏覽與 AI 增強分析功能',
    migrationV4Desc: '建立 FTS5 全文搜尋索引（message_fts）並建構索引資料',
    migrationV4Message: '支援全文搜尋，大幅提升關鍵詞搜尋速度',
    integrityError: '資料庫結構不完整：缺少 meta 資料表。建議刪除此資料庫檔案後重新匯入。',
    checkFailed: '資料庫檢查失敗: {{error}}',
  },

  // ===== 工具系統 =====
  tools: {
    notRegistered: '工具 "{{toolName}}" 未註冊',
  },

  // AI shared translations (from @openchatlab/node-runtime)
  ...aiLocale,
}
