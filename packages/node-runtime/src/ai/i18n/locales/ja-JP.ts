/**
 * AI shared translations — Japanese
 */
export default {
  ai: {
    tools: {
      search_messages: {
        desc: 'キーワードでチャット履歴を検索する。キーワード、メンバーの発言、特定トピックが出たかどうかなどの事実質問に対する主要な証拠取得ツール。時間範囲や送信者でメッセージをフィルタリングできる。分単位の精度で時間クエリをサポートする。',
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
      deep_search_messages: {
        desc: '完全部分文字列マッチでチャット履歴を検索する。速度は遅いが、キーワードを含むメッセージを漏らさない。search_messages の結果が不十分な場合、ある文言が実在するか確認する場合、または部分的な単語・単一文字を検索する場合に使用する。',
        params: {
          keywords:
            '検索キーワードリスト。部分文字列マッチ（LIKE）を使用し、いずれかのキーワードにマッチしたメッセージを返す',
          sender_id: '送信者のメンバー ID。特定メンバーの送信メッセージをフィルタリングする',
          limit: '返却メッセージ数の上限。デフォルト 1000、最大 50000',
          year: '指定年のメッセージをフィルタリング（例：2024）',
          month: '指定月のメッセージをフィルタリング（1-12）。year と併用する必要がある',
          day: '指定日のメッセージをフィルタリング（1-31）。year と month と併用する必要がある',
          hour: '指定時間のメッセージをフィルタリング（0-23）。year、month、day と併用する必要がある',
          start_time: '開始時刻。形式 "YYYY-MM-DD HH:mm"。指定すると year/month/day/hour パラメータを上書きする',
          end_time: '終了時刻。形式 "YYYY-MM-DD HH:mm"。指定すると year/month/day/hour パラメータを上書きする',
        },
      },
      get_recent_messages: {
        desc: '指定期間内のチャットメッセージを取得する。「最近みんな何を話していた？」「X月に何が話題だった？」、新しい記録追加後の最新内容などの概要質問に対する優先証拠ツール。分単位の精度で時間クエリをサポートする。',
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
      get_chat_overview: {
        desc: 'チャット記録の基本概要を取得する：グループ名、プラットフォーム、タイプ、総メッセージ数、総メンバー数、期間、最もアクティブなメンバーランキング。分析前や新しい記録追加後に、現在のデータベース範囲を確認するのに適している。',
        params: {
          top_n: '上位 N 名のアクティブメンバーを返却。デフォルト 10',
        },
      },
      get_member_stats: {
        desc: 'グループメンバーのアクティビティ統計データを取得する。「最もアクティブなのは誰？」「発言数が一番多いのは？」などの質問に適している。',
        params: {
          top_n: '上位 N 名のメンバーを返却。デフォルト 10',
        },
      },
      get_time_stats: {
        desc: 'グループチャットの時間分布統計を取得する。「いつが一番アクティブ？」「みんな何時にチャットしている？」などの質問に適している。返される `data` 配列は render_chart の `rows` パラメータとして直接使用できる。',
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
          start_time:
            '開始時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 14:00"）。指定すると year/month/day/hour パラメータを上書きする',
          end_time:
            '終了時刻。形式 "YYYY-MM-DD HH:mm"（例："2024-03-15 18:30"）。指定すると year/month/day/hour パラメータを上書きする',
        },
      },
      get_message_context: {
        desc: 'メッセージ ID に基づいて前後のコンテキストメッセージを取得する。具体的な引用メッセージ周辺の事実確認、例えば「このメッセージの前後で何を話していた？」「この文言には文脈があるか」を確認する場合に使用する。単一または複数のメッセージ ID をサポートする。',
        params: {
          message_ids:
            'コンテキストを取得するメッセージ ID リスト。単一 ID または複数 ID が可能。メッセージ ID は search_messages などのツールの返却結果から取得できる',
          context_size: 'コンテキストサイズ。前後それぞれ何件のメッセージを取得するか。デフォルト 20',
        },
      },
      get_segment_messages: {
        desc: '指定セグメントの完全なメッセージリストを取得する。get_segment_summaries で関連セグメントの要約を見つけた後、そのセグメントの完全な原文コンテキストを取得するために使用する。セグメントの全メッセージと参加者情報を返却する。',
        params: {
          segment_id: 'セグメント ID。get_segment_summaries の返却結果から取得できる',
          limit: '返却メッセージ数の上限。デフォルト 1000。非常に長いセグメントでは Token 節約のため件数を制限できる',
        },
      },
      get_segment_summaries: {
        desc: `セグメント要約リストを取得し、グループチャットの過去の議論トピックをすばやく把握する。

適用シーン：
1. グループで最近何が話題になっていたか知りたい
2. キーワードで過去に議論されたトピックを検索
3. 「グループで旅行について話したことある？」などの概要的な質問

返却される要約は各セグメントの短い概要であり、興味のあるセグメントをすばやく特定し、get_segment_messages で詳細を取得できる。`,
        params: {
          keywords: '要約内で検索するキーワードリスト（OR ロジックマッチ）',
          limit: '返却セグメント数の上限。デフォルト 20',
          year: '指定年のセグメントをフィルタリング',
          month: '指定月のセグメントをフィルタリング（1-12）',
          day: '指定日のセグメントをフィルタリング（1-31）',
          start_time: '開始時刻。形式 "YYYY-MM-DD HH:mm"',
          end_time: '終了時刻。形式 "YYYY-MM-DD HH:mm"',
        },
      },
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
      daily_active_members: {
        desc: '日ごとのユニーク発言者数（DAU）とメッセージ数を集計し、グループの活性度の推移を観察する。「最近グループはどのくらい活発か」「何人が発言しているか」に適している。',
        params: { days: '直近何日間のデータを集計するか' },
        rowTemplate: '{day}：{active_members} 人アクティブ、{msg_count} 件メッセージ',
        summaryTemplate: '直近 {rowCount} 日間の日別アクティブ人数推移：',
        fallback: 'この期間にメッセージの記録がありません',
      },
      conversation_initiator_stats: {
        desc: '各メンバーが会話を開始した回数（セグメントの最初の発言者）を集計し、誰が最も話題を切り出すかを発見する。セグメントインデックスの生成が必要。',
        params: {
          days: '直近何日間のデータを集計するか',
          limit: '上位何名を返却するか',
        },
        rowTemplate: '{name}：{initiated_count} 回話題を開始',
        summaryTemplate: '話題開始者 Top {rowCount}：',
        fallback: 'この期間にセグメント記録がありません。先にセグメントインデックスを生成する必要があるかもしれません',
      },
      activity_heatmap: {
        desc: '曜日×時間帯のメッセージ数マトリックスを返却する。活性度ヒートマップの生成に適している。weekday: 0=日曜, 1=月曜, ..., 6=土曜。',
        params: { days: '直近何日間のデータを集計するか' },
        rowTemplate: '曜日{weekday} {hour}:00 — {msg_count} 件',
        summaryTemplate: '活性度ヒートマップデータ（全 {rowCount} 時間帯にメッセージあり）：',
        fallback: 'この期間にメッセージの記録がありません',
      },
      response_time_analysis: {
        desc: 'メッセージ間の応答時間を分析し、メンバーごとの中央値と平均返信速度を集計する。「みんなどのくらいで返信するか」「誰が最も速く返信するか」に適している。',
        params: {
          days: '直近何日間のデータを集計するか',
          top_n: '上位何名を返却するか',
        },
      },
      keyword_frequency: {
        desc: '指定期間のテキストメッセージを分詞し、高頻度キーワードをランキングする。中国語・英語・日本語の分詞に対応。「みんなが最もよく話す話題は何か」「高頻度キーワードは何か」に適している。',
        params: {
          days: '直近何日間のデータを集計するか',
          top_n: '上位何個のキーワードを返却するか',
        },
      },
      get_schema: {
        desc: 'チャットデータベースのスキーマを確認します。チャート作成やカスタム SQL の前にテーブル名とフィールド名を確認してください。',
        params: {},
      },
      render_chart: {
        desc: 'ChartSpec v1 から ChatLab ネイティブチャートを生成します。bar、line、pie、heatmap をサポートします。`rows`（高レベルツールのデータ配列、例：get_time_stats の `data` フィールド）または `sql`（読み取り専用 SELECT）のいずれかを指定します。データがすでに取得済みの場合は `rows` を優先し、高レベルツールで対応できない場合のみ `sql` を使用します。HTML、JavaScript、SVG、ECharts option、描画コードは出力しないでください。',
        params: {
          rows: '高レベルツールから取得したデータ配列（例：get_time_stats の `data` フィールド）。データが取得済みの場合は sql より優先して使用します。sql とは排他。',
          sql: '読み取り専用の SELECT または WITH SELECT SQL。高レベルツールで対応できない場合のみ使用します。ChartSpec encoding で参照するフィールドを返す必要があります。',
          params: 'SQL の名前付きパラメータ。不要な場合は空オブジェクトを渡します。',
          chartSpec: 'version、type、title、encoding を含む ChartSpec v1。',
          maxRows: 'チャートクエリの最大行数。デフォルトは 1000。',
        },
      },
    },

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
      timeParamsIntro: '時間パラメータ：start_time/end_time で範囲を指定。形式は "YYYY-MM-DD HH:mm"',
      defaultYearNote: '時間範囲を指定しない場合は全期間が対象。現在の年は{{year}}年',
      dataSnapshotNote:
        '現在のチャットデータベースのスナップショット：{{name}}（{{platform}}）、総メッセージ {{totalMessages}} 件、メンバー {{totalMembers}} 人、期間 {{firstMessageDate}} ~ {{lastMessageDate}}。このスナップショットはデータ範囲の判断にのみ使い、具体的なチャット事実の回答には必ず現在のデータベースをツールで検索する。',
      dataSnapshotContext: `現在のチャットデータベース起動コンテキスト：
- name: {{name}}
- platform: {{platform}}
- type: {{type}}
- total_messages: {{totalMessages}}
- total_members: {{totalMembers}}
- first_message_ts: {{firstMessageTs}}
- first_message_time: {{firstMessageTime}}
- last_message_ts: {{lastMessageTs}}
- last_message_time: {{lastMessageTime}} (インポート済みデータのカバレッジ終端時刻。グループ/会話が現在もアクティブかどうかは示しません)
- segment_summaries_available: {{segmentSummaryCount}}

{{memberHintTitle}}
{{memberHintLines}}

使用ルール：
{{usageRules}}`,
      dataSnapshotMemberHintsAll: 'アクティブメンバー検索ヒント（全メンバー）：',
      dataSnapshotMemberHintsTop: 'アクティブメンバー検索ヒント（過去の総メッセージ数 Top 10）：',
      dataSnapshotMemberHintsUnavailable: 'アクティブメンバー検索ヒント：',
      dataSnapshotMemberHintsEmpty: '利用可能なメンバーヒントはありません。',
      dataSnapshotUsageRules: `- member_id はツール検索用のヒントです。display_name は人間が識別するためだけのもので、一意とは限りません。
- ユーザーが技術的詳細を明示的に求めない限り、最終回答で member_id や起動コンテキスト自体を積極的に開示しないでください。
- アクティブメンバー順位は過去の総メッセージ量だけを示し、最近の活発さを示すものではありません。また、影響力、関係性、最近の傾向の結論証拠にもなりません。
- 相対的な時間表現は、データベースの最終メッセージ時刻ではなく、実際の現在日付を基準に解釈してください。
- 「最近一年/過去一年」は実際の現在日付から今日までの1年間を指し、「去年」は前の暦年を指します。
- データベースの時間境界はカバレッジ説明にのみ使い、ユーザーが求めた時間範囲を再定義するために使わないでください。
- デフォルトの「直近 N 日」ツールを使う場合は、空の実際現在日付ウィンドウを試すのではなく、データベース時間境界と交差する範囲を先に選んでください。
- min/max timestamp を再発見するためだけにツールを呼ばないでください。ただし、具体的なチャット事実、統計、結論には引き続きツール証拠が必要です。
- last_message_time はインポート済みデータのカバレッジ終端時刻であり、グループ/会話の現実世界における最終発言時刻ではありません。ユーザーがまだ新しい記録をインポートしていないだけかもしれません。この時刻からグループが「どれだけ活動していない」と推測したり、グループを「活性化」するよう提案したりしないでください。`,
      evidencePolicy: `証拠ポリシー：
- AI 会話履歴、過去の AI 回答、圧縮要約はユーザー意図の理解にのみ使用し、チャット記録の事実証拠として扱わない。
- ユーザーがチャット内容、最近の話題、誰かの発言、ランキング/統計、ある話題が出たかどうか、または原文引用を求めた場合は、必ず先に適切なデータツールで現在のデータベースを検索する。
- 新しいチャット記録が追加されている場合、現在のデータベースは古いウィンドウ履歴と異なる可能性がある。最新の証拠取得には get_chat_overview または get_recent_messages/search_messages を優先する。
- 事実根拠として使えるのは、ツールが返したメッセージ、統計、またはデータベース概要のみ。ツールが十分な証拠を返さない場合は、データ不足と明示し、存在しないチャット記録を作らない。`,
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

  llm: {
    notConfigured: 'LLM サービスが未設定です。先に設定で API Key を設定してください',
    maxConfigs: '設定は最大 {{count}} 個まで追加できます',
    configNotFound: '設定が存在しません',
    noActiveConfig: 'アクティブな設定がありません',
    callFailed: 'LLM 呼び出しに失敗しました。モデル設定を確認してください。',
    genericProviderName: 'API プロバイダー',
    rawErrorLabel: '元のエラー',
  },

  summary: {
    segmentNotFound: 'セグメントが存在しないか、データベースを開けませんでした',
    tooFewMessages: 'メッセージ数が{{count}}件未満のため、要約の生成は不要です',
    tooFewValidMessages: '有効なメッセージ数が{{count}}件未満のため、要約の生成は不要です',
    segmentNotExist: 'セグメントが存在しません',
    messagesTooFew: 'メッセージが少なすぎます',
    validMessagesTooFew: '有効なメッセージが少なすぎます',
    systemPromptDirect: 'あなたは会話要約の専門家であり、簡潔な言葉で会話内容を要約することに長けている。',
    systemPromptMerge: 'あなたは会話要約の専門家であり、複数の要約を一つのまとまった概要に統合することに長けている。',
  },
}
