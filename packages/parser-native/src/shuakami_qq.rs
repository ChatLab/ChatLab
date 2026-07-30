//! Shared shuakami/qq-chat-exporter message/member mapping used by the
//! single-file and chunked kernels.
//!
//! Keep format-specific sender fields, meta inference and event ordering out
//! of this module. The chunked format intentionally differs in those areas.

use std::collections::HashMap;

use serde::de::DeserializeOwned;

use crate::jsutil::js_trim;
use crate::protocol::{NativeMember, NativeMessage};
use crate::scanner::{for_each_array_element, walk_top_level, ScanError, ScanResult};

const MIN_UNAMBIGUOUS_VALID_TIMESTAMP: f64 = 978_307_200.0; // 2001-01-01T00:00:00Z
const MAX_JS_TIMESTAMP_SECONDS: f64 = 8_640_000_000_000.0;

fn offset_of(root: &[u8], raw: &[u8]) -> usize {
    (raw.as_ptr() as usize).saturating_sub(root.as_ptr() as usize)
}

fn error_at(root: &[u8], raw: &[u8], message: impl Into<String>) -> ScanError {
    ScanError {
        message: message.into(),
        offset: offset_of(root, raw),
    }
}

fn reject_escaped_key(root: &[u8], key: &[u8]) -> ScanResult<()> {
    if key.contains(&b'\\') {
        return Err(error_at(
            root,
            key,
            "escaped JSON object key; falling back to TS parser",
        ));
    }
    Ok(())
}

fn decode<T: DeserializeOwned>(root: &[u8], raw: &[u8], field: &str) -> ScanResult<T> {
    serde_json::from_slice(raw)
        .map_err(|error| error_at(root, raw, format!("invalid {field}: {error}")))
}

fn optional_string(root: &[u8], raw: Option<&[u8]>, field: &str) -> ScanResult<Option<String>> {
    match raw {
        None | Some(b"null") => Ok(None),
        Some(raw) => decode::<String>(root, raw, field).map(Some),
    }
}

fn optional_output_string(
    root: &[u8],
    raw: Option<&[u8]>,
    field: &str,
) -> ScanResult<Option<String>> {
    match raw {
        None => Ok(None),
        // An explicit null survives the TS adapter as null, while the unified
        // native protocol represents absence as undefined. Fall back instead
        // of silently changing this off-spec shape.
        Some(raw @ b"null") => Err(error_at(
            root,
            raw,
            format!("unsupported null {field}; falling back to TS parser"),
        )),
        Some(raw) => decode::<String>(root, raw, field).map(Some),
    }
}

fn optional_bool(root: &[u8], raw: Option<&[u8]>, field: &str) -> ScanResult<Option<bool>> {
    match raw {
        None | Some(b"null") => Ok(None),
        Some(raw) => decode::<bool>(root, raw, field).map(Some),
    }
}

fn optional_number(root: &[u8], raw: Option<&[u8]>, field: &str) -> ScanResult<Option<f64>> {
    match raw {
        None | Some(b"null") => Ok(None),
        Some(raw) => decode::<f64>(root, raw, field).map(Some),
    }
}

#[derive(Default)]
struct SenderFields<'a> {
    uin: Option<&'a [u8]>,
    uid: Option<&'a [u8]>,
    name: Option<&'a [u8]>,
}

fn parse_sender<'a>(root: &[u8], raw: &'a [u8]) -> ScanResult<SenderFields<'a>> {
    let mut fields = SenderFields::default();
    walk_top_level(raw, |key, value| {
        reject_escaped_key(root, key)?;
        match key {
            b"uin" => fields.uin = Some(value),
            b"uid" => fields.uid = Some(value),
            b"name" => fields.name = Some(value),
            _ => {}
        }
        Ok(())
    })
    .map_err(|error| error_at(root, raw, format!("invalid sender: {error}")))?;
    Ok(fields)
}

#[derive(Default)]
struct RawMessageFields<'a> {
    sender_uin: Option<&'a [u8]>,
    sender_uid: Option<&'a [u8]>,
    send_nickname: Option<&'a [u8]>,
    send_member_name: Option<&'a [u8]>,
}

