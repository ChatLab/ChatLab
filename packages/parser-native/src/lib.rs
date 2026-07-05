#![deny(clippy::all)]

mod chatlab;
mod input;
mod jsutil;
mod protocol;
mod scanner;
mod weflow;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use input::KernelInput;
use protocol::{KernelOutput, NativeMember, NativeMessage, NativeParseProgress};

// ==================== Format registry ====================

/// Kernel ids understood by the `NativeParser` constructor. The TS side maps
/// sniffer format ids onto these (e.g. ycccccccy-echotrace reuses "weflow").
#[derive(Clone, Copy)]
enum FormatKind {
    Weflow,
    Chatlab,
}

impl FormatKind {
    fn from_id(id: &str) -> Option<Self> {
        match id {
            "weflow" => Some(FormatKind::Weflow),
            "chatlab" => Some(FormatKind::Chatlab),
            _ => None,
        }
    }

    fn run(
        &self,
        buf: &[u8],
        input: &KernelInput,
        on_progress: &mut dyn FnMut(u64, u64),
    ) -> std::result::Result<KernelOutput, scanner::ScanError> {
        match self {
            FormatKind::Weflow => weflow::parse_weflow(buf, input, on_progress),
            FormatKind::Chatlab => chatlab::parse_chatlab(buf, input, on_progress),
        }
    }
}

// ==================== Shared parser state ====================

struct ParsedState {
    output: KernelOutput,
    cursor: usize,
    /// Totals captured at parse completion; `take_*` drains the vectors, so
    /// `summary_json()` reports from these instead.
    message_total: usize,
    member_total: usize,
}

struct Shared {
    bytes_read: AtomicU64,
    total_bytes: AtomicU64,
    messages_processed: AtomicU64,
    parsed: Mutex<Option<ParsedState>>,
}

impl Shared {
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

    fn lock_parsed(&self) -> Result<MutexGuard<'_, Option<ParsedState>>> {
        self.parsed
            .lock()
            .map_err(|_| Error::from_reason("parser state poisoned"))
    }

    /// Run a format kernel on the primary file, tracking progress atomics.
    fn run_parse(&self, format: FormatKind, input: &KernelInput) -> Result<()> {
        let buf = input
            .read_primary()
            .map_err(|err| Error::from_reason(format!("failed to read file: {err}")))?;
        self.total_bytes.store(buf.len() as u64, Ordering::Relaxed);

        let mut on_progress = |bytes: u64, messages: u64| {
            self.bytes_read.store(bytes, Ordering::Relaxed);
            self.messages_processed.store(messages, Ordering::Relaxed);
        };
        let output = format
            .run(&buf, input, &mut on_progress)
            .map_err(|err| Error::from_reason(format!("parse failed: {err}")))?;

        self.bytes_read.store(buf.len() as u64, Ordering::Relaxed);
        let mut parsed = self.lock_parsed()?;
        *parsed = Some(ParsedState {
            message_total: output.messages.len(),
            member_total: output.members.len(),
            output,
            cursor: 0,
        });
        Ok(())
    }
}

/// Take the next `size` messages, advancing the cursor; None when exhausted.
fn take_batch_from(state: &mut ParsedState, size: u32) -> Option<Vec<NativeMessage>> {
    let cursor = state.cursor;
    let total = state.output.messages.len();
    if cursor >= total {
        return None;
    }
    let end = (cursor + size.max(1) as usize).min(total);
    let mut batch = Vec::with_capacity(end - cursor);
    for message in &mut state.output.messages[cursor..end] {
        batch.push(std::mem::take(message));
    }
    state.cursor = end;
    Some(batch)
}

// ==================== N-API surface ====================

pub struct ParseFormatTask {
    format: FormatKind,
    input: KernelInput,
    shared: Arc<Shared>,
}

impl Task for ParseFormatTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.shared.run_parse(self.format, &self.input)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Unified Rust parser for all native-first formats. Usage from JS:
/// `parse()` → `metaJson()` → `takeMembers()` → `takeBatch()` until null →
/// `summaryJson()`. Constructing with an unknown format id throws, which the
/// TS wrapper treats like any other native failure (falls back to TS).
#[napi]
pub struct NativeParser {
    format: FormatKind,
    input: KernelInput,
    shared: Arc<Shared>,
}

#[napi]
impl NativeParser {
    #[napi(constructor)]
    pub fn new(format_id: String, file_path: String, options_json: Option<String>) -> Result<Self> {
        let format = FormatKind::from_id(&format_id)
            .ok_or_else(|| Error::from_reason(format!("unknown native format id: {format_id}")))?;
        Ok(NativeParser {
            format,
            input: KernelInput {
                primary_path: file_path,
                options_json,
            },
            shared: Shared::new(),
        })
    }

    /// Run the full parse on the libuv thread pool.
    #[napi]
    pub fn parse(&self) -> AsyncTask<ParseFormatTask> {
        AsyncTask::new(ParseFormatTask {
            format: self.format,
            input: self.input.clone(),
            shared: Arc::clone(&self.shared),
        })
    }

    /// Poll progress while `parse()` is pending.
    #[napi]
    pub fn progress(&self) -> NativeParseProgress {
        self.shared.progress()
    }

    /// Format-specific meta as a JSON string (shape documented per kernel).
    #[napi]
    pub fn meta_json(&self) -> Result<String> {
        let parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_ref()
            .ok_or_else(|| Error::from_reason("metaJson() called before parse() completed"))?;
        Ok(state.output.meta_json.clone())
    }

    /// Move members out to JS. Callable once.
    #[napi]
    pub fn take_members(&self) -> Result<Vec<NativeMember>> {
        let mut parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_mut()
            .ok_or_else(|| Error::from_reason("takeMembers() called before parse() completed"))?;
        Ok(std::mem::take(&mut state.output.members))
    }

    /// Move the next batch of messages out to JS; null when exhausted.
    #[napi]
    pub fn take_batch(&self, size: u32) -> Result<Option<Vec<NativeMessage>>> {
        let mut parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_mut()
            .ok_or_else(|| Error::from_reason("takeBatch() called before parse() completed"))?;
        Ok(take_batch_from(state, size))
    }

    /// Post-parse totals as JSON: `{"messageCount":n,"memberCount":n}`.
    /// Valid any time after `parse()`, even once the vectors are drained.
    #[napi]
    pub fn summary_json(&self) -> Result<String> {
        let parsed = self.shared.lock_parsed()?;
        let state = parsed
            .as_ref()
            .ok_or_else(|| Error::from_reason("summaryJson() called before parse() completed"))?;
        Ok(format!(
            "{{\"messageCount\":{},\"memberCount\":{}}}",
            state.message_total, state.member_total
        ))
    }
}
