//! Browser Worker binding for the shared Rust parser kernels.
//!
//! Parsing is synchronous because the binding runs inside the dedicated Web
//! Worker. Results remain batched at the JS boundary to avoid creating one
//! large object graph in a single transfer.

use wasm_bindgen::prelude::*;

use crate::input::KernelInput;
use crate::{take_batch_from, FormatKind, ParsedState};

#[wasm_bindgen]
pub struct WasmParser {
    state: ParsedState,
}

#[wasm_bindgen]
impl WasmParser {
    #[wasm_bindgen(constructor)]
    pub fn new(
        format_id: String,
        bytes: &[u8],
        file_name: String,
        options_json: Option<String>,
    ) -> Result<WasmParser, JsValue> {
        let format = FormatKind::from_id(&format_id)
            .ok_or_else(|| js_error(format!("unknown WASM format id: {format_id}")))?;
        let input = KernelInput {
            primary_path: file_name,
            options_json,
        };
        let output = format
            .run(bytes, &input, &mut |_, _| {})
            .map_err(|error| js_error(format!("parse failed: {error}")))?;

        Ok(WasmParser {
            state: ParsedState {
                message_total: output.messages.len(),
                member_total: output.members.len(),
                output,
                cursor: 0,
            },
        })
    }

    pub fn meta_json(&self) -> String {
        self.state.output.meta_json.clone()
    }

    pub fn take_members_json(&mut self) -> Result<String, JsValue> {
        serialize(&std::mem::take(&mut self.state.output.members), "members")
    }

    pub fn take_batch_json(&mut self, size: u32) -> Result<Option<String>, JsValue> {
        take_batch_from(&mut self.state, size)
            .map(|batch| serialize(&batch, "message batch"))
            .transpose()
    }

    pub fn summary_json(&self) -> String {
        format!(
            "{{\"messageCount\":{},\"memberCount\":{}}}",
            self.state.message_total, self.state.member_total
        )
    }
}

fn serialize<T: serde::Serialize>(value: &T, label: &str) -> Result<String, JsValue> {
    serde_json::to_string(value)
        .map_err(|error| js_error(format!("failed to serialize {label}: {error}")))
}

fn js_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    #[test]
    fn exposes_chatlab_results_in_bounded_json_batches() {
        let doc = br#"{
          "chatlab": {"version": "1"},
          "meta": {"name": "Browser", "platform": "wechat", "type": "group"},
          "members": [{"platformId": "alice", "accountName": "Alice"}],
          "messages": [
            {"sender": "alice", "accountName": "Alice", "timestamp": 1, "type": 0, "content": "one"},
            {"sender": "alice", "accountName": "Alice", "timestamp": 2, "type": 0, "content": "two"}
          ]
        }"#;
        let mut parser =
            WasmParser::new("chatlab".to_string(), doc, "browser.json".to_string(), None)
                .expect("WASM parser should accept a valid ChatLab export");

        let meta: Value =
            serde_json::from_str(&parser.meta_json()).expect("meta JSON should be valid");
        assert_eq!(meta["name"], "Browser");

        let members: Value = serde_json::from_str(
            &parser
                .take_members_json()
                .expect("members should serialize"),
        )
        .expect("members JSON should be valid");
        assert_eq!(members[0]["platformId"], "alice");

        let first: Value = serde_json::from_str(
            &parser
                .take_batch_json(1)
                .expect("batch should serialize")
                .expect("first batch should exist"),
        )
        .expect("batch JSON should be valid");
        assert_eq!(first[0]["content"], "one");
        assert!(parser
            .take_batch_json(10)
            .expect("batch should serialize")
            .is_some());
        assert!(parser
            .take_batch_json(10)
            .expect("empty batch should succeed")
            .is_none());
        assert_eq!(
            parser.summary_json(),
            r#"{"messageCount":2,"memberCount":1}"#
        );
    }
}
