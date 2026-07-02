//! WeFlow (WeChat export) format kernel.
//!
//! Replicates the behavior of `packages/parser/src/formats/weflow.ts` in a
//! single pass over the file buffer. The TS implementation is the reference:
//! any semantic difference is a bug (covered by TS-side parity tests).

use std::collections::HashMap;

use serde_json::Value;

use crate::jsutil::{extract_name_from_file_path, non_empty_str};
use crate::scanner::{for_each_array_element, walk_top_level, ScanResult};

pub struct MemberOut {
    pub platform_id: String,
    pub account_name: String,
    pub avatar: Option<String>,
}

#[derive(Default)]
pub struct MessageOut {
    pub platform_message_id: String,
    pub sender_platform_id: String,
    pub sender_account_name: String,
    pub timestamp: Option<f64>,
    pub message_type: u32,
    pub content: Option<String>,
}

pub struct WeflowOutput {
    pub name: String,
    /// "group" | "private" — matches the ChatType enum string values.
    pub chat_type: &'static str,
    pub group_id: Option<String>,
    pub group_avatar: Option<String>,
    pub owner_id: Option<String>,
    pub members: Vec<MemberOut>,
    pub messages: Vec<MessageOut>,
}

/// Message type mapping, mirroring `convertMessageType` in weflow.ts.
/// Values are the numeric MessageType enum members from shared-types.
fn convert_message_type(type_str: Option<&str>) -> u32 {
    match type_str {
        Some("文本消息") => 0,                             // TEXT
        Some("图片消息") => 1,                             // IMAGE
        Some("语音消息") => 2,                             // VOICE
        Some("视频消息") => 3,                             // VIDEO
        Some("文件消息") => 4,                             // FILE
        Some("动画表情") => 5,                             // EMOJI
        Some("名片消息") => 27,                            // CONTACT
        Some("卡片式链接") | Some("图文消息") => 7,        // LINK
        Some("位置消息") => 8,                             // LOCATION
        Some("红包卡片") => 20,                            // RED_PACKET
        Some("转账卡片") => 21,                            // TRANSFER
        Some("小程序分享") | Some("视频号直播卡片") => 24, // SHARE
        Some("引用消息") => 25,                            // REPLY
        Some("聊天记录合并转发") => 26,                    // FORWARD
        Some("系统消息") => 80,                            // SYSTEM
        _ => 99,                                           // OTHER
    }
}

/// JavaScript `String.prototype.trim` semantics: Unicode White_Space minus
/// U+0085 (NEL, not trimmed by JS), plus U+FEFF (trimmed by JS).
fn js_trim(input: &str) -> &str {
    input.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// JS `String(x)` semantics for the localId field.
fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        // Arrays/objects are pathological for an ID field; compact JSON is a
        // reasonable stand-in for JS coercion here.
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn is_send_equals_one(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Number(n)) if n.as_f64() == Some(1.0))
}

struct MemberTracker {
    order: Vec<MemberOut>,
    index: HashMap<String, usize>,
}

impl MemberTracker {
    fn new() -> Self {
        MemberTracker {
            order: Vec::new(),
            index: HashMap::new(),
        }
    }

    fn observe(&mut self, platform_id: &str, account_name: &str, avatar: Option<&String>) {
        match self.index.get(platform_id) {
            Some(&i) => {
                let member = &mut self.order[i];
                // Latest display name wins; avatar only overwritten when present.
                member.account_name = account_name.to_string();
                if let Some(a) = avatar {
                    member.avatar = Some(a.clone());
                }
            }
            None => {
                self.index.insert(platform_id.to_string(), self.order.len());
                self.order.push(MemberOut {
                    platform_id: platform_id.to_string(),
                    account_name: account_name.to_string(),
                    avatar: avatar.cloned(),
                });
            }
        }
    }
}

