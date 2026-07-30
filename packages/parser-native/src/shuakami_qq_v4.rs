//! shuakami/qq-chat-exporter single-file JSON kernel.

use std::collections::HashMap;

use memchr::memmem;
use serde::Serialize;
use serde_json::Value;

use crate::input::KernelInput;
use crate::jsutil::extract_name_from_file_path;
use crate::protocol::{KernelOutput, NativeMessage};
use crate::scanner::{for_each_array_element, walk_top_level, ScanError, ScanResult};
use crate::shuakami_qq::{
    is_shuakami_qq_data_image_avatar, parse_shuakami_qq_single_file_message,
    ShuakamiQqMemberTracker,
};

const HEAD_LIMIT: usize = 500_000;
const TAIL_LIMIT: usize = 5_000_000;
const MAX_SAFE_NESTING_DEPTH: usize = 128;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShuakamiQqV4Meta {
    name: String,
    chat_type: &'static str,
    group_avatar: Option<String>,
    skipped_messages: usize,
}

fn offset_of(root: &[u8], raw: &[u8]) -> usize {
    (raw.as_ptr() as usize).saturating_sub(root.as_ptr() as usize)
}

fn end_offset(root: &[u8], raw: &[u8]) -> usize {
    offset_of(root, raw).saturating_add(raw.len())
}

fn key_start_offset(root: &[u8], key: &[u8]) -> usize {
    (key.as_ptr() as usize)
        .saturating_sub(root.as_ptr() as usize)
        .saturating_sub(1)
}

fn has_immediate_colon(root: &[u8], key: &[u8]) -> bool {
    let closing_quote = (key.as_ptr() as usize)
        .saturating_sub(root.as_ptr() as usize)
        .saturating_add(key.len());
    root.get(closing_quote + 1) == Some(&b':')
}

fn scan_error(root: &[u8], raw: &[u8], message: impl Into<String>) -> ScanError {
    ScanError {
        message: message.into(),
        offset: offset_of(root, raw),
    }
}

fn reject_escaped_key(root: &[u8], key: &[u8]) -> ScanResult<()> {
    if key.contains(&b'\\') {
        return Err(scan_error(
            root,
            key,
            "escaped JSON object key; falling back to TS parser",
        ));
    }
    Ok(())
}

/// The shared scanner is recursive. Guard this N-API-only format with an
/// iterative structural pass so adversarially deep ignored html/raw fields
/// fail safely before they can overflow the parser thread's stack.
fn reject_excessive_nesting(root: &[u8]) -> ScanResult<()> {
    let mut depth = 0_usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, byte) in root.iter().copied().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }

        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => {
                depth += 1;
                if depth > MAX_SAFE_NESTING_DEPTH {
                    return Err(ScanError {
                        message: "JSON nesting depth exceeds shuakami/qq-chat-exporter native safety limit; falling back to TS parser"
                            .to_string(),
                        offset,
                    });
                }
            }
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    Ok(())
}

fn reject_nested_key_before_top_level(
    root: &[u8],
    window_start: usize,
    window_end: usize,
    token: &[u8],
    top_level_key: Option<&[u8]>,
    field: &str,
) -> ScanResult<()> {
    let first_raw_offset = memmem::find(&root[window_start..window_end], token)
        .map(|relative| window_start + relative);
    let top_level_offset = top_level_key
        .filter(|key| has_immediate_colon(root, key))
        .map(|key| key_start_offset(root, key));

    if first_raw_offset.is_some() && first_raw_offset != top_level_offset {
        return Err(ScanError {
            message: format!(
                "nested {field} precedes the top-level field; falling back to TS parser"
            ),
            offset: first_raw_offset.unwrap_or(window_start),
        });
    }
    Ok(())
}

fn parse_optional_string(
    root: &[u8],
    raw: Option<&[u8]>,
    field: &str,
    null_is_missing: bool,
) -> ScanResult<Option<String>> {
    match raw {
        None => Ok(None),
        Some(b"null") if null_is_missing => Ok(None),
        Some(raw @ b"null") => Err(scan_error(
            root,
            raw,
            format!("unsupported null {field}; falling back to TS parser"),
        )),
        Some(raw) => serde_json::from_slice::<String>(raw)
            .map(Some)
            .map_err(|error| scan_error(root, raw, format!("invalid {field}: {error}"))),
    }
}

struct ChatInfo {
    name: String,
    chat_type: Option<String>,
    avatar: Option<String>,
}

