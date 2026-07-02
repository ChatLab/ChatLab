#![deny(clippy::all)]

mod chatlab;
mod jsutil;
mod scanner;
mod weflow;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use chatlab::ChatlabOutput;
use weflow::{MessageOut, WeflowOutput};

#[napi(object)]
pub struct NativeParseProgress {
    pub bytes_read: f64,
    pub total_bytes: f64,
    pub messages_processed: f64,
}

// ==================== Shared parser state ====================

struct ParsedState<T> {
    output: T,
    cursor: usize,
}

struct Shared<T> {
    bytes_read: AtomicU64,
    total_bytes: AtomicU64,
    messages_processed: AtomicU64,
    parsed: Mutex<Option<ParsedState<T>>>,
}

impl<T> Shared<T> {
    fn new() -> Arc<Self> {
        Arc::new(Shared {
            bytes_read: AtomicU64::new(0),
            total_bytes: AtomicU64::new(0),
            messages_processed: AtomicU64::new(0),
            parsed: Mutex::new(None),
        })
    }

    fn progress(&self) -> NativeParseProgress {
        NativeParseProgress {
            bytes_read: self.bytes_read.load(Ordering::Relaxed) as f64,
            total_bytes: self.total_bytes.load(Ordering::Relaxed) as f64,
            messages_processed: self.messages_processed.load(Ordering::Relaxed) as f64,
        }
    }

    fn lock_parsed(&self) -> Result<MutexGuard<'_, Option<ParsedState<T>>>> {
        self.parsed
            .lock()
            .map_err(|_| Error::from_reason("parser state poisoned"))
    }

    /// Run a format kernel on the file, tracking progress atomics.
    fn run_parse(
        &self,
        file_path: &str,
        kernel: impl Fn(
            &[u8],
            &str,
            &mut dyn FnMut(u64, u64),
        ) -> std::result::Result<T, scanner::ScanError>,
    ) -> Result<()> {
        let buf = std::fs::read(file_path)
            .map_err(|err| Error::from_reason(format!("failed to read file: {err}")))?;
        self.total_bytes.store(buf.len() as u64, Ordering::Relaxed);

        let mut on_progress = |bytes: u64, messages: u64| {
            self.bytes_read.store(bytes, Ordering::Relaxed);
            self.messages_processed.store(messages, Ordering::Relaxed);
        };
        let output = kernel(&buf, file_path, &mut on_progress)
            .map_err(|err| Error::from_reason(format!("parse failed: {err}")))?;

        self.bytes_read.store(buf.len() as u64, Ordering::Relaxed);
        let mut parsed = self.lock_parsed()?;
        *parsed = Some(ParsedState { output, cursor: 0 });
        Ok(())
    }
}

/// Take the next `size` messages out of `messages`, advancing `cursor`.
fn take_batch_from<M: Default, O>(
    state: &mut ParsedState<O>,
    messages_of: impl Fn(&mut O) -> &mut Vec<M>,
    size: u32,
    map: impl Fn(M) -> M,
) -> Option<Vec<M>> {
    let cursor = state.cursor;
    let messages = messages_of(&mut state.output);
    let total = messages.len();
    if cursor >= total {
        return None;
    }
    let end = (cursor + size.max(1) as usize).min(total);
    let mut batch = Vec::with_capacity(end - cursor);
    for message in &mut messages[cursor..end] {
        batch.push(map(std::mem::take(message)));
    }
    state.cursor = end;
    Some(batch)
}

// ==================== WeFlow ====================

#[napi(object)]
pub struct NativeWeflowMeta {
    pub name: String,
    /// "group" | "private" (ChatType enum string values)
    pub chat_type: String,
    pub group_id: Option<String>,
    pub group_avatar: Option<String>,
    pub owner_id: Option<String>,
    pub message_count: f64,
    pub member_count: f64,
}

#[napi(object)]
pub struct NativeParsedMember {
    pub platform_id: String,
    pub account_name: String,
    pub avatar: Option<String>,
}

#[napi(object)]
pub struct NativeParsedMessage {
    pub platform_message_id: String,
    pub sender_platform_id: String,
    pub sender_account_name: String,
    /// null when the source `createTime` was JSON null (importer skips those).
    pub timestamp: Option<f64>,
    /// Numeric MessageType enum value from shared-types.
    pub message_type: u32,
    pub content: Option<String>,
}

