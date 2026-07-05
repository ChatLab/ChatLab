//! Unified kernel output protocol shared by every format kernel.
//!
//! Members and messages use one superset struct each (fields the format does
//! not produce stay `None`); the format-specific meta travels as a JSON string
//! so adding formats never changes the N-API surface.

use napi_derive::napi;

#[napi(object)]
pub struct NativeParseProgress {
    pub bytes_read: f64,
    pub total_bytes: f64,
    pub messages_processed: f64,
}

#[napi(object)]
pub struct NativeMemberRole {
    pub id: String,
    /// Present only when the source role object had a `name` key.
    pub name: Option<String>,
}

#[napi(object)]
pub struct NativeMember {
    pub platform_id: String,
    pub account_name: String,
    pub group_nickname: Option<String>,
    pub avatar: Option<String>,
    pub roles: Option<Vec<NativeMemberRole>>,
}

#[napi(object)]
#[derive(Default)]
pub struct NativeMessage {
    pub platform_message_id: Option<String>,
    pub sender_platform_id: String,
    pub sender_account_name: String,
    pub sender_group_nickname: Option<String>,
    /// None when the source timestamp was JSON null (importer skips those).
    pub timestamp: Option<f64>,
    /// Numeric MessageType enum value from shared-types.
    pub message_type: u32,
    pub content: Option<String>,
    pub reply_to_message_id: Option<String>,
}

/// What a format kernel returns: meta as format-specific JSON plus unified
/// member/message structs, pumped to JS through the shared `NativeParser`.
pub struct KernelOutput {
    pub meta_json: String,
    pub members: Vec<NativeMember>,
    pub messages: Vec<NativeMessage>,
}