fn parse_chat_info(root: &[u8], raw: &[u8]) -> ScanResult<ChatInfo> {
    let mut name = None;
    let mut chat_type = None;
    let mut avatar = None;
    walk_top_level(raw, |key, value| {
        reject_escaped_key(root, key)?;
        match key {
            b"name" => name = Some(value),
            b"type" => chat_type = Some(value),
            b"avatar" => avatar = Some(value),
            _ => {}
        }
        Ok(())
    })
    .map_err(|error| scan_error(root, raw, format!("invalid chatInfo: {error}")))?;

    Ok(ChatInfo {
        name: parse_optional_string(root, name, "chatInfo.name", true)?.unwrap_or_default(),
        chat_type: parse_optional_string(root, chat_type, "chatInfo.type", true)?,
        avatar: parse_optional_string(root, avatar, "chatInfo.avatar", false)?,
    })
}

fn is_json_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}

/// Replicate the TS parser's deliberately textual head heuristic exactly: use
/// the first raw `"senders"` occurrence anywhere in the first 500KB, find a
/// nearby `[`, match brackets without string awareness, then count every raw
/// string-valued `"uid"` occurrence without deduplication.
fn count_head_senders(root: &[u8]) -> usize {
    let head = &root[..root.len().min(HEAD_LIMIT)];
    let Some(senders_start) = memmem::find(head, br#""senders""#) else {
        return 0;
    };
    let Some(relative_array_start) = head[senders_start..].iter().position(|byte| *byte == b'[')
    else {
        return 0;
    };
    // String#indexOf reports UTF-16 code-unit offsets in JavaScript, not UTF-8
    // byte offsets. The source is valid UTF-8, so reproduce that narrow
    // 20-character heuristic even for non-ASCII text between the key and `[`.
    let distance = std::str::from_utf8(&head[senders_start..senders_start + relative_array_start])
        .map(|value| value.encode_utf16().count())
        .unwrap_or(relative_array_start);
    if distance > 20 {
        return 0;
    }
    let array_start = senders_start + relative_array_start;
    let mut depth = 1_usize;
    let mut cursor = array_start + 1;
    while cursor < head.len() && depth > 0 {
        match head[cursor] {
            b'[' => depth += 1,
            b']' => depth -= 1,
            _ => {}
        }
        cursor += 1;
    }
    if depth != 0 {
        return 0;
    }

    let senders = &head[array_start + 1..cursor - 1];
    let mut count = 0_usize;
    let mut search_from = 0_usize;
    while let Some(relative_uid) = memmem::find(&senders[search_from..], br#""uid""#) {
        let mut position = search_from + relative_uid + br#""uid""#.len();
        while senders
            .get(position)
            .is_some_and(|byte| is_json_whitespace(*byte))
        {
            position += 1;
        }
        if senders.get(position) != Some(&b':') {
            search_from += relative_uid + br#""uid""#.len();
            continue;
        }
        position += 1;
        while senders
            .get(position)
            .is_some_and(|byte| is_json_whitespace(*byte))
        {
            position += 1;
        }
        if senders.get(position) != Some(&b'"') {
            search_from += relative_uid + br#""uid""#.len();
            continue;
        }
        let value_start = position + 1;
        let Some(value_len) = senders[value_start..].iter().position(|byte| *byte == b'"') else {
            break;
        };
        let uid = &senders[value_start..value_start + value_len];
        if !uid.is_empty() && uid != b"0" && uid != "未知".as_bytes() {
            count += 1;
        }
        search_from = value_start + value_len + 1;
    }
    count
}

fn resolve_chat_type(chat_type: Option<&str>, sender_count: usize) -> &'static str {
    match chat_type {
        Some("group") => "group",
        Some("private") if sender_count > 2 => "group",
        Some("private") => "private",
        _ if sender_count > 2 => "group",
        _ if sender_count > 0 => "private",
        _ => "group",
    }
}

fn parse_tail_avatars(
    root: &[u8],
    key: Option<&[u8]>,
    raw: Option<&[u8]>,
) -> HashMap<String, String> {
    let (Some(key), Some(raw)) = (key, raw) else {
        return HashMap::new();
    };
    let tail_start = root.len().saturating_sub(TAIL_LIMIT);
    if key_start_offset(root, key) < tail_start || !has_immediate_colon(root, key) {
        return HashMap::new();
    }

    let Ok(Value::Object(values)) = serde_json::from_slice::<Value>(raw) else {
        return HashMap::new();
    };
    values
        .into_iter()
        .filter_map(|(id, value)| match value {
            Value::String(avatar) if is_shuakami_qq_data_image_avatar(&avatar) => {
                Some((id, avatar))
            }
            _ => None,
        })
        .collect()
}