pub struct ParseWeflowTask {
    file_path: String,
    shared: Arc<Shared<WeflowOutput>>,
}

impl Task for ParseWeflowTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.shared
            .run_parse(&self.file_path, |buf, path, on_progress| {
                weflow::parse_weflow(buf, path, on_progress)
            })
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Rust WeFlow parser. Usage from JS:
/// `parse()` → `getMeta()` → `takeMembers()` → `takeBatch()` until null.
#[napi]
pub struct WeflowParser {
    file_path: String,
    shared: Arc<Shared<WeflowOutput>>,
}

#[napi]
impl WeflowParser {
    #[napi(constructor)]
    pub fn new(file_path: String) -> Self {
        WeflowParser {
            file_path,
            shared: Shared::new(),
        }
    }

    /// Run the full parse on the libuv thread pool.
    #[napi]
    pub fn parse(&self) -> AsyncTask<ParseWeflowTask> {
        AsyncTask::new(ParseWeflowTask {
            file_path: self.file_path.clone(),
            shared: Arc::clone(&self.shared),
        })
    }

    /// Poll progress while `parse()` is pending.
    #[napi]
    pub fn progress(&self) -> NativeParseProgress {
        self.shared.progress()
    }

    #[napi]
    pub fn get_meta(&self) -> Result<NativeWeflowMeta> {
        let parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_ref()
            .ok_or_else(|| Error::from_reason("getMeta() called before parse() completed"))?;
        Ok(NativeWeflowMeta {
            name: state.output.name.clone(),
            chat_type: state.output.chat_type.to_string(),
            group_id: state.output.group_id.clone(),
            group_avatar: state.output.group_avatar.clone(),
            owner_id: state.output.owner_id.clone(),
            message_count: state.output.messages.len() as f64,
            member_count: state.output.members.len() as f64,
        })
    }

    /// Move members (with avatars) out to JS. Callable once.
    #[napi]
    pub fn take_members(&self) -> Result<Vec<NativeParsedMember>> {
        let mut parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_mut()
            .ok_or_else(|| Error::from_reason("takeMembers() called before parse() completed"))?;
        Ok(std::mem::take(&mut state.output.members)
            .into_iter()
            .map(|m| NativeParsedMember {
                platform_id: m.platform_id,
                account_name: m.account_name,
                avatar: m.avatar,
            })
            .collect())
    }

    /// Move the next batch of messages out to JS; null when exhausted.
    #[napi]
    pub fn take_batch(&self, size: u32) -> Result<Option<Vec<NativeParsedMessage>>> {
        let mut parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_mut()
            .ok_or_else(|| Error::from_reason("takeBatch() called before parse() completed"))?;
        Ok(
            take_batch_from(state, |o| &mut o.messages, size, |message| message).map(|batch| {
                batch
                    .into_iter()
                    .map(|message| {
                        let MessageOut {
                            platform_message_id,
                            sender_platform_id,
                            sender_account_name,
                            timestamp,
                            message_type,
                            content,
                        } = message;
                        NativeParsedMessage {
                            platform_message_id,
                            sender_platform_id,
                            sender_account_name,
                            timestamp,
                            message_type,
                            content,
                        }
                    })
                    .collect()
            }),
        )
    }
}

// ==================== ChatLab JSON ====================

#[napi(object)]
pub struct NativeChatlabMeta {
    pub name: String,
    /// Passthrough of `meta.type` ("group" when missing), matching the TS parser.
    pub chat_type: String,
    /// Passthrough of `meta.platform` ("unknown" when missing).
    pub platform: String,
    pub group_id: Option<String>,
    pub group_avatar: Option<String>,
    /// true when members came from the top-level `members` array;
    /// false when collected from messages (TS emits different object shapes).
    pub members_from_head: bool,
    pub message_count: f64,
    pub member_count: f64,
}

#[napi(object)]
pub struct NativeMemberRole {
    pub id: String,
    /// Present only when the source role object had a `name` key.
    pub name: Option<String>,
}

#[napi(object)]
pub struct NativeChatlabMember {
    pub platform_id: String,
    pub account_name: String,
    pub group_nickname: Option<String>,
    pub avatar: Option<String>,
    pub roles: Option<Vec<NativeMemberRole>>,
}

