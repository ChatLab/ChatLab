/**
 * 主進程繁體中文翻譯
 */
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
    remindLater: '之後提醒',
    installOnQuit: '稍後（應用程式退出後自動安裝）',
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
    migrationV1Desc: '新增 owner_id 欄位到 meta 表',
    migrationV1Message: '支援「Owner」功能，可在成員清單中設定自己的身分',
    migrationV2Desc: '新增 roles、reply_to_message_id、platform_message_id 欄位',
    migrationV2Message: '支援成員角色、訊息回覆關係和回覆內容預覽',
    migrationV3Desc: '新增會話索引相關表（chat_session、message_context）和 session_gap_threshold 欄位',
    migrationV3Message: '支援會話時間軸瀏覽和 AI 增強分析功能',
    integrityError: '資料庫結構不完整：缺少 meta 表。建議刪除此資料庫檔案後重新匯入。',
    checkFailed: '資料庫檢查失敗：{{error}}',
  },

  // ===== 工具系統 =====
  tools: {
    notRegistered: '工具 "{{toolName}}" 未註冊',
  },

  // ===== P2: AI 工具描述（Function Calling） =====
  ai: {
    tools: {
      search_messages: {
        desc: '根據關鍵詞搜尋群聊紀錄。適用於使用者想要查找特定話題、關鍵詞相關的聊天內容。可以指定時間範圍和傳送者來篩選訊息。支援精確到分鐘級別的時間查詢。',
        params: {
          keywords: '搜尋關鍵詞清單，會用 OR 邏輯匹配包含任一關鍵詞的訊息。如果只需要按傳送者篩選，可以傳空陣列 []',
          sender_id: '傳送者的成員 ID，用於篩選特定成員傳送的訊息。可以透過 get_members 工具取得成員 ID',
          limit: '回傳訊息數量限制，預設 1000，最大 50000',
          year: '篩選指定年份的訊息，如 2024',
          month: '篩選指定月份的訊息（1-12），需要配合 year 使用',
          day: '篩選指定日期的訊息（1-31），需要配合 year 和 month 使用',
          hour: '篩選指定小時的訊息（0-23），需要配合 year、month 和 day 使用',
          start_time: '開始時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定後會覆蓋 year/month/day/hour 參數',
          end_time: '結束時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定後會覆蓋 year/month/day/hour 參數',
        },
      },
      get_recent_messages: {
        desc: '取得指定時間段內的群聊訊息。適用於回答「最近大家聊了什麼」、「X月群裡聊了什麼」等概覽性問題。支援精確到分鐘級別的時間查詢。',
        params: {
          limit: '回傳訊息數量限制，預設 100（可節省 Token，必要時再增加）',
          year: '篩選指定年份的訊息，如 2024',
          month: '篩選指定月份的訊息（1-12），需要配合 year 使用',
          day: '篩選指定日期的訊息（1-31），需要配合 year 和 month 使用',
          hour: '篩選指定小時的訊息（0-23），需要配合 year、month 和 day 使用',
          start_time: '開始時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定後會覆蓋 year/month/day/hour 參數',
          end_time: '結束時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定後會覆蓋 year/month/day/hour 參數',
        },
      },
      get_member_stats: {
        desc: '取得群成員的活躍度統計資料。適用於回答「誰最活躍」、「發言最多的是誰」等問題。',
        params: {
          top_n: '回傳前 N 名成員，預設 10',
        },
      },
      get_time_stats: {
        desc: '取得群聊的時間分佈統計。適用於回答「什麼時候最活躍」、「大家一般幾點聊天」等問題。',
        params: {
          type: '統計類型：hourly（按小時）、weekday（按星期）、daily（按日期）',
        },
      },
      get_members: {
        desc: '取得群成員清單，包含基本資料、別名與訊息統計。適用於查詢「群裡有哪些人」、「某人的別名是什麼」、「誰的 QQ 號是 xxx」等問題。',
        params: {
          search: '可選的搜尋關鍵詞，用於篩選成員暱稱、別名或 QQ 號',
          limit: '回傳成員數量限制，預設回傳全部',
        },
      },
      get_member_name_history: {
        desc: '取得成員的暱稱變更歷史紀錄。適用於回答「某人以前叫什麼名字」、「某人的暱稱變化」、「某人曾用名」等問題。需要先透過 get_members 工具取得成員 ID。',
        params: {
          member_id: '成員的資料庫 ID，可以透過 get_members 工具取得',
        },
      },
      get_conversation_between: {
        desc: '取得兩位群成員之間的對話紀錄。適用於回答「A 和 B 之間聊了什麼」、「檢視兩人的對話」等問題。需要先透過 get_members 取得成員 ID。支援精確到分鐘級別的時間查詢。',
        params: {
          member_id_1: '第一個成員的資料庫 ID',
          member_id_2: '第二個成員的資料庫 ID',
          limit: '回傳訊息數量限制，預設 100',
          year: '篩選指定年份的訊息',
          month: '篩選指定月份的訊息（1-12），需要配合 year 使用',
          day: '篩選指定日期的訊息（1-31），需要配合 year 和 month 使用',
          hour: '篩選指定小時的訊息（0-23），需要配合 year、month 和 day 使用',
          start_time: '開始時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定後會覆蓋 year/month/day/hour 參數',
          end_time: '結束時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定後會覆蓋 year/month/day/hour 參數',
        },
      },
      get_message_context: {
        desc: '根據訊息 ID 取得前後的上下文訊息。適用於想了解某條訊息前後內容的情境，例如「這則訊息前後在聊什麼」、「檢視某條訊息的上下文」等。支援單筆或批次訊息 ID。',
        params: {
          message_ids:
            '要查詢上下文的訊息 ID 清單，可以是單個 ID 或多個 ID。訊息 ID 可以從 search_messages 等工具的回傳結果中取得',
          context_size: '上下文大小，即取得前後各多少條訊息，預設 20',
        },
      },
      search_sessions: {
        desc: '搜尋聊天會話（對話段落）。會話是根據訊息時間間隔自動切分的對話單元。適用於查找特定話題的討論、了解某個時間段內發生了幾次對話等場景。回傳匹配的會話清單及每個會話的前5條訊息預覽。',
        params: {
          keywords: '可選的搜尋關鍵詞清單，只回傳包含這些關鍵詞的會話（OR 邏輯匹配）',
          limit: '回傳會話數量限制，預設 20',
          year: '篩選指定年份的會話，如 2024',
          month: '篩選指定月份的會話（1-12），需要配合 year 使用',
          day: '篩選指定日期的會話（1-31），需要配合 year 和 month 使用',
          start_time: '開始時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"',
          end_time: '結束時間，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"',
        },
      },
      get_session_messages: {
        desc: '取得指定會話的完整訊息清單。用於在 search_sessions 找到相關會話後，取得該會話的完整上下文。回傳會話的所有訊息及參與者資訊。',
        params: {
          session_id: '會話 ID，可以從 search_sessions 的回傳結果中取得',
          limit: '回傳訊息數量限制，預設 1000。對於超長會話可以限制回傳數量以節省 token',
        },
      },
      get_session_summaries: {
        desc: `取得會話摘要清單，快速了解群聊歷史討論的主題。

適用場景：
1. 了解群裡最近在聊什麼話題
2. 按關鍵詞搜尋討論過的話題
3. 概覽性問題如「群裡有沒有討論過旅遊」

回傳的摘要是對每個會話的簡短總結，可以幫助快速定位感興趣的會話，然後用 get_session_messages 取得詳情。`,
        params: {
          keywords: '在摘要中搜尋的關鍵詞清單（OR 邏輯匹配）',
          limit: '回傳會話數量限制，預設 20',
          year: '篩選指定年份的會話',
          month: '篩選指定月份的會話（1-12）',
          day: '篩選指定日期的會話（1-31）',
          start_time: '開始時間，格式 "YYYY-MM-DD HH:mm"',
          end_time: '結束時間，格式 "YYYY-MM-DD HH:mm"',
        },
      },
      // ===== SQL 分析工具 =====
      message_type_breakdown: {
        desc: '按訊息類型統計近 N 天的訊息分佈（文字、圖片、語音、表情等各有多少條）。適用於了解溝通方式偏好。',
        params: { days: '統計最近多少天的資料' },
        rowTemplate: '{type_name}：{msg_count} 條（佔 {percentage}%）',
        summaryTemplate: '訊息類型分佈（共 {rowCount} 種類型）：',
        fallback: '該時間範圍內沒有訊息紀錄',
      },
      peak_chat_hours_by_member: {
        desc: '分析指定成員在近 N 天內每小時的發言量分佈，找出其最活躍的時段。需要先透過 get_members 取得 member_id。',
        params: {
          member_id: '成員 ID（透過 get_members 取得）',
          days: '統計最近多少天的資料',
        },
        rowTemplate: '{hour}:00 — {msg_count} 條訊息',
        summaryTemplate: '該成員各時段發言量（共 {rowCount} 個活躍時段）：',
        fallback: '該成員在指定時間範圍內沒有發言紀錄',
      },
      member_activity_trend: {
        desc: '查看指定成員近 N 天的每日發言數量變化趨勢。適用於觀察某人是否變得更活躍或更沉默。需要先透過 get_members 取得 member_id。',
        params: {
          member_id: '成員 ID（透過 get_members 取得）',
          days: '查看最近多少天的趨勢',
        },
        rowTemplate: '{day}：{msg_count} 條',
        summaryTemplate: '該成員近 {rowCount} 天有發言紀錄：',
        fallback: '該成員在指定時間範圍內沒有發言紀錄',
      },
      silent_members: {
        desc: '偵測超過 N 天未發言的「沉默成員」。適用於社群營運中發現流失風險使用者。',
        params: { days: '多少天未發言算沉默' },
        rowTemplate: '{name} — 已沉默 {silent_days} 天',
        summaryTemplate: '共發現 {rowCount} 位沉默成員：',
        fallback: '沒有發現超過指定天數未發言的成員，社群活躍度良好！',
      },
      reply_interaction_ranking: {
        desc: '分析群內的回覆互動關係排行，找出誰回覆誰最多。適用於發現社群中的核心互動關係和意見領袖。',
        params: {
          days: '統計最近多少天的資料',
          limit: '回傳前多少對互動關係',
        },
        rowTemplate: '{replier_name} → {original_name}：{reply_count} 次回覆',
        summaryTemplate: '回覆互動 Top {rowCount}：',
        fallback: '該時間範圍內沒有回覆互動紀錄',
      },
      mutual_interaction_pairs: {
        desc: '找出互動最頻繁的成員對，基於雙向訊息時間接近度（一方發言後 5 分鐘內另一方也發言即視為一次互動）。適用於發現關係親密的好友組合。',
        params: {
          days: '統計最近多少天的資料',
          limit: '回傳前多少對',
        },
        rowTemplate: '{member_a} ↔ {member_b}：{interaction_count} 次互動',
        summaryTemplate: '互動最頻繁的 {rowCount} 對好友：',
        fallback: '該時間範圍內沒有偵測到明顯的互動關係',
      },
      member_message_length_stats: {
        desc: '統計各成員的平均訊息長度（僅文字訊息），長訊息通常意味著更用心的交流。適用於發現深度交流者。',
        params: {
          days: '統計最近多少天的資料',
          top_n: '回傳前多少名',
        },
        rowTemplate: '{name} — 平均 {avg_length} 字/條（共 {msg_count} 條，最長 {max_length} 字）',
        summaryTemplate: '訊息長度 Top {rowCount}（更長 = 更用心）：',
        fallback: '該時間範圍內沒有足夠的文字訊息資料',
      },
      unanswered_messages: {
        desc: '查找近 N 天內未被回覆的訊息，這些可能是未解決的客戶問題。僅統計文字訊息且內容超過 10 字的（過濾簡短寒暄）。',
        params: {
          days: '查找最近多少天的資料',
          limit: '最多回傳多少條',
        },
        rowTemplate: '[{send_time}] {sender_name}：{content_preview}',
        summaryTemplate: '共發現 {rowCount} 條可能未被回覆的訊息：',
        fallback: '該時間範圍內所有訊息都已得到回覆，服務品質很好！',
      },
    },

    // ===== AI Agent 系統提示詞 =====
    agent: {
      answerWithoutTools: '請根據已取得的資訊給出回答，不要再呼叫工具。',
      toolError: '錯誤: {{error}}',
      currentDateIs: '目前日期是',
      chatContext: {
        private: '對話',
        group: '群聊',
      },
      ownerNote: `目前使用者身份：
- 使用者在{{chatContext}}中的身份是「{{displayName}}」（platformId: {{platformId}}）
- 當使用者提到「我」、「我的」時，指的就是「{{displayName}}」
- 查詢「我」的發言時，使用 sender_id 參數篩選該成員
`,
      memberNotePrivate: `成員查詢策略：
- 私聊只有兩個人，可以直接取得成員清單
- 當使用者提到「對方」、「他/她」時，透過 get_members 取得另一方資訊
`,
      memberNoteGroup: `成員查詢策略：
- 當使用者提到特定群成員（如「張三說過什麼」、「小明的發言」等）時，應先呼叫 get_members 取得成員清單
- 群成員有三種名稱：accountName（原始暱稱）、groupNickname（群暱稱）、aliases（使用者自訂別名）
- 透過 get_members 的 search 參數可以模糊搜尋這三種名稱
- 找到成員後，使用其 id 欄位作為 search_messages 的 sender_id 參數來取得該成員的發言
`,
      mentionedMembersNote: '本輪使用者顯式 @ 的成員（可直接使用 member_id，無需再次搜尋）：',
      timeParamsIntro: '時間參數：按使用者提到的精度組合 year/month/day/hour',
      timeParamExample1: '「10月」→ year: {{year}}, month: 10',
      timeParamExample2: '「10月1號」→ year: {{year}}, month: 10, day: 1',
      timeParamExample3: '「10月1號下午3點」→ year: {{year}}, month: 10, day: 1, hour: 15',
      defaultYearNote: '未指定年份預設{{year}}年，若該月份未到則用{{prevYear}}年',
      responseInstruction: '根據使用者的問題，選擇合適的工具取得資料，然後基於資料給出回答。',
      fallbackRoleDefinition: {
        group: `你是一個專業但風格輕鬆的群聊紀錄分析助手。
你的任務是幫助使用者理解和分析他們的群聊紀錄資料，同時可以適度使用網路熱梗和表情/顏文字活躍氣氛，但不影響結論的準確性。

## 回答要求
1. 基於工具回傳的資料回答，不要編造資訊
2. 如果資料不足以回答問題，請說明
3. 回答要簡潔明瞭，使用 Markdown 格式
4. 可以適度加入網路熱梗、表情/顏文字（強度適中）
5. 玩梗不得影響事實準確與結論清晰，避免低俗或冒犯性表達`,
        private: `你是一個專業但風格輕鬆的私聊紀錄分析助手。
你的任務是幫助使用者理解和分析他們的私聊紀錄資料，同時可以適度使用網路熱梗和表情/顏文字活躍氣氛，但不影響結論的準確性。

## 回答要求
1. 基於工具回傳的資料回答，不要編造資訊
2. 如果資料不足以回答問題，請說明
3. 回答要簡潔明瞭，使用 Markdown 格式
4. 可以適度加入網路熱梗、表情/顏文字（強度適中）
5. 玩梗不得影響事實準確與結論清晰，避免低俗或冒犯性表達`,
      },
    },
  },

  // ===== P3: LLM 配置 =====
  llm: {
    notConfigured: 'LLM 服務尚未設定，請先在設定中填入 API Key',
    maxConfigs: '最多只能新增 {{count}} 組設定',
    configNotFound: '找不到設定',
    noActiveConfig: '沒有啟用中的設定',
    callFailed: 'LLM 呼叫失敗，請檢查模型設定是否正確',
  },

  // ===== P4: 摘要生成 =====
  summary: {
    sessionNotFound: '會話不存在或資料庫開啟失敗',
    tooFewMessages: '訊息數量少於 {{count}} 條，無需產生摘要',
    tooFewValidMessages: '有效訊息數量少於 {{count}} 條，無需產生摘要',
    sessionNotExist: '找不到會話',
    messagesTooFew: '訊息太少',
    validMessagesTooFew: '有效訊息太少',
    systemPromptDirect: '你是一個對話摘要專家，擅長用簡潔的語言總結對話內容。',
    systemPromptMerge: '你是一個對話摘要專家，擅長將多個摘要合併成一個連貫的總結。',
  },
}