fn parse_raw_message<'a>(root: &[u8], raw: Option<&'a [u8]>) -> ScanResult<RawMessageFields<'a>> {
    let Some(raw) = raw else {
        return Ok(RawMessageFields::default());
    };
    if raw == b"null" {
        return Ok(RawMessageFields::default());
    }

    let mut fields = RawMessageFields::default();
    walk_top_level(raw, |key, value| {
        reject_escaped_key(root, key)?;
        match key {
            b"senderUin" => fields.sender_uin = Some(value),
            b"senderUid" => fields.sender_uid = Some(value),
            b"sendNickName" => fields.send_nickname = Some(value),
            b"sendMemberName" => fields.send_member_name = Some(value),
            _ => {}
        }
        Ok(())
    })
    .map_err(|error| error_at(root, raw, format!("invalid rawMessage: {error}")))?;
    Ok(fields)
}

#[derive(Default)]
struct ContentFields<'a> {
    text: Option<&'a [u8]>,
    resources: Option<&'a [u8]>,
    emojis: Option<&'a [u8]>,
    reply: Option<&'a [u8]>,
}

struct ParsedContent {
    text: String,
    first_resource_type: Option<String>,
    has_emojis: bool,
    reply_to_message_id: Option<String>,
}

fn parse_first_resource_type(root: &[u8], raw: Option<&[u8]>) -> ScanResult<Option<String>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw == b"null" {
        return Ok(None);
    }

    let mut first_type = None;
    let mut is_first = true;
    for_each_array_element(raw, offset_of(root, raw), |element, _| {
        if is_first {
            is_first = false;
            let mut type_raw = None;
            walk_top_level(element, |key, value| {
                reject_escaped_key(root, key)?;
                if key == b"type" {
                    type_raw = Some(value);
                }
                Ok(())
            })
            .map_err(|error| {
                error_at(
                    root,
                    element,
                    format!("invalid first content.resources item: {error}"),
                )
            })?;
            first_type = optional_string(root, type_raw, "content.resources[0].type")?;
        }
        Ok(())
    })
    .map_err(|error| error_at(root, raw, format!("invalid content.resources: {error}")))?;
    Ok(first_type)
}

fn parse_has_emojis(root: &[u8], raw: Option<&[u8]>) -> ScanResult<bool> {
    let Some(raw) = raw else {
        return Ok(false);
    };
    if raw == b"null" {
        return Ok(false);
    }

    let mut has_emojis = false;
    for_each_array_element(raw, offset_of(root, raw), |_, _| {
        has_emojis = true;
        Ok(())
    })
    .map_err(|error| error_at(root, raw, format!("invalid content.emojis: {error}")))?;
    Ok(has_emojis)
}

fn parse_reply(root: &[u8], raw: Option<&[u8]>) -> ScanResult<Option<String>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw == b"null" {
        return Ok(None);
    }

    let mut referenced_message_id = None;
    walk_top_level(raw, |key, value| {
        reject_escaped_key(root, key)?;
        if key == b"referencedMessageId" {
            referenced_message_id = Some(value);
        }
        Ok(())
    })
    .map_err(|error| error_at(root, raw, format!("invalid content.reply: {error}")))?;
    optional_output_string(
        root,
        referenced_message_id,
        "content.reply.referencedMessageId",
    )
}

fn parse_content(root: &[u8], raw: &[u8]) -> ScanResult<ParsedContent> {
    let mut fields = ContentFields::default();
    walk_top_level(raw, |key, value| {
        reject_escaped_key(root, key)?;
        match key {
            b"text" => fields.text = Some(value),
            b"resources" => fields.resources = Some(value),
            b"emojis" => fields.emojis = Some(value),
            b"reply" => fields.reply = Some(value),
            _ => {}
        }
        Ok(())
    })
    .map_err(|error| error_at(root, raw, format!("invalid content: {error}")))?;

    Ok(ParsedContent {
        text: optional_string(root, fields.text, "content.text")?.unwrap_or_default(),
        first_resource_type: parse_first_resource_type(root, fields.resources)?,
        has_emojis: parse_has_emojis(root, fields.emojis)?,
        reply_to_message_id: parse_reply(root, fields.reply)?,
    })
}

