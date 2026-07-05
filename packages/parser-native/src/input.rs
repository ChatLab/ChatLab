//! Kernel input abstraction (first iteration).
//!
//! Today a kernel gets one primary file plus the opaque options JSON blob
//! passed to the JS constructor. Multi-file formats (QQ chunked, Google Chat
//! Takeout) will extend this struct with base-dir scoped file access.

use std::io;

#[derive(Clone)]
pub struct KernelInput {
    pub primary_path: String,
    /// Format options from the JS side (e.g. telegram `chatIndex`); no
    /// current kernel consumes it yet, but it is part of the stable N-API
    /// constructor signature.
    #[allow(dead_code)]
    pub options_json: Option<String>,
}

impl KernelInput {
    pub fn read_primary(&self) -> io::Result<Vec<u8>> {
        std::fs::read(&self.primary_path)
    }
}
