//! ChatLab JSON format kernel.
//!
//! Mirrors `packages/parser/src/formats/chatlab.ts` for spec-compliant files.
//! Contract: this kernel is strict — any field that deviates from the ChatLab
//! format spec (wrong type, unexpected null) returns an error, and the TS
//! wrapper falls back to the pure-TS parser which replicates all passthrough
//! quirks. Meta and members are parsed structurally while preserving the same
//! output contract as the TS parser.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::input::KernelInput;
use crate::jsutil::{extract_name_from_file_path, non_empty_str};
use crate::protocol::{KernelOutput, NativeMember, NativeMemberRole, NativeMessage};
use crate::scanner::{for_each_array_element, walk_top_level, ScanError, ScanResult};

/// Shape of `metaJson()` for the chatlab kernel (consumed by the TS adapter).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatlabMeta {
    name: String,
    /// Passthrough of `meta.type` ("group" when missing/empty), like the TS parser.
    chat_type: String,
    /// Passthrough of `meta.platform` ("unknown" when missing/empty).
    platform: String,
    group_id: Option<String>,
    group_avatar: Option<String>,
    owner_id: Option<String>,
    /// true: members came from the top-level `members` array (full shape);
    /// false: collected from messages (id/name/nickname only), as in TS.
    members_from_head: bool,
}

fn strict(msg: impl Into<String>) -> ScanError {
    ScanError {
        message: msg.into(),
        offset: 0,
    }
}

/// Required string field (any content, including empty).
fn require_str(obj: &serde_json::Map<String, Value>, key: &str, ctx: &str) -> ScanResult<String> {
    match obj.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        other => Err(strict(format!(
            "{ctx}: field '{key}' must be a string, got {}",
            type_name(other)
        ))),
    }
}

/// Optional string field: missing -> None; string -> Some; anything else (incl. null) -> strict error.
fn optional_str(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    ctx: &str,
) -> ScanResult<Option<String>> {
    match obj.get(key) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        other => Err(strict(format!(
            "{ctx}: field '{key}' must be a string when present, got {}",
            type_name(other)
        ))),
    }
}

fn type_name(value: Option<&Value>) -> &'static str {
    match value {
        None => "missing",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

struct MetaOut {
    name: String,
    platform: String,
    chat_type: String,
    group_id: Option<String>,
    group_avatar: Option<String>,
    owner_id: Option<String>,
}

fn parse_meta(meta_raw: Option<&[u8]>, file_path: &str) -> ScanResult<MetaOut> {
    // A missing or non-object meta puts the TS parser on its defaults-only
    // path, which emits a meta object without groupId/groupAvatar keys.
    // Delegate that shape to the TS fallback instead of replicating it.
    let raw = meta_raw.ok_or_else(|| strict("meta object missing"))?;
    let meta: serde_json::Map<String, Value> = match serde_json::from_slice::<Value>(raw) {
        Ok(Value::Object(map)) => map,
        Ok(_) => return Err(strict("meta must be an object")),
        Err(err) => return Err(strict(format!("invalid meta object: {err}"))),
    };

    let mut name = "未知群聊".to_string();
    let mut platform = "unknown".to_string();
    let mut chat_type = "group".to_string();

    // `metaObj.name || '未知群聊'` — non-empty string wins; a non-string
    // truthy name is off-spec, so be strict about it.
    match meta.get("name") {
        None | Some(Value::Null) => {}
        Some(Value::String(s)) => {
            if !s.is_empty() {
                name = s.clone();
            }
        }
        other => {
            return Err(strict(format!(
                "meta.name must be a string, got {}",
                type_name(other)
            )))
        }
    }
    if let Some(p) = non_empty_str(meta.get("platform")) {
        platform = p.to_string();
    } else if !matches!(
        meta.get("platform"),
        None | Some(Value::Null) | Some(Value::String(_))
    ) {
        return Err(strict("meta.platform must be a string"));
    }
    if let Some(t) = non_empty_str(meta.get("type")) {
        chat_type = t.to_string();
    } else if !matches!(
        meta.get("type"),
        None | Some(Value::Null) | Some(Value::String(_))
    ) {
        return Err(strict("meta.type must be a string"));
    }
    let group_id = optional_str(&meta, "groupId", "meta")?;
    let group_avatar = optional_str(&meta, "groupAvatar", "meta")?;
    let owner_id = optional_str(&meta, "ownerId", "meta")?;

    // Filename fallback fires whenever the name resolved to the default,
    // mirroring `if (meta.name === '未知群聊')` in the TS parser.
    if name == "未知群聊" {
        name = extract_name_from_file_path(file_path, "未知群聊");
    }

    Ok(MetaOut {
        name,
        platform,
        chat_type,
        group_id,
        group_avatar,
        owner_id,
    })
}

fn parse_member(element: &[u8]) -> ScanResult<NativeMember> {
    let value: Value =
        serde_json::from_slice(element).map_err(|err| strict(format!("invalid member: {err}")))?;
    let obj = value
        .as_object()
        .ok_or_else(|| strict("member must be an object"))?;

    let aliases = match obj.get("aliases") {
        None => None,
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| strict("member alias must be a string"))
                })
                .collect::<ScanResult<Vec<_>>>()?,
        ),
        other => {
            return Err(strict(format!(
                "member.aliases must be an array when present, got {}",
                type_name(other)
            )))
        }
    };

    let roles = match obj.get("roles") {
        None => None,
        Some(Value::Array(items)) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let role = item
                    .as_object()
                    .ok_or_else(|| strict("member role must be an object"))?;
                // Reject extra keys: the TS parser passes role objects through
                // verbatim, so any shape beyond {id, name} must use the TS path.
                if role.keys().any(|k| k != "id" && k != "name") {
                    return Err(strict("member role has unsupported keys"));
                }
                out.push(NativeMemberRole {
                    id: require_str(role, "id", "member role")?,
                    name: optional_str(role, "name", "member role")?,
                });
            }
            Some(out)
        }
        other => {
            return Err(strict(format!(
                "member.roles must be an array when present, got {}",
                type_name(other)
            )))
        }
    };

    Ok(NativeMember {
        platform_id: require_str(obj, "platformId", "member")?,
        account_name: require_str(obj, "accountName", "member")?,
        group_nickname: optional_str(obj, "groupNickname", "member")?,
        aliases,
        avatar: optional_str(obj, "avatar", "member")?,
        roles,
    })
}