fn parse_fixed_digits(input: &[u8], start: usize, len: usize) -> Option<i64> {
    let bytes = input.get(start..start + len)?;
    if bytes.iter().any(|byte| !byte.is_ascii_digit()) {
        return None;
    }
    bytes.iter().try_fold(0_i64, |value, byte| {
        value.checked_mul(10)?.checked_add(i64::from(byte - b'0'))
    })
}

fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i64, month: i64) -> Option<i64> {
    Some(match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return None,
    })
}

/// Days since 1970-01-01, based on Howard Hinnant's civil-date algorithm.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    } / 400;
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Parse only the RFC3339 subset whose behavior is unambiguous in V8:
/// `YYYY-MM-DDTHH:mm:ss(.fraction)?(Z|+HH:mm|-HH:mm)`.
/// Other Date.parse-compatible spellings deliberately trigger TS fallback.
fn parse_rfc3339_seconds(input: &str) -> Option<(f64, i64)> {
    let bytes = input.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }

    let year = parse_fixed_digits(bytes, 0, 4)?;
    let month = parse_fixed_digits(bytes, 5, 2)?;
    let day = parse_fixed_digits(bytes, 8, 2)?;
    let hour = parse_fixed_digits(bytes, 11, 2)?;
    let minute = parse_fixed_digits(bytes, 14, 2)?;
    let second = parse_fixed_digits(bytes, 17, 2)?;
    if day == 0 || day > days_in_month(year, month)? || hour > 23 || minute > 59 || second > 59 {
        return None;
    }

    let mut cursor = 19;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let fraction_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == fraction_start {
            return None;
        }
    }

    let timezone_offset_seconds = match bytes.get(cursor) {
        Some(b'Z') if cursor + 1 == bytes.len() => 0_i64,
        Some(sign @ (b'+' | b'-'))
            if cursor + 6 == bytes.len() && bytes.get(cursor + 3) == Some(&b':') =>
        {
            let offset_hour = parse_fixed_digits(bytes, cursor + 1, 2)?;
            let offset_minute = parse_fixed_digits(bytes, cursor + 4, 2)?;
            if offset_hour > 23 || offset_minute > 59 {
                return None;
            }
            let offset = offset_hour * 3_600 + offset_minute * 60;
            if *sign == b'+' {
                offset
            } else {
                -offset
            }
        }
        _ => return None,
    };

    let seconds = days_from_civil(year, month, day)
        .checked_mul(86_400)?
        .checked_add(hour * 3_600 + minute * 60 + second)?
        .checked_sub(timezone_offset_seconds)?;
    Some((seconds as f64, year))
}

enum TimestampResult {
    Valid(f64),
    Invalid,
}

fn validate_timestamp_year(root: &[u8], raw: &[u8], seconds: f64) -> ScanResult<TimestampResult> {
    if !seconds.is_finite() || seconds.abs() > MAX_JS_TIMESTAMP_SECONDS {
        return Ok(TimestampResult::Invalid);
    }
    if seconds >= MIN_UNAMBIGUOUS_VALID_TIMESTAMP {
        return Ok(TimestampResult::Valid(seconds));
    }

    // The TS reference uses host-local getFullYear(). Values close to the
    // 2000 boundary cannot be classified without reproducing the host TZ.
    // Let V8 decide instead of silently accepting/rejecting a message.
    if seconds >= 915_148_800.0 {
        return Err(error_at(
            root,
            raw,
            "timestamp near local-year boundary; falling back to TS parser",
        ));
    }
    Ok(TimestampResult::Invalid)
}

