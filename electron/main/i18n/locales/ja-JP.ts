/**
 * メインプロセス日本語翻訳
 */
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
      'セッションインデックス関連テーブル（chat_session、message_context）と session_gap_threshold フィールドを追加',
    migrationV3Message: 'セッションのタイムライン表示と AI 拡張分析に対応',
    integrityError:
      'データベース構造が不完全です：meta テーブルがありません。このデータベースファイルを削除して再インポートすることをお勧めします。',
    checkFailed: 'データベースチェックに失敗しました: {{error}}',
  },

  // ===== ツールシステム =====
  tools: {
    notRegistered: 'ツール "{{toolName}}" は登録されていません',
  },

  // ===== P2: AI ツール説明（Function Calling） =====
  ai: {
    tools: {
      search_messages: {
        desc: 'キーワードでグループチャット履歴を検索する。ユーザーが特定のトピックやキーワードに関連するチャット内容を探したい場合に使用する。時間範囲や送信者でメッセージをフィルタリングできる。分単位の精度で時間クエリをサポートする。',
        params: {
          keywords:
            '検索キーワードリスト。OR ロジックでいずれかのキーワードを含むメッセージにマッチする。送信者のみでフィルタリングする場合は空配列 [] を渡す',
          sender_id:
            '送信者のメンバー ID。特定メンバーの送信メッセージをフィルタリングする。get_members ツールでメンバー ID を取得できる',
          limit: '返却メッセージ数の上限。デフォルト 1000、最大 50000',
          year: '指定年のメッセージをフィルタリング（例：2024）',
          month: '指定月のメッセージをフィルタリング（1-12）。year と併用する必要がある',
          day: '指定日のメッセージをフィルタリング（1-31）。year と month と併用する必要がある',
          hour: '指定時間のメッセージをフィルタリング（0-23）。year、month、day と併用する必要がある',
          start_time:
            '開始時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 14:00"）。指定すると year/month/day/hour パラメータを上書きする',
          end_time:
            '終了時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 18:30"）。指定すると year/month/day/hour パラメータを上書きする',
        },
      },
      get_recent_messages: {
        desc: '指定期間内のグループチャットメッセージを取得する。「最近みんな何を話していた？」「X月にグループで何が話題だった？」などの概要的な質問に適している。分単位の精度で時間クエリをサポートする。',
        params: {
          limit: '返却メッセージ数の上限。デフォルト 100（Token を節約したい場合の目安。必要に応じて増やせる）',
          year: '指定年のメッセージをフィルタリング（例：2024）',
          month: '指定月のメッセージをフィルタリング（1-12）。year と併用する必要がある',
          day: '指定日のメッセージをフィルタリング（1-31）。year と month と併用する必要がある',
          hour: '指定時間のメッセージをフィルタリング（0-23）。year、month、day と併用する必要がある',
          start_time:
            '開始時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 14:00"）。指定すると year/month/day/hour パラメータを上書きする',
          end_time:
            '終了時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 18:30"）。指定すると year/month/day/hour パラメータを上書きする',
        },
      },
      get_member_stats: {
        desc: 'グループメンバーのアクティビティ統計データを取得する。「最もアクティブなのは誰？」「発言数が一番多いのは？」などの質問に適している。',
        params: {
          top_n: '上位 N 名のメンバーを返却。デフォルト 10',
        },
      },
      get_time_stats: {
        desc: 'グループチャットの時間分布統計を取得する。「いつが一番アクティブ？」「みんな何時にチャットしている？」などの質問に適している。',
        params: {
          type: '統計タイプ：hourly（時間別）、weekday（曜日別）、daily（日別）',
        },
      },
      get_members: {
        desc: 'グループメンバー一覧を取得する。メンバーの基本情報、別名、メッセージ統計を含む。「グループに誰がいる？」「○○の別名は？」「QQ 番号が xxx の人は？」などの質問に向いている。',
        params: {
          search: '任意の検索キーワード。メンバーのニックネーム、別名、QQ 番号で絞り込む',
          limit: '返却メンバー数の上限。デフォルトは全件返却',
        },
      },
      get_member_name_history: {
        desc: 'メンバーのニックネーム変更履歴を取得する。「○○の以前の名前は？」「○○のニックネームの変遷」「○○の旧名」などの質問に適している。事前に get_members ツールでメンバー ID を取得する必要がある。',
        params: {
          member_id: 'メンバーのデータベース ID。get_members ツールで取得できる',
        },
      },
      get_conversation_between: {
        desc: '2 人のグループメンバー間の会話履歴を取得する。「A と B は何を話していた？」「2 人のやり取りを見たい」などの質問に向いている。事前に get_members でメンバー ID を取得する必要がある。分単位の時間指定にも対応する。',
        params: {
          member_id_1: '1人目のメンバーのデータベース ID',
          member_id_2: '2人目のメンバーのデータベース ID',
          limit: '返却メッセージ数の上限。デフォルト 100',
          year: '指定年のメッセージをフィルタリング',
          month: '指定月のメッセージをフィルタリング（1-12）。year と併用する必要がある',
          day: '指定日のメッセージをフィルタリング（1-31）。year と month と併用する必要がある',
          hour: '指定時間のメッセージをフィルタリング（0-23）。year、month、day と併用する必要がある',
          start_time:
            '開始時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 14:00"）。指定すると year/month/day/hour パラメータを上書きする',
          end_time:
            '終了時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 18:30"）。指定すると year/month/day/hour パラメータを上書きする',
        },
      },
      get_message_context: {
        desc: 'メッセージ ID に基づいて前後のコンテキストメッセージを取得する。特定のメッセージの前後のチャット内容を確認したいシーンに適している。例えば「このメッセージの前後で何を話していた？」「あるメッセージのコンテキストを見る」など。単一または複数のメッセージ ID をサポートする。',
        params: {
          message_ids:
            'コンテキストを取得するメッセージ ID リスト。単一 ID または複数 ID が可能。メッセージ ID は search_messages などのツールの返却結果から取得できる',
          context_size: 'コンテキストサイズ。前後それぞれ何件のメッセージを取得するか。デフォルト 20',
        },
      },
      search_sessions: {
        desc: 'チャットセッション（会話セグメント）を検索する。セッションはメッセージの時間間隔に基づいて自動分割された会話単位である。特定トピックの議論を見つけたり、ある期間内の会話回数を把握するのに適している。マッチしたセッションリストと各セッションの最初の5件のメッセージプレビューを返却する。',
        params: {
          keywords: '任意の検索キーワードリスト。これらのキーワードを含むセッションのみ返却する（OR ロジックマッチ）',
          limit: '返却セッション数の上限。デフォルト 20',
          year: '指定年のセッションをフィルタリング（例：2024）',
          month: '指定月のセッションをフィルタリング（1-12）。year と併用する必要がある',
          day: '指定日のセッションをフィルタリング（1-31）。year と month と併用する必要がある',
          start_time: '開始時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 14:00"）',
          end_time: '終了時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 18:30"）',
        },
      },
      get_session_messages: {
        desc: '指定セッションの完全なメッセージリストを取得する。search_sessions で関連セッションを見つけた後、そのセッションの完全なコンテキストを取得するために使用する。セッションの全メッセージと参加者情報を返却する。',
        params: {
          session_id: 'セッション ID。search_sessions の返却結果から取得できる',
          limit: '返却メッセージ数の上限。デフォルト 1000。非常に長いセッションでは Token 節約のため件数を制限できる',
        },
      },
      get_session_summaries: {
        desc: `セッション要約リストを取得し、グループチャットの過去の議論トピックをすばやく把握する。

適用シーン：
1. グループで最近何が話題になっていたか知りたい
2. キーワードで過去に議論されたトピックを検索
3. 「グループで旅行について話したことある？」などの概要的な質問

返却される要約は各セッションの短い概要であり、興味のあるセッションをすばやく特定し、get_session_messages で詳細を取得できる。`,
        params: {
          keywords: '要約内で検索するキーワードリスト（OR ロジックマッチ）',
          limit: '返却セッション数の上限。デフォルト 20',
          year: '指定年のセッションをフィルタリング',
          month: '指定月のセッションをフィルタリング（1-12）',
          day: '指定日のセッションをフィルタリング（1-31）',
          start_time: '開始時刻。形式 "YYYY-MM-DD HH:mm"',
          end_time: '終了時刻。形式 "YYYY-MM-DD HH:mm"',
        },
      },
      // ===== SQL 分析ツール =====
      message_type_breakdown: {
        desc: 'メッセージタイプ別に直近 N 日間のメッセージ分布を集計する（テキスト、画像、音声、スタンプなどの件数）。コミュニケーション方法の傾向を把握するのに適している。',
        params: { days: '直近何日間のデータを集計するか' },
        rowTemplate: '{type_name}：{msg_count} 件（{percentage}%）',
        summaryTemplate: 'メッセージタイプ分布（全 {rowCount} 種類）：',
        fallback: 'この期間にメッセージ記録がありません',
      },
      peak_chat_hours_by_member: {
        desc: '指定メンバーの直近 N 日間の時間帯別発言数分布を分析し、最もアクティブな時間帯を特定する。事前に get_members で member_id を取得する必要がある。',
        params: {
          member_id: 'メンバー ID（get_members で取得）',
          days: '直近何日間のデータを集計するか',
        },
        rowTemplate: '{hour}:00 — {msg_count} 件のメッセージ',
        summaryTemplate: '該当メンバーの時間帯別発言数（全 {rowCount} アクティブ時間帯）：',
        fallback: '指定期間内に該当メンバーの発言記録がありません',
      },
      member_activity_trend: {
        desc: '指定メンバーの直近 N 日間の日別発言数の変化トレンドを表示する。ある人物がよりアクティブになったか、より静かになったかを観察するのに適している。事前に get_members で member_id を取得する必要がある。',
        params: {
          member_id: 'メンバー ID（get_members で取得）',
          days: '直近何日間のトレンドを表示するか',
        },
        rowTemplate: '{day}：{msg_count} 件',
        summaryTemplate: '該当メンバーの直近 {rowCount} 日間の発言記録：',
        fallback: '指定期間内に該当メンバーの発言記録がありません',
      },
      silent_members: {
        desc: 'N 日以上発言していない「休眠メンバー」を検出する。コミュニティ運営で離脱リスクのある利用者を見つけるのに向いている。',
        params: { days: '何日間未発言でサイレントとみなすか' },
        rowTemplate: '{name} — {silent_days} 日間サイレント',
        summaryTemplate: '全 {rowCount} 名の休眠メンバーを検出：',
        fallback: '指定日数を超えて未発言のメンバーは見つかりませんでした。コミュニティのアクティビティは良好です！',
      },
      reply_interaction_ranking: {
        desc: 'グループ内の返信インタラクションランキングを分析し、誰が誰に最も多く返信しているかを特定する。コミュニティのコアインタラクション関係やオピニオンリーダーの発見に適している。',
        params: {
          days: '直近何日間のデータを集計するか',
          limit: '上位何組のインタラクション関係を返却するか',
        },
        rowTemplate: '{replier_name} → {original_name}：{reply_count} 回返信',
        summaryTemplate: '返信インタラクション Top {rowCount}：',
        fallback: 'この期間に返信インタラクション記録がありません',
      },
      mutual_interaction_pairs: {
        desc: '最も頻繁にインタラクションするメンバーペアを特定する。双方向のメッセージ時間近接度に基づく（一方の発言後5分以内にもう一方も発言した場合を1回のインタラクションとみなす）。親密な友人の組み合わせの発見に適している。',
        params: {
          days: '直近何日間のデータを集計するか',
          limit: '上位何組を返却するか',
        },
        rowTemplate: '{member_a} ↔ {member_b}：{interaction_count} 回のインタラクション',
        summaryTemplate: '最も頻繁にインタラクションする {rowCount} 組のペア：',
        fallback: 'この期間に明らかなインタラクション関係は検出されませんでした',
      },
      member_message_length_stats: {
        desc: '各メンバーの平均メッセージ長（テキストメッセージのみ）を集計する。長いメッセージは通常、より丁寧なコミュニケーションを意味する。深い交流を行う人物の発見に適している。',
        params: {
          days: '直近何日間のデータを集計するか',
          top_n: '上位何名を返却するか',
        },
        rowTemplate: '{name} — 平均 {avg_length} 字/件（全 {msg_count} 件、最長 {max_length} 字）',
        summaryTemplate: 'メッセージ長 Top {rowCount}（長い = より丁寧）：',
        fallback: 'この期間に十分なテキストメッセージデータがありません',
      },
      unanswered_messages: {
        desc: '直近 N 日間で返信されていないメッセージを検索する。未解決の問題である可能性がある。テキストメッセージかつ10文字以上のもののみ集計する（短い挨拶を除外）。',
        params: {
          days: '直近何日間のデータを検索するか',
          limit: '最大何件返却するか',
        },
        rowTemplate: '[{send_time}] {sender_name}：{content_preview}',
        summaryTemplate: '全 {rowCount} 件の返信されていない可能性のあるメッセージ：',
        fallback: 'この期間のすべてのメッセージに返信がありました。対応品質は良好です！',
      },
    },

    // ===== AI Agent システムプロンプト =====
    agent: {
      answerWithoutTools: '取得済みの情報に基づいて回答してください。これ以上ツールを呼び出さないでください。',
      toolError: 'エラー: {{error}}',
      currentDateIs: '現在の日付は',
      chatContext: {
        private: '会話',
        group: 'グループチャット',
      },
      ownerNote: `現在のユーザー情報：
- ユーザーの{{chatContext}}における立場は「{{displayName}}」（platformId: {{platformId}}）
- ユーザーが「私」「自分の」と言った場合、「{{displayName}}」を指す
- 「私」の発言を検索する際は、sender_id パラメータで該当メンバーをフィルタリングする
`,
      memberNotePrivate: `メンバー検索戦略：
- 個人チャットは2人だけなので、直接メンバー一覧を取得できる
- ユーザーが「相手」「彼/彼女」と言った場合、get_members でもう一方の情報を取得する
`,
      memberNoteGroup: `メンバー検索戦略：
- ユーザーが特定のグループメンバーに言及した場合（例：「田中さんは何を言った？」「太郎の発言」など）、まず get_members でメンバー一覧を取得する
- グループメンバーには3種類の名前がある：accountName（元のニックネーム）、groupNickname（グループニックネーム）、aliases（ユーザー定義の別名）
- get_members の search パラメータでこれら3種類の名前をあいまい検索できる
- メンバーを見つけたら、その id フィールドを search_messages の sender_id パラメータとして使用して発言を取得する
`,
      mentionedMembersNote:
        'このラウンドでユーザーが明示的に @ 選択したメンバー（member_id を再検索なしで直接使えます）：',
      timeParamsIntro: '時間パラメータ：ユーザーが言及した精度に応じて year/month/day/hour を組み合わせる',
      timeParamExample1: '"10月" → year: {{year}}, month: 10',
      timeParamExample2: '"10月1日" → year: {{year}}, month: 10, day: 1',
      timeParamExample3: '"10月1日午後3時" → year: {{year}}, month: 10, day: 1, hour: 15',
      defaultYearNote:
        '年が指定されていない場合はデフォルトで{{year}}年。該当月がまだ来ていない場合は{{prevYear}}年を使用する',
      responseInstruction: 'ユーザーの質問に応じて適切なツールを選択してデータを取得し、データに基づいて回答する。',
      fallbackRoleDefinition: {
        group: `あなたはプロフェッショナルだがカジュアルなスタイルのグループチャット履歴分析アシスタントです。
ユーザーのグループチャット履歴データの理解と分析を支援し、適度にネットスラングや顔文字を使って雰囲気を和らげますが、結論の正確性に影響しないようにします。

## 回答要件
1. ツールから返却されたデータに基づいて回答し、情報を捏造しない
2. データが不十分で質問に答えられない場合は、その旨を説明する
3. 回答は簡潔明瞭に、Markdown 形式を使用する
4. 適度にネットスラングや顔文字を加えてよい（強度は控えめに）
5. ネタは事実の正確さと結論の明確さに影響を与えてはならず、低俗または不快な表現は避ける`,
        private: `あなたはプロフェッショナルだがカジュアルなスタイルの個人チャット履歴分析アシスタントです。
ユーザーの個人チャット履歴データの理解と分析を支援し、適度にネットスラングや顔文字を使って雰囲気を和らげますが、結論の正確性に影響しないようにします。

## 回答要件
1. ツールから返却されたデータに基づいて回答し、情報を捏造しない
2. データが不十分で質問に答えられない場合は、その旨を説明する
3. 回答は簡潔明瞭に、Markdown 形式を使用する
4. 適度にネットスラングや顔文字を加えてよい（強度は控えめに）
5. ネタは事実の正確さと結論の明確さに影響を与えてはならず、低俗または不快な表現は避ける`,
      },
    },
  },

  // ===== P3: LLM 設定 =====
  llm: {
    notConfigured: 'LLM サービスが未設定です。先に設定で API Key を設定してください',
    maxConfigs: '設定は最大 {{count}} 個まで追加できます',
    configNotFound: '設定が存在しません',
    noActiveConfig: 'アクティブな設定がありません',
    callFailed: 'LLM 呼び出しに失敗しました。モデル設定を確認してください。',
  },

  // ===== P4: 要約生成 =====
  summary: {
    sessionNotFound: 'セッションが存在しないか、データベースを開けませんでした',
    tooFewMessages: 'メッセージ数が{{count}}件未満のため、要約の生成は不要です',
    tooFewValidMessages: '有効なメッセージ数が{{count}}件未満のため、要約の生成は不要です',
    sessionNotExist: 'セッションが存在しません',
    messagesTooFew: 'メッセージが少なすぎます',
    validMessagesTooFew: '有効なメッセージが少なすぎます',
    systemPromptDirect: 'あなたは会話要約の専門家であり、簡潔な言葉で会話内容を要約することに長けている。',
    systemPromptMerge: 'あなたは会話要約の専門家であり、複数の要約を一つのまとまった概要に統合することに長けている。',
  },
}