pub(crate) fn parse_shuakami_qq_v4(
    buf: &[u8],
    input: &KernelInput,
    mut on_progress: impl FnMut(u64, u64),
) -> ScanResult<KernelOutput> {
    reject_excessive_nesting(buf)?;

    let mut chat_info_key = None;
    let mut chat_info_raw = None;
    let mut messages_raw = None;
    let mut avatars_key = None;
    let mut avatars_raw = None;

    walk_top_level(buf, |key, raw| {
        reject_escaped_key(buf, key)?;
        match key {
            b"chatInfo" => {
                if chat_info_raw.is_some() {
                    return Err(scan_error(
                        buf,
                        raw,
                        "duplicate chatInfo; falling back to TS parser",
                    ));
                }
                chat_info_key = Some(key);
                chat_info_raw = Some(raw);
            }
            b"messages" => {
                if messages_raw.is_some() {
                    return Err(scan_error(
                        buf,
                        raw,
                        "duplicate messages; falling back to TS parser",
                    ));
                }
                messages_raw = Some(raw);
            }
            b"avatars" => {
                if avatars_raw.is_some() {
                    return Err(scan_error(
                        buf,
                        raw,
                        "duplicate avatars; falling back to TS parser",
                    ));
                }
                avatars_key = Some(key);
                avatars_raw = Some(raw);
            }
            _ => {}
        }
        Ok(())
    })?;

    let head_end = buf.len().min(HEAD_LIMIT);
    reject_nested_key_before_top_level(
        buf,
        0,
        head_end,
        br#""chatInfo":"#,
        chat_info_key,
        "chatInfo",
    )?;
    let tail_start = buf.len().saturating_sub(TAIL_LIMIT);
    reject_nested_key_before_top_level(
        buf,
        tail_start,
        buf.len(),
        br#""avatars":"#,
        avatars_key,
        "avatars",
    )?;

    let chat_info_visible = chat_info_key.zip(chat_info_raw).filter(|(key, raw)| {
        has_immediate_colon(buf, key)
            && raw.first() == Some(&b'{')
            && end_offset(buf, raw) <= head_end
    });
    let chat_info = match chat_info_visible {
        Some((_, raw)) => Some(parse_chat_info(buf, raw)?),
        None => None,
    };
    let sender_count = count_head_senders(buf);
    let (name, chat_type, group_avatar) = match chat_info {
        Some(info) => {
            let name = if info.name.is_empty() {
                extract_name_from_file_path(&input.primary_path, "未知群聊")
            } else {
                info.name
            };
            let chat_type = resolve_chat_type(info.chat_type.as_deref(), sender_count);
            (name, chat_type, info.avatar)
        }
        // The TS parser initializes chatInfo with a truthy default name and
        // explicit group type when the head object cannot be extracted.
        None => ("未知群聊".to_string(), "group", None),
    };

    let avatars = parse_tail_avatars(buf, avatars_key, avatars_raw);
    let mut members = ShuakamiQqMemberTracker::new();
    let mut messages: Vec<NativeMessage> = Vec::new();
    let mut skipped_messages = 0_usize;

    if let Some(raw) = messages_raw {
        let base_offset = offset_of(buf, raw);
        for_each_array_element(raw, base_offset, |element, end| {
            match parse_shuakami_qq_single_file_message(buf, element)? {
                None => skipped_messages += 1,
                Some(observed) => {
                    members.observe(&observed);
                    if let Some(message) = observed.message {
                        messages.push(message);
                        on_progress(end as u64, messages.len() as u64);
                    } else {
                        skipped_messages += 1;
                    }
                }
            }
            Ok(())
        })?;
    }

    members.apply_avatars(&avatars);
    let members = members.into_members();
    let meta_json = serde_json::to_string(&ShuakamiQqV4Meta {
        name,
        chat_type,
        group_avatar,
        skipped_messages,
    })
    .map_err(|error| ScanError {
        message: format!("meta serialization failed: {error}"),
        offset: 0,
    })?;

    Ok(KernelOutput {
        meta_json,
        members,
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(doc: &str) -> KernelOutput {
        let input = KernelInput {
            primary_path: "/tmp/fallback-name.json".to_string(),
            options_json: None,
        };
        parse_shuakami_qq_v4(doc.as_bytes(), &input, |_, _| {})
            .expect("shuakami/qq-chat-exporter V4 should parse")
    }

    #[test]
    fn parses_meta_members_messages_reply_and_avatar() {
        let output = parse(
            r#"{
              "metadata":{"name":"QQChatExporter V6","version":"6.0.3"},
              "chatInfo":{"name":"测试群","type":"group","avatar":"data:image/png;base64,GROUP"},
              "statistics":{"senders":[{"uid":"u_100"},{"uid":"u_200"},{"uid":"u_300"}]},
              "messages":[
                {"messageId":"m1","timestamp":"2026-07-10T12:00:00.123+08:00",
                 "sender":{"uin":"100","uid":"u_100","name":"Alice"},
                 "rawMessage":{"sendNickName":"Alice QQ","sendMemberName":"群名片"},
                 "content":{"text":" hello ","reply":{"referencedMessageId":"m0"},
                            "html":"ignored heavy field","raw":{"anything":true}}}
              ],
              "avatars":{"100":"data:image/jpeg;base64,ALICE","x":"https://example.com/x.png"}
            }"#,
        );
        let meta: Value = serde_json::from_str(&output.meta_json).expect("meta should be JSON");
        assert_eq!(meta["name"], "测试群");
        assert_eq!(meta["chatType"], "group");
        assert_eq!(meta["groupAvatar"], "data:image/png;base64,GROUP");
        assert_eq!(output.members.len(), 1);
        assert_eq!(output.members[0].account_name, "Alice QQ");
        assert_eq!(output.members[0].group_nickname.as_deref(), Some("群名片"));
        assert_eq!(
            output.members[0].avatar.as_deref(),
            Some("data:image/jpeg;base64,ALICE")
        );
        assert_eq!(output.messages.len(), 1);
        assert_eq!(output.messages[0].content.as_deref(), Some(" hello "));
        assert_eq!(
            output.messages[0].reply_to_message_id.as_deref(),
            Some("m0")
        );
    }

    #[test]
    fn corrects_private_type_using_head_sender_occurrences() {
        let output = parse(
            r#"{"metadata":{},"chatInfo":{"name":"群","type":"private"},
               "statistics":{"senders":[{"uid":"1"},{"uid":"1"},{"uid":"2"}]},
               "messages":[]}"#,
        );
        let meta: Value = serde_json::from_str(&output.meta_json).expect("meta should be JSON");
        assert_eq!(meta["chatType"], "group");
    }

    #[test]
    fn uses_the_first_raw_senders_occurrence_in_the_head() {
        let output = parse(
            r#"{"metadata":{"senders":[{"uid":"metadata-only"}]},
               "chatInfo":{"name":"first senders wins"},
               "statistics":{"senders":[{"uid":"1"},{"uid":"2"},{"uid":"3"}]},
               "messages":[]}"#,
        );
        let meta: Value = serde_json::from_str(&output.meta_json).expect("meta should be JSON");
        assert_eq!(meta["chatType"], "private");
    }

    #[test]
    fn counts_duplicate_raw_uid_keys_without_deduplication() {
        let output = parse(
            r#"{"metadata":{},"chatInfo":{"name":"duplicates"},
               "statistics":{"senders":[{"uid":"1","uid":"2"},{"uid":"3"}]},
               "messages":[]}"#,
        );
        let meta: Value = serde_json::from_str(&output.meta_json).expect("meta should be JSON");
        assert_eq!(meta["chatType"], "group");
    }

    #[test]
    fn measures_the_sender_array_lookahead_in_utf16_code_units() {
        let output = parse(
            r#"{"metadata":{},"chatInfo":{"name":"utf16"},
               "statistics":{"senders":"中中","x":[{"uid":"1"}]},
               "messages":[]}"#,
        );
        let meta: Value = serde_json::from_str(&output.meta_json).expect("meta should be JSON");
        assert_eq!(meta["chatType"], "private");
    }

    #[test]
    fn rejects_malformed_root_before_exposing_output() {
        let input = KernelInput {
            primary_path: "/tmp/bad.json".to_string(),
            options_json: None,
        };
        assert!(parse_shuakami_qq_v4(br#"{"messages":[{"#, &input, |_, _| {}).is_err());
    }

    #[test]
    fn uses_ts_head_window_for_chat_info() {
        let padding = "H".repeat(HEAD_LIMIT);
        let doc = format!(
            r#"{{"metadata":{{"padding":"{padding}"}},"chatInfo":{{"name":"too late","type":"private"}},"messages":[]}}"#
        );
        let output = parse(&doc);
        let meta: Value = serde_json::from_str(&output.meta_json).expect("meta should be JSON");
        assert_eq!(meta["name"], "未知群聊");
        assert_eq!(meta["chatType"], "group");
    }

    #[test]
    fn uses_ts_tail_window_for_avatars() {
        let padding = "A".repeat(TAIL_LIMIT);
        let doc = format!(
            r#"{{"metadata":{{}},"chatInfo":{{"name":"avatars","type":"group"}},"messages":[{{"timestamp":"2026-07-10T12:00:00Z","sender":{{"uin":"100","name":"Alice"}},"content":{{"text":"hello"}}}}],"avatars":{{"100":"data:image/png;base64,ALICE","padding":"{padding}"}}}}"#
        );
        let output = parse(&doc);
        assert_eq!(output.members.len(), 1);
        assert_eq!(output.members[0].avatar, None);
    }

    #[test]
    fn rejects_duplicate_critical_top_level_fields() {
        let input = KernelInput {
            primary_path: "/tmp/duplicate.json".to_string(),
            options_json: None,
        };
        let error = parse_shuakami_qq_v4(
            br#"{"metadata":{},"chatInfo":{},"messages":[],"messages":[]}"#,
            &input,
            |_, _| {},
        )
        .err()
        .expect("duplicates should require TS fallback");
        assert!(error.message.contains("duplicate messages"));
    }

    #[test]
    fn rejects_escaped_object_keys_for_ts_fallback() {
        let input = KernelInput {
            primary_path: "/tmp/escaped-key.json".to_string(),
            options_json: None,
        };
        let error = parse_shuakami_qq_v4(
            br#"{"metadata":{},"chatInfo":{"name":"escaped","type":"group"},"messages":[{"timestamp":"2026-07-10T12:00:00Z","sender":{"u\u0069n":"100","name":"Alice"},"content":{"text":"hello"}}]}"#,
            &input,
            |_, _| {},
        )
        .err()
        .expect("escaped keys should require TS fallback");
        assert!(error.message.contains("escaped JSON object key"));
    }

    #[test]
    fn rejects_nested_chat_info_before_the_top_level_field() {
        let input = KernelInput {
            primary_path: "/tmp/nested-chat-info.json".to_string(),
            options_json: None,
        };
        let error = parse_shuakami_qq_v4(
            br#"{"metadata":{"chatInfo":{"name":"nested","type":"private"}},"chatInfo":{"name":"top","type":"group"},"messages":[]}"#,
            &input,
            |_, _| {},
        )
        .err()
        .expect("the TS raw-key heuristic should require fallback");
        assert!(error.message.contains("nested chatInfo"));
    }

    #[test]
    fn rejects_nested_avatars_before_the_top_level_field_in_the_tail() {
        let input = KernelInput {
            primary_path: "/tmp/nested-avatars.json".to_string(),
            options_json: None,
        };
        let error = parse_shuakami_qq_v4(
            br#"{"chatInfo":{"name":"avatars","type":"group"},"messages":[{"timestamp":"2026-07-10T12:00:00Z","sender":{"uin":"100","name":"Alice"},"content":{"text":"hello","raw":{"avatars":{"100":"data:image/png;base64,NESTED"}}}}],"avatars":{"100":"data:image/png;base64,TOP"}}"#,
            &input,
            |_, _| {},
        )
        .err()
        .expect("the TS raw-key heuristic should require fallback");
        assert!(error.message.contains("nested avatars"));
    }

    #[test]
    fn rejects_excessive_nesting_before_entering_the_recursive_scanner() {
        let input = KernelInput {
            primary_path: "/tmp/deep.json".to_string(),
            options_json: None,
        };
        let doc = format!(
            "{{\"chatInfo\":{{}},\"messages\":[],\"padding\":{}0{}}}",
            "[".repeat(MAX_SAFE_NESTING_DEPTH + 1),
            "]".repeat(MAX_SAFE_NESTING_DEPTH + 1)
        );
        let error = parse_shuakami_qq_v4(doc.as_bytes(), &input, |_, _| {})
            .err()
            .expect("deep input should fail safely");
        assert!(error.message.contains("nesting depth"));
    }
}