fn parse_timestamp(root: &[u8], raw: Option<&[u8]>) -> ScanResult<TimestampResult> {
    let Some(raw) = raw else {
        return Ok(TimestampResult::Invalid);
    };

    if raw.first() == Some(&b'"') {
        let value = decode::<String>(root, raw, "timestamp")?;
        let Some((seconds, year)) = parse_rfc3339_seconds(&value) else {
            return Err(error_at(
                root,
                raw,
                "unsupported timestamp string; falling back to TS parser",
            ));
        };
        if year == 1999 || year == 2000 {
            return Err(error_at(
                root,
                raw,
                "timestamp near local-year boundary; falling back to TS parser",
            ));
        }
        return validate_timestamp_year(root, raw, seconds);
    }

    if matches!(raw.first(), Some(b'-' | b'0'..=b'9')) {
        let milliseconds = decode::<f64>(root, raw, "timestamp")?;
        return validate_timestamp_year(root, raw, (milliseconds / 1_000.0).floor());
    }

    // parseTimestamp() returns null for null/boolean/object/array values.
    Ok(TimestampResult::Invalid)
}

pub(crate) fn is_shuakami_qq_placeholder_sender_id(id: &str) -> bool {
    matches!(id, "0" | "未知")
}

pub(crate) fn is_shuakami_qq_data_image_avatar(avatar: &str) -> bool {
    avatar.starts_with("data:image/")
}

/// Shared shuakami/qq-chat-exporter type precedence. Chunked exports can reuse this by deriving
/// their own emoji signal and passing `None` for the single-file numeric code.
pub(crate) fn map_shuakami_qq_message_type(
    message_type: Option<f64>,
    text: &str,
    first_resource_type: Option<&str>,
    has_emojis: bool,
    recalled: bool,
) -> u32 {
    if recalled {
        return 81; // RECALL
    }

    match first_resource_type {
        Some("image") => return 1,
        Some("video") => return 3,
        Some("voice" | "audio") => return 2,
        Some("file") => return 4,
        Some("location") => return 8,
        _ => {}
    }

    if has_emojis {
        return 5;
    }

    let text = js_trim(text);
    if text.contains("QQ红包") || text.contains("发出了红包") || text == "[红包]" {
        return 20;
    }
    if text.contains("转账") || text == "[转账]" {
        return 21;
    }
    if text.contains("拍了拍") || text.contains("戳了戳") || text == "[拍一拍]" {
        return 22;
    }
    if text.contains("语音通话") || text.contains("视频通话") || text.contains("通话时长")
    {
        return 23;
    }
    if matches!(text, "[分享]" | "[音乐]" | "[小程序]") {
        return 24;
    }
    if matches!(text, "[链接]" | "[卡片消息]") {
        return 7;
    }
    if matches!(text, "[位置]" | "[地理位置]") {
        return 8;
    }
    if matches!(text, "[转发]" | "[聊天记录]") {
        return 26;
    }

    match message_type {
        Some(3.0) => 1,
        Some(7.0) => 3,
        Some(9.0) => 25,
        _ => 0,
    }
}

pub(crate) fn build_shuakami_qq_message_content(text: String, recalled: bool) -> Option<String> {
    let text = if recalled {
        format!("[已撤回] {text}")
    } else {
        text
    };
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[derive(Default)]
struct MessageFields<'a> {
    message_id: Option<&'a [u8]>,
    timestamp: Option<&'a [u8]>,
    sender: Option<&'a [u8]>,
    message_type: Option<&'a [u8]>,
    system: Option<&'a [u8]>,
    is_system_message: Option<&'a [u8]>,
    recalled: Option<&'a [u8]>,
    is_recalled: Option<&'a [u8]>,
    content: Option<&'a [u8]>,
    raw_message: Option<&'a [u8]>,
}

pub(crate) struct ShuakamiQqObservedMessage {
    pub platform_id: String,
    pub account_name: String,
    pub group_nickname: Option<String>,
    pub message: Option<NativeMessage>,
}