#[napi(object)]
#[derive(Default)]
pub struct NativeChatlabMessage {
    pub platform_message_id: Option<String>,
    pub sender_platform_id: String,
    pub sender_account_name: String,
    pub sender_group_nickname: Option<String>,
    pub timestamp: f64,
    /// Numeric MessageType enum value from shared-types.
    pub message_type: u32,
    /// undefined here means the source `content` was JSON null.
    pub content: Option<String>,
    pub reply_to_message_id: Option<String>,
}

pub struct ParseChatlabTask {
    file_path: String,
    shared: Arc<Shared<ChatlabOutput>>,
}

impl Task for ParseChatlabTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.shared
            .run_parse(&self.file_path, |buf, path, on_progress| {
                chatlab::parse_chatlab(buf, path, on_progress)
            })
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Rust ChatLab JSON parser. Strict about the format spec: off-spec files
/// error out and the JS side falls back to the pure-TS parser.
/// Usage from JS: `parse()` → `getMeta()` → `takeMembers()` → `takeBatch()` until null.
#[napi]
pub struct ChatlabParser {
    file_path: String,
    shared: Arc<Shared<ChatlabOutput>>,
}

#[napi]
impl ChatlabParser {
    #[napi(constructor)]
    pub fn new(file_path: String) -> Self {
        ChatlabParser {
            file_path,
            shared: Shared::new(),
        }
    }

    /// Run the full parse on the libuv thread pool.
    #[napi]
    pub fn parse(&self) -> AsyncTask<ParseChatlabTask> {
        AsyncTask::new(ParseChatlabTask {
            file_path: self.file_path.clone(),
            shared: Arc::clone(&self.shared),
        })
    }

    /// Poll progress while `parse()` is pending.
    #[napi]
    pub fn progress(&self) -> NativeParseProgress {
        self.shared.progress()
    }

    #[napi]
    pub fn get_meta(&self) -> Result<NativeChatlabMeta> {
        let parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_ref()
            .ok_or_else(|| Error::from_reason("getMeta() called before parse() completed"))?;
        Ok(NativeChatlabMeta {
            name: state.output.name.clone(),
            chat_type: state.output.chat_type.clone(),
            platform: state.output.platform.clone(),
            group_id: state.output.group_id.clone(),
            group_avatar: state.output.group_avatar.clone(),
            members_from_head: state.output.members_from_head,
            message_count: state.output.messages.len() as f64,
            member_count: state.output.members.len() as f64,
        })
    }

    /// Move members out to JS. Callable once.
    #[napi]
    pub fn take_members(&self) -> Result<Vec<NativeChatlabMember>> {
        let mut parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_mut()
            .ok_or_else(|| Error::from_reason("takeMembers() called before parse() completed"))?;
        Ok(std::mem::take(&mut state.output.members)
            .into_iter()
            .map(|m| NativeChatlabMember {
                platform_id: m.platform_id,
                account_name: m.account_name,
                group_nickname: m.group_nickname,
                avatar: m.avatar,
                roles: m.roles.map(|roles| {
                    roles
                        .into_iter()
                        .map(|r| NativeMemberRole {
                            id: r.id,
                            name: r.name,
                        })
                        .collect()
                }),
            })
            .collect())
    }

    /// Move the next batch of messages out to JS; null when exhausted.
    #[napi]
    pub fn take_batch(&self, size: u32) -> Result<Option<Vec<NativeChatlabMessage>>> {
        let mut parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_mut()
            .ok_or_else(|| Error::from_reason("takeBatch() called before parse() completed"))?;
        Ok(
            take_batch_from(state, |o| &mut o.messages, size, |m| m).map(|batch| {
                batch
                    .into_iter()
                    .map(|message| NativeChatlabMessage {
                        platform_message_id: message.platform_message_id,
                        sender_platform_id: message.sender_platform_id,
                        sender_account_name: message.sender_account_name,
                        sender_group_nickname: message.sender_group_nickname,
                        timestamp: message.timestamp,
                        message_type: message.message_type,
                        content: message.content,
                        reply_to_message_id: message.reply_to_message_id,
                    })
                    .collect()
            }),
        )
    }
}