/// Tracks members collected from messages: first-seen order, whole entry
/// replaced on every message from the same sender (JS `Map.set` semantics).
struct CollectedMembers {
    order: Vec<(String, String, Option<String>)>,
    index: HashMap<String, usize>,
}

impl CollectedMembers {
    fn new() -> Self {
        CollectedMembers {
            order: Vec::new(),
            index: HashMap::new(),
        }
    }

    fn observe(&mut self, platform_id: &str, account_name: &str, group_nickname: Option<&String>) {
        match self.index.get(platform_id) {
            Some(&i) => {
                self.order[i].1 = account_name.to_string();
                self.order[i].2 = group_nickname.cloned();
            }
            None => {
                self.index.insert(platform_id.to_string(), self.order.len());
                self.order.push((
                    platform_id.to_string(),
                    account_name.to_string(),
                    group_nickname.cloned(),
                ));
            }
        }
    }
}

pub fn parse_chatlab(
    buf: &[u8],
    input: &KernelInput,
    mut on_progress: impl FnMut(u64, u64),
) -> ScanResult<KernelOutput> {
    let mut meta_raw: Option<&[u8]> = None;
    let mut members_raw: Option<&[u8]> = None;
    let mut messages_raw: Option<&[u8]> = None;

    walk_top_level(buf, |key, raw| {
        match key {
            b"meta" => meta_raw = Some(raw),
            b"members" => members_raw = Some(raw),
            b"messages" => messages_raw = Some(raw),
            _ => {}
        }
        Ok(())
    })?;

    let meta = parse_meta(meta_raw, &input.primary_path)?;

    let mut head_members: Vec<NativeMember> = Vec::new();
    if let Some(raw) = members_raw {
        let base_offset = raw.as_ptr() as usize - buf.as_ptr() as usize;
        for_each_array_element(raw, base_offset, |element, _| {
            head_members.push(parse_member(element)?);
            Ok(())
        })?;
    }
    let members_from_head = !head_members.is_empty();

    let mut collected = CollectedMembers::new();
    let mut messages: Vec<NativeMessage> = Vec::new();

    if let Some(raw) = messages_raw {
        let base_offset = raw.as_ptr() as usize - buf.as_ptr() as usize;
        for_each_array_element(raw, base_offset, |element, end_offset| {
            let value: Value = serde_json::from_slice(element)
                .map_err(|err| strict(format!("invalid message: {err}")))?;
            let obj = value
                .as_object()
                .ok_or_else(|| strict("message must be an object"))?;

            let sender = require_str(obj, "sender", "message")?;
            let account_name = require_str(obj, "accountName", "message")?;
            let group_nickname = optional_str(obj, "groupNickname", "message")?;

            let timestamp = match obj.get("timestamp") {
                Some(Value::Number(n)) => n
                    .as_f64()
                    .ok_or_else(|| strict("message.timestamp out of range"))?,
                other => {
                    return Err(strict(format!(
                        "message.timestamp must be a number, got {}",
                        type_name(other)
                    )))
                }
            };
            let message_type = match obj.get("type") {
                Some(Value::Number(n)) => n
                    .as_u64()
                    .and_then(|v| u32::try_from(v).ok())
                    .ok_or_else(|| strict("message.type must be a non-negative integer"))?,
                other => {
                    return Err(strict(format!(
                        "message.type must be a number, got {}",
                        type_name(other)
                    )))
                }
            };
            let content = match obj.get("content") {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Null) => None,
                other => {
                    return Err(strict(format!(
                        "message.content must be a string or null, got {}",
                        type_name(other)
                    )))
                }
            };

            if !members_from_head {
                collected.observe(&sender, &account_name, group_nickname.as_ref());
            }

            messages.push(NativeMessage {
                platform_message_id: optional_str(obj, "platformMessageId", "message")?,
                sender_platform_id: sender,
                sender_account_name: account_name,
                sender_group_nickname: group_nickname,
                timestamp: Some(timestamp),
                message_type,
                content,
                reply_to_message_id: optional_str(obj, "replyToMessageId", "message")?,
            });

            on_progress(end_offset as u64, messages.len() as u64);
            Ok(())
        })?;
    }

    let members = if members_from_head {
        head_members
    } else {
        collected
            .order
            .into_iter()
            .map(|(platform_id, account_name, group_nickname)| NativeMember {
                platform_id,
                account_name,
                group_nickname,
                aliases: None,
                avatar: None,
                roles: None,
            })
            .collect()
    };

    let meta_json = serde_json::to_string(&ChatlabMeta {
        name: meta.name,
        chat_type: meta.chat_type,
        platform: meta.platform,
        group_id: meta.group_id,
        group_avatar: meta.group_avatar,
        owner_id: meta.owner_id,
        members_from_head,
    })
    .map_err(|err| strict(format!("meta serialization failed: {err}")))?;

    Ok(KernelOutput {
        meta_json,
        members,
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(doc: &str) -> ScanResult<KernelOutput> {
        let input = KernelInput {
            primary_path: "/tmp/示例群.json".to_string(),
            options_json: None,
        };
        parse_chatlab(doc.as_bytes(), &input, |_, _| {})
    }

    fn meta(out: &KernelOutput) -> Value {
        serde_json::from_str(&out.meta_json).expect("meta_json should be valid JSON")
    }

    #[test]
    fn parses_full_document() {
        let doc = r#"{
      "chatlab": {"version": "0.0.2", "exportedAt": 1700000000},
      "meta": {"name": "测试群", "platform": "weixin", "type": "group", "groupId": "g1@chatroom", "groupAvatar": "https://x/y.jpg", "ownerId": "u1"},
      "members": [
        {"platformId": "u1", "accountName": "Alice", "groupNickname": "小A", "aliases": ["Ally"], "avatar": "https://a", "roles": [{"id": "owner"}, {"id": "admin", "name": "管理"}]},
        {"platformId": "u2", "accountName": "Bob"}
      ],
      "messages": [
        {"platformMessageId": "m1", "sender": "u1", "accountName": "Alice", "groupNickname": "小A", "timestamp": 100, "type": 0, "content": "hi"},
        {"platformMessageId": "m2", "sender": "u2", "accountName": "Bob", "timestamp": 101, "type": 25, "content": "reply", "replyToMessageId": "m1"},
        {"sender": "u2", "accountName": "Bob", "timestamp": 102, "type": 1, "content": null}
      ]
    }"#;
        let out = parse(doc).expect("should parse");
        let m = meta(&out);
        assert_eq!(m["name"], "测试群");
        assert_eq!(m["platform"], "weixin");
        assert_eq!(m["chatType"], "group");
        assert_eq!(m["groupId"], "g1@chatroom");
        assert_eq!(m["ownerId"], "u1");
        assert_eq!(m["membersFromHead"], true);
        assert_eq!(out.members.len(), 2);
        assert_eq!(
            out.members[0].aliases.as_ref().unwrap(),
            &["Ally".to_string()]
        );
        let roles = out.members[0].roles.as_ref().unwrap();
        assert_eq!(roles[0].id, "owner");
        assert_eq!(roles[0].name, None);
        assert_eq!(roles[1].name.as_deref(), Some("管理"));
        assert!(out.members[1].roles.is_none());

        assert_eq!(out.messages.len(), 3);
        assert_eq!(out.messages[0].platform_message_id.as_deref(), Some("m1"));
        assert_eq!(out.messages[0].timestamp, Some(100.0));
        assert_eq!(out.messages[1].reply_to_message_id.as_deref(), Some("m1"));
        assert_eq!(out.messages[2].content, None);
        assert_eq!(out.messages[2].platform_message_id, None);
    }

    #[test]
    fn collects_members_from_messages_when_head_absent_or_empty() {
        for members_part in [r#""members": [],"#, ""] {
            let doc = format!(
                r#"{{"chatlab": {{"version": "1"}}, "meta": {{"name": "N"}}, {members_part} "messages": [
          {{"sender": "u1", "accountName": "A1", "groupNickname": "g", "timestamp": 1, "type": 0, "content": "x"}},
          {{"sender": "u1", "accountName": "A2", "timestamp": 2, "type": 0, "content": "y"}},
          {{"sender": "u2", "accountName": "B", "timestamp": 3, "type": 0, "content": "z"}}
        ]}}"#
            );
            let out = parse(&doc).expect("should parse");
            assert_eq!(meta(&out)["membersFromHead"], false);
            assert_eq!(out.members.len(), 2);
            // Whole entry replaced by the later message (JS Map.set semantics):
            // groupNickname reset to None even though the first message had one.
            assert_eq!(out.members[0].account_name, "A2");
            assert_eq!(out.members[0].group_nickname, None);
        }
    }

    #[test]
    fn meta_defaults_and_filename_fallback() {
        let out = parse(r#"{"meta": {}, "messages": []}"#).expect("should parse");
        let m = meta(&out);
        assert_eq!(m["name"], "示例群");
        assert_eq!(m["platform"], "unknown");
        assert_eq!(m["chatType"], "group");
        assert_eq!(m["groupId"], Value::Null);

        // Explicit default name also falls back to the filename.
        let out2 = parse(r#"{"meta": {"name": "未知群聊", "platform": "qq"}, "messages": []}"#)
            .expect("should parse");
        let m2 = meta(&out2);
        assert_eq!(m2["name"], "示例群");
        assert_eq!(m2["platform"], "qq");

        // Missing meta -> strict error (TS emits a differently-shaped default
        // meta object, so that path must go through the fallback).
        assert!(parse(r#"{"chatlab": {"version": "1"}, "messages": []}"#).is_err());
    }

    #[test]
    fn strict_errors_on_off_spec_fields() {
        // These must all error so the TS fallback (which replicates JS
        // passthrough quirks) handles them instead.
        let cases = [
            r#"{"messages": [{"sender": 5, "accountName": "A", "timestamp": 1, "type": 0, "content": "x"}]}"#,
            r#"{"messages": [{"sender": "u", "accountName": "A", "timestamp": "1", "type": 0, "content": "x"}]}"#,
            r#"{"messages": [{"sender": "u", "accountName": "A", "timestamp": 1, "type": 0.5, "content": "x"}]}"#,
            r#"{"messages": [{"sender": "u", "accountName": "A", "timestamp": 1, "type": 0, "content": 42}]}"#,
            r#"{"messages": [{"sender": "u", "accountName": "A", "timestamp": 1, "type": 0}]}"#,
            r#"{"messages": [{"sender": "u", "accountName": "A", "timestamp": 1, "type": 0, "content": "x", "platformMessageId": 7}]}"#,
            r#"{"members": [{"platformId": "u", "accountName": "A", "roles": [{"id": "owner", "extra": 1}]}], "messages": []}"#,
            r#"{"members": [{"platformId": "u"}], "messages": []}"#,
            r#"{"meta": {"name": 42}, "messages": []}"#,
            r#"{"meta": {"groupId": null}, "messages": []}"#,
        ];
        for doc in cases {
            assert!(parse(doc).is_err(), "expected strict error for: {doc}");
        }
    }

    #[test]
    fn empty_strings_pass_through() {
        let doc = r#"{"meta": {"name": "", "type": "", "groupId": ""}, "messages": [
      {"sender": "", "accountName": "", "timestamp": 1, "type": 0, "content": ""}
    ]}"#;
        let out = parse(doc).expect("should parse");
        let m = meta(&out);
        // Empty name is falsy -> default -> filename fallback; empty type -> group.
        assert_eq!(m["name"], "示例群");
        assert_eq!(m["chatType"], "group");
        // groupId passes through verbatim, including empty string.
        assert_eq!(m["groupId"], "");
        assert_eq!(out.messages[0].sender_platform_id, "");
        assert_eq!(out.messages[0].content.as_deref(), Some(""));
    }
}