/// Parse the single-file exporter's message shape without materializing the
/// heavy html/raw content fields. Unsupported JS-coercion or Date.parse cases
/// fail the kernel so the TypeScript reference can decide them.
pub(crate) fn parse_shuakami_qq_single_file_message(
    root: &[u8],
    element: &[u8],
) -> ScanResult<Option<ShuakamiQqObservedMessage>> {
    let mut fields = MessageFields::default();
    walk_top_level(element, |key, value| {
        reject_escaped_key(root, key)?;
        match key {
            b"messageId" => fields.message_id = Some(value),
            b"timestamp" => fields.timestamp = Some(value),
            b"sender" => fields.sender = Some(value),
            b"messageType" => fields.message_type = Some(value),
            b"system" => fields.system = Some(value),
            b"isSystemMessage" => fields.is_system_message = Some(value),
            b"recalled" => fields.recalled = Some(value),
            b"isRecalled" => fields.is_recalled = Some(value),
            b"content" => fields.content = Some(value),
            b"rawMessage" => fields.raw_message = Some(value),
            _ => {}
        }
        Ok(())
    })
    .map_err(|error| error_at(root, element, format!("invalid message: {error}")))?;

    let sender_raw = fields
        .sender
        .ok_or_else(|| error_at(root, element, "missing sender; falling back to TS parser"))?;
    let sender = parse_sender(root, sender_raw)?;
    let raw_message = parse_raw_message(root, fields.raw_message)?;

    let sender_uin = optional_string(root, sender.uin, "sender.uin")?;
    let sender_uid = optional_string(root, sender.uid, "sender.uid")?;
    let raw_sender_uin = optional_string(root, raw_message.sender_uin, "rawMessage.senderUin")?;
    let raw_sender_uid = optional_string(root, raw_message.sender_uid, "rawMessage.senderUid")?;
    let platform_id = sender_uin
        .filter(|value| !value.is_empty())
        .or_else(|| sender_uid.filter(|value| !value.is_empty()))
        .or_else(|| raw_sender_uin.filter(|value| !value.is_empty()))
        .or_else(|| raw_sender_uid.filter(|value| !value.is_empty()));
    let Some(platform_id) = platform_id else {
        return Ok(None);
    };
    if is_shuakami_qq_placeholder_sender_id(&platform_id) {
        return Ok(None);
    }

    let raw_nickname = optional_string(root, raw_message.send_nickname, "rawMessage.sendNickName")?;
    let sender_name = optional_string(root, sender.name, "sender.name")?;
    let account_name = raw_nickname
        .filter(|value| !value.is_empty())
        .or_else(|| sender_name.filter(|value| !value.is_empty()))
        .unwrap_or_else(|| platform_id.clone());
    let group_nickname = optional_string(
        root,
        raw_message.send_member_name,
        "rawMessage.sendMemberName",
    )?
    .filter(|value| !value.is_empty());

    // Member observation intentionally precedes timestamp validation in the
    // TS parser. Return it even when the message itself is skipped.
    let timestamp = match parse_timestamp(root, fields.timestamp)? {
        TimestampResult::Valid(value) => value,
        TimestampResult::Invalid => {
            return Ok(Some(ShuakamiQqObservedMessage {
                platform_id,
                account_name,
                group_nickname,
                message: None,
            }))
        }
    };

    let content_raw = fields
        .content
        .ok_or_else(|| error_at(root, element, "missing content; falling back to TS parser"))?;
    let content = parse_content(root, content_raw)?;
    let is_system = optional_bool(root, fields.system, "system")?
        .or(optional_bool(
            root,
            fields.is_system_message,
            "isSystemMessage",
        )?)
        .unwrap_or(false);
    let is_recalled = optional_bool(root, fields.recalled, "recalled")?
        .or(optional_bool(root, fields.is_recalled, "isRecalled")?)
        .unwrap_or(false);
    let message_type = if is_system {
        80
    } else {
        map_shuakami_qq_message_type(
            optional_number(root, fields.message_type, "messageType")?,
            &content.text,
            content.first_resource_type.as_deref(),
            content.has_emojis,
            is_recalled,
        )
    };

    let message = NativeMessage {
        platform_message_id: optional_output_string(root, fields.message_id, "messageId")?,
        sender_platform_id: platform_id.clone(),
        sender_account_name: account_name.clone(),
        sender_group_nickname: group_nickname.clone(),
        timestamp: Some(timestamp),
        message_type,
        content: build_shuakami_qq_message_content(content.text, is_recalled),
        reply_to_message_id: content.reply_to_message_id,
    };

    Ok(Some(ShuakamiQqObservedMessage {
        platform_id,
        account_name,
        group_nickname,
        message: Some(message),
    }))
}