pub fn parse_weflow(
    buf: &[u8],
    file_path: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> ScanResult<WeflowOutput> {
    // Pass 1: structural walk of the top-level object to locate the raw spans
    // we care about. `scan_value` skims containers at memchr speed, so this is
    // cheap even when `messages` is hundreds of MB.
    let mut session_raw: Option<&[u8]> = None;
    let mut avatars_raw: Option<&[u8]> = None;
    let mut messages_raw: Option<&[u8]> = None;

    walk_top_level(buf, |key, raw| {
        match key {
            b"session" => session_raw = Some(raw),
            b"avatars" => avatars_raw = Some(raw),
            b"messages" => messages_raw = Some(raw),
            _ => {}
        }
        Ok(())
    })?;

    // session: parse failure or non-object behaves like "no session" (the TS
    // code catches parse errors and reads fields off a possibly-null object).
    let session: Option<serde_json::Map<String, Value>> = session_raw
        .and_then(|raw| serde_json::from_slice::<Value>(raw).ok())
        .and_then(|v| match v {
            Value::Object(map) => Some(map),
            _ => None,
        });

    // avatars: wxid -> base64 data URL; only non-empty strings are kept.
    let mut avatars: HashMap<String, String> = HashMap::new();
    if let Some(raw) = avatars_raw {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(raw) {
            for (wxid, v) in map {
                if let Value::String(s) = v {
                    if !s.is_empty() {
                        avatars.insert(wxid, s);
                    }
                }
            }
        }
    }

    // Chat type: '私聊' -> private, '群聊' -> group, otherwise infer from wxid.
    let session_type = session.as_ref().and_then(|s| non_empty_str(s.get("type")));
    let session_wxid = session.as_ref().and_then(|s| non_empty_str(s.get("wxid")));
    let chat_type: &'static str = match session_type {
        Some("私聊") => "private",
        Some("群聊") => "group",
        _ => match session_wxid {
            Some(wxid) if !wxid.ends_with("@chatroom") => "private",
            _ => "group",
        },
    };

    let name = session
        .as_ref()
        .and_then(|s| non_empty_str(s.get("displayName")))
        .or_else(|| {
            session
                .as_ref()
                .and_then(|s| non_empty_str(s.get("nickname")))
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| extract_name_from_file_path(file_path, "未知聊天"));

    let group_id: Option<String> = if chat_type == "group" {
        session_wxid.map(|s| s.to_string())
    } else {
        None
    };

    let group_avatar: Option<String> = session
        .as_ref()
        .and_then(|s| non_empty_str(s.get("avatar")))
        .map(|s| s.to_string())
        .or_else(|| group_id.as_ref().and_then(|id| avatars.get(id).cloned()));

    // Pass 2: stream the messages array element by element.
    let mut members = MemberTracker::new();
    let mut messages: Vec<MessageOut> = Vec::new();
    let mut owner_id: Option<String> = None;

    if let Some(raw) = messages_raw {
        let base_offset = raw.as_ptr() as usize - buf.as_ptr() as usize;
        for_each_array_element(raw, base_offset, |element, end_offset| {
            let value: Value = match serde_json::from_slice(element) {
                Ok(v) => v,
                Err(_) => {
                    // Structurally valid JSON always deserializes into Value; this arm
                    // is unreachable in practice but must not abort the whole import.
                    return Ok(());
                }
            };
            let obj = match value.as_object() {
                Some(o) => o,
                None => return Ok(()),
            };

            // ownerId: first message sent by self (isSend === 1) from a non-room id.
            if owner_id.is_none() && is_send_equals_one(obj.get("isSend")) {
                if let Some(username) = non_empty_str(obj.get("senderUsername")) {
                    if !username.ends_with("@chatroom") {
                        owner_id = Some(username.to_string());
                    }
                }
            }

            // processMessage() replication.
            let sender = match non_empty_str(obj.get("senderUsername")) {
                Some(s) => s,
                None => return Ok(()),
            };
            if !obj.contains_key("createTime") {
                return Ok(());
            }
            if sender.ends_with("@chatroom") {
                return Ok(());
            }

            let account_name = non_empty_str(obj.get("senderDisplayName")).unwrap_or(sender);

            // avatarKey = senderAvatarKey || senderUsername; a non-string truthy
            // key can never hit the (string-keyed) avatars map, mirroring JS.
            let avatar = match obj.get("senderAvatarKey") {
                Some(Value::String(s)) if !s.is_empty() => avatars.get(s.as_str()),
                None | Some(Value::Null) => avatars.get(sender),
                Some(Value::String(_)) => avatars.get(sender), // empty string is falsy
                Some(Value::Bool(false)) => avatars.get(sender),
                Some(Value::Number(n)) if n.as_f64() == Some(0.0) => avatars.get(sender),
                Some(_) => None,
            };

            members.observe(sender, account_name, avatar);

            let timestamp = match obj.get("createTime") {
                Some(Value::Number(n)) => n.as_f64(),
                _ => None,
            };

            let content: Option<String> = match obj.get("content") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) => {
                    let trimmed = js_trim(s);
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
                Some(other) => {
                    let serialized = serde_json::to_string(other).unwrap_or_default();
                    let trimmed = js_trim(&serialized);
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
            };

            messages.push(MessageOut {
                platform_message_id: js_string(obj.get("localId")),
                sender_platform_id: sender.to_string(),
                sender_account_name: account_name.to_string(),
                timestamp,
                message_type: convert_message_type(obj.get("type").and_then(|v| v.as_str())),
                content,
            });

            on_progress(end_offset as u64, messages.len() as u64);
            Ok(())
        })?;
    }

    Ok(WeflowOutput {
        name,
        chat_type,
        group_id,
        group_avatar,
        owner_id,
        members: members.order,
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(doc: &str) -> WeflowOutput {
        parse_weflow(doc.as_bytes(), "/tmp/测试聊天.json", |_, _| {}).expect("parse should succeed")
    }

    #[test]
    fn parses_basic_group_export() {
        let doc = r#"{
      "weflow": {"version": "1.0.0"},
      "session": {"wxid": "room@chatroom", "nickname": "群名", "displayName": "群显示名", "type": "群聊", "avatar": ""},
      "avatars": {"wxid_a": "data:image/jpeg;base64,AAA", "room@chatroom": "data:image/jpeg;base64,ROOM", "wxid_empty": ""},
      "messages": [
        {"localId": 1, "createTime": 100, "type": "文本消息", "content": " hello ", "isSend": 0, "senderUsername": "wxid_a", "senderDisplayName": "Alice", "senderAvatarKey": "wxid_a"},
        {"localId": 2, "createTime": 101, "type": "图片消息", "content": "[图片]", "isSend": 1, "senderUsername": "wxid_b", "senderDisplayName": "Bob"},
        {"localId": 3, "createTime": 102, "type": "系统消息", "content": "sys", "isSend": null, "senderUsername": "room@chatroom", "senderDisplayName": "群"},
        {"localId": 4, "createTime": 103, "type": "未知类型(88)", "content": null, "isSend": 0, "senderUsername": "wxid_a", "senderDisplayName": "Alice2"}
      ]
    }"#;
        let out = parse(doc);
        assert_eq!(out.name, "群显示名");
        assert_eq!(out.chat_type, "group");
        assert_eq!(out.group_id.as_deref(), Some("room@chatroom"));
        // session.avatar is empty (falsy) -> falls back to avatars[groupId].
        assert_eq!(
            out.group_avatar.as_deref(),
            Some("data:image/jpeg;base64,ROOM")
        );
        assert_eq!(out.owner_id.as_deref(), Some("wxid_b"));

        // room@chatroom sender is skipped entirely.
        assert_eq!(out.messages.len(), 3);
        assert_eq!(out.messages[0].content.as_deref(), Some("hello"));
        assert_eq!(out.messages[0].message_type, 0);
        assert_eq!(out.messages[0].platform_message_id, "1");
        assert_eq!(out.messages[1].message_type, 1);
        assert_eq!(out.messages[2].message_type, 99);
        assert_eq!(out.messages[2].content, None);

        // Members in first-seen order; Alice's name updated by her later message.
        assert_eq!(out.members.len(), 2);
        assert_eq!(out.members[0].platform_id, "wxid_a");
        assert_eq!(out.members[0].account_name, "Alice2");
        assert_eq!(
            out.members[0].avatar.as_deref(),
            Some("data:image/jpeg;base64,AAA")
        );
        assert_eq!(out.members[1].platform_id, "wxid_b");
        assert_eq!(out.members[1].avatar, None);
    }

    #[test]
    fn message_filtering_matches_ts() {
        let doc = r#"{
      "messages": [
        {"createTime": 1, "type": "文本消息", "content": "no sender"},
        {"senderUsername": "", "createTime": 1, "content": "empty sender"},
        {"senderUsername": "wxid_a", "content": "no createTime"},
        {"senderUsername": "wxid_a", "createTime": null, "content": "null createTime"},
        {"senderUsername": "wxid_a", "createTime": 5, "senderDisplayName": "", "content": "   "}
      ]
    }"#;
        let out = parse(doc);
        assert_eq!(out.messages.len(), 2);
        // null createTime passes the parser filter with a null timestamp.
        assert_eq!(out.messages[0].timestamp, None);
        assert_eq!(out.messages[0].content.as_deref(), Some("null createTime"));
        // Empty displayName falls back to the platform id.
        assert_eq!(out.messages[1].sender_account_name, "wxid_a");
        // Whitespace-only content is normalized to null.
        assert_eq!(out.messages[1].content, None);
        // localId missing -> String(undefined).
        assert_eq!(out.messages[0].platform_message_id, "undefined");
    }

    #[test]
    fn non_string_content_is_stringified() {
        let doc = r#"{"messages": [
      {"senderUsername": "a", "createTime": 1, "content": {"k": 1, "a": [true, null]}},
      {"senderUsername": "a", "createTime": 2, "content": 42}
    ]}"#;
        let out = parse(doc);
        assert_eq!(
            out.messages[0].content.as_deref(),
            Some(r#"{"k":1,"a":[true,null]}"#)
        );
        assert_eq!(out.messages[1].content.as_deref(), Some("42"));
    }

    #[test]
    fn private_chat_and_filename_fallback() {
        let doc = r#"{"session": {"wxid": "wxid_friend", "type": "其他"}, "messages": []}"#;
        let out = parse(doc);
        assert_eq!(out.chat_type, "private");
        assert_eq!(out.group_id, None);
        assert_eq!(out.name, "测试聊天");

        let out2 = parse(r#"{"messages": []}"#);
        assert_eq!(out2.chat_type, "group");
        assert_eq!(out2.name, "测试聊天");
    }

    #[test]
    fn js_trim_matches_javascript() {
        assert_eq!(js_trim("\u{FEFF} hi \u{00A0}"), "hi");
        // U+0085 NEL is NOT trimmed by JS.
        assert_eq!(js_trim("\u{85}x"), "\u{85}x");
        assert_eq!(js_trim("\n\t x \r\n"), "x");
    }

    #[test]
    fn js_string_semantics_for_local_id() {
        let n: Value = serde_json::from_str("3.5").unwrap();
        assert_eq!(js_string(Some(&n)), "3.5");
        assert_eq!(js_string(Some(&Value::Null)), "null");
        assert_eq!(js_string(None), "undefined");
        assert_eq!(js_string(Some(&Value::String("abc".into()))), "abc");
        assert_eq!(js_string(Some(&Value::Bool(true))), "true");
    }
}