pub(crate) struct ShuakamiQqMemberTracker {
    order: Vec<NativeMember>,
    index: HashMap<String, usize>,
}

impl ShuakamiQqMemberTracker {
    pub(crate) fn new() -> Self {
        Self {
            order: Vec::new(),
            index: HashMap::new(),
        }
    }

    pub(crate) fn observe(&mut self, observed: &ShuakamiQqObservedMessage) {
        match self.index.get(&observed.platform_id) {
            Some(&index) => {
                let member = &mut self.order[index];
                member.account_name = observed.account_name.clone();
                if observed.group_nickname.is_some() {
                    member.group_nickname = observed.group_nickname.clone();
                }
            }
            None => {
                self.index
                    .insert(observed.platform_id.clone(), self.order.len());
                self.order.push(NativeMember {
                    platform_id: observed.platform_id.clone(),
                    account_name: observed.account_name.clone(),
                    group_nickname: observed.group_nickname.clone(),
                    aliases: None,
                    avatar: None,
                    roles: None,
                });
            }
        }
    }

    pub(crate) fn apply_avatars(&mut self, avatars: &HashMap<String, String>) {
        for member in &mut self.order {
            if let Some(avatar) = avatars.get(&member.platform_id) {
                member.avatar = Some(avatar.clone());
            }
        }
    }

    pub(crate) fn into_members(self) -> Vec<NativeMember> {
        self.order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_message(doc: &str) -> Option<ShuakamiQqObservedMessage> {
        parse_shuakami_qq_single_file_message(doc.as_bytes(), doc.as_bytes())
            .expect("shuakami/qq-chat-exporter message should parse")
    }

    #[test]
    fn maps_resource_before_emoji_and_text() {
        let doc = r#"{
          "messageId":"m1","timestamp":"2026-07-10T12:00:00.000Z",
          "sender":{"uin":"100","name":"Alice"},"messageType":9,
          "content":{"text":"[红包]","resources":[{"type":"video"}],"emojis":[{}]}
        }"#;
        let Some(observed) = parse_message(doc) else {
            panic!("message should be observed")
        };
        assert_eq!(
            observed
                .message
                .expect("message should be kept")
                .message_type,
            3
        );
    }

    #[test]
    fn current_false_flag_overrides_legacy_true() {
        let doc = r#"{
          "messageId":"m1","timestamp":"2026-07-10T12:00:00Z",
          "sender":{"uin":"100","name":"Alice"},
          "system":false,"isSystemMessage":true,"recalled":false,"isRecalled":true,
          "content":{"text":"hello"}
        }"#;
        let Some(observed) = parse_message(doc) else {
            panic!("message should be observed")
        };
        let message = observed.message.expect("message should be kept");
        assert_eq!(message.message_type, 0);
        assert_eq!(message.content.as_deref(), Some("hello"));
    }

    #[test]
    fn invalid_timestamp_still_observes_member() {
        let doc = r#"{
          "timestamp":1000,"sender":{"uin":"100","name":"Alice"},
          "rawMessage":{"sendNickName":"Alice latest","sendMemberName":"群名片"},
          "content":{"text":"old"}
        }"#;
        let Some(observed) = parse_message(doc) else {
            panic!("valid sender should be observed")
        };
        assert!(observed.message.is_none());
        assert_eq!(observed.account_name, "Alice latest");
        assert_eq!(observed.group_nickname.as_deref(), Some("群名片"));
    }

    #[test]
    fn unsupported_date_parse_spelling_requires_fallback() {
        let doc = r#"{
          "timestamp":"2026-07-10 12:00:00","sender":{"uin":"100","name":"Alice"},
          "content":{"text":"hello"}
        }"#;
        let error = parse_shuakami_qq_single_file_message(doc.as_bytes(), doc.as_bytes())
            .err()
            .expect("non-RFC3339 date should fail the kernel");
        assert!(error.message.contains("unsupported timestamp string"));
    }
}
