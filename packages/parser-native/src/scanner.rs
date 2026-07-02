//! Shared byte-level JSON scanning utilities.
//!
//! This is the format-agnostic "common layer": a structural scanner over a
//! UTF-8 JSON buffer that can locate top-level object keys and hand out raw
//! value spans without building a DOM for the whole file. Format kernels
//! (e.g. WeFlow) drive it and decide which spans to materialize with
//! serde_json.

use memchr::memchr2;

#[derive(Debug)]
pub struct ScanError {
    pub message: String,
    pub offset: usize,
}

impl ScanError {
    fn new(message: impl Into<String>, offset: usize) -> Self {
        ScanError {
            message: message.into(),
            offset,
        }
    }
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (byte offset {})", self.message, self.offset)
    }
}

impl std::error::Error for ScanError {}

pub type ScanResult<T> = Result<T, ScanError>;

pub struct JsonScanner<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> JsonScanner<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        let mut pos = 0;
        // Skip UTF-8 BOM if present.
        if buf.len() >= 3 && &buf[0..3] == b"\xEF\xBB\xBF" {
            pos = 3;
        }
        JsonScanner { buf, pos }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    pub fn skip_ws(&mut self) {
        while self.pos < self.buf.len() {
            match self.buf[self.pos] {
                b' ' | b'\t' | b'\n' | b'\r' => self.pos += 1,
                _ => break,
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.buf.get(self.pos).copied()
    }

    fn peek_is(&self, byte: u8) -> bool {
        self.peek() == Some(byte)
    }

    pub fn expect(&mut self, byte: u8) -> ScanResult<()> {
        match self.peek() {
            Some(b) if b == byte => {
                self.pos += 1;
                Ok(())
            }
            Some(b) => Err(ScanError::new(
                format!("expected '{}' but found '{}'", byte as char, b as char),
                self.pos,
            )),
            None => Err(ScanError::new(
                format!("expected '{}' but reached end of input", byte as char),
                self.pos,
            )),
        }
    }

    pub fn consume(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    /// Scan a JSON string starting at the opening quote.
    /// Returns the raw bytes between the quotes (escapes untouched).
    pub fn scan_string(&mut self) -> ScanResult<&'a [u8]> {
        self.expect(b'"')?;
        let start = self.pos;
        loop {
            match memchr2(b'"', b'\\', &self.buf[self.pos..]) {
                Some(offset) => {
                    let at = self.pos + offset;
                    if self.buf[at] == b'"' {
                        self.pos = at + 1;
                        return Ok(&self.buf[start..at]);
                    }
                    // Escape sequence: skip backslash + escaped byte.
                    if at + 1 >= self.buf.len() {
                        return Err(ScanError::new("unterminated escape sequence", at));
                    }
                    self.pos = at + 2;
                }
                None => return Err(ScanError::new("unterminated string", start)),
            }
        }
    }

    /// Scan any JSON value and return its full raw span.
    pub fn scan_value(&mut self) -> ScanResult<&'a [u8]> {
        self.skip_ws();
        let start = self.pos;
        match self.peek() {
            Some(b'"') => {
                self.scan_string()?;
            }
            Some(b'{') | Some(b'[') => {
                self.scan_container()?;
            }
            Some(_) => {
                // Scalar: number / true / false / null. Scan until a structural
                // delimiter or whitespace.
                while self.pos < self.buf.len() {
                    match self.buf[self.pos] {
                        b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r' => break,
                        _ => self.pos += 1,
                    }
                }
                if self.pos == start {
                    return Err(ScanError::new("expected a JSON value", start));
                }
            }
            None => {
                return Err(ScanError::new(
                    "expected a JSON value but reached end of input",
                    start,
                ))
            }
        }
        Ok(&self.buf[start..self.pos])
    }

    /// Scan a `{...}` or `[...]` container assuming the opener is at `pos`.
    ///
    /// Structural bytes are walked one at a time (containers are mostly small),
    /// while string contents — the bulk of large payloads such as base64
    /// avatars — are skipped via the memchr fast path in `scan_string`.
    fn scan_container(&mut self) -> ScanResult<()> {
        let start = self.pos;
        let mut depth: usize = 0;
        while self.pos < self.buf.len() {
            match self.buf[self.pos] {
                b'"' => {
                    self.scan_string()?;
                }
                b'{' | b'[' => {
                    depth += 1;
                    self.pos += 1;
                }
                b'}' | b']' => {
                    depth -= 1;
                    self.pos += 1;
                    if depth == 0 {
                        return Ok(());
                    }
                }
                _ => self.pos += 1,
            }
        }
        Err(ScanError::new("unterminated container", start))
    }
}

/// Walk the top-level JSON object and hand each key's raw value span to the
/// callback. Key order in the document does not matter to callers because
/// they receive every entry before acting on relationships between keys.
pub fn walk_top_level<'a>(
    buf: &'a [u8],
    mut on_entry: impl FnMut(&'a [u8], &'a [u8]) -> ScanResult<()>,
) -> ScanResult<()> {
    let mut scanner = JsonScanner::new(buf);
    scanner.skip_ws();
    scanner.expect(b'{')?;
    scanner.skip_ws();
    if scanner.consume(b'}') {
        return Ok(());
    }

    loop {
        scanner.skip_ws();
        let key = scanner.scan_string()?;
        scanner.skip_ws();
        scanner.expect(b':')?;
        let raw = scanner.scan_value()?;
        on_entry(key, raw)?;

        scanner.skip_ws();
        if scanner.consume(b',') {
            continue;
        }
        scanner.expect(b'}')?;
        return Ok(());
    }
}

/// Iterate the elements of a raw JSON array span (as produced by
/// `walk_top_level`). The callback receives each element's raw span plus the
/// absolute end offset of that element relative to `base_offset` — used for
/// progress reporting on huge arrays.
pub fn for_each_array_element<'a>(
    raw: &'a [u8],
    base_offset: usize,
    mut on_element: impl FnMut(&'a [u8], usize) -> ScanResult<()>,
) -> ScanResult<()> {
    let mut scanner = JsonScanner::new(raw);
    scanner.skip_ws();
    if !scanner.peek_is(b'[') {
        return Err(ScanError::new("expected an array", scanner.pos()));
    }
    scanner.expect(b'[')?;
    scanner.skip_ws();
    if scanner.consume(b']') {
        return Ok(());
    }

    loop {
        let element = scanner.scan_value()?;
        on_element(element, base_offset + scanner.pos())?;
        scanner.skip_ws();
        if scanner.consume(b',') {
            scanner.skip_ws();
            continue;
        }
        scanner.expect(b']')?;
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect_entries(doc: &str) -> Vec<(String, String)> {
        let mut entries = Vec::new();
        walk_top_level(doc.as_bytes(), |key, raw| {
            entries.push((
                String::from_utf8_lossy(key).to_string(),
                String::from_utf8_lossy(raw).to_string(),
            ));
            Ok(())
        })
        .expect("walk should succeed");
        entries
    }

    fn collect_elements(raw: &str) -> Vec<String> {
        let mut elements = Vec::new();
        for_each_array_element(raw.as_bytes(), 0, |element, _| {
            elements.push(String::from_utf8_lossy(element).to_string());
            Ok(())
        })
        .expect("iteration should succeed");
        elements
    }

    #[test]
    fn walks_simple_object() {
        let entries = collect_entries(r#"{"a": 1, "b": "x", "c": [1, 2]}"#);
        assert_eq!(
            entries,
            vec![
                ("a".to_string(), "1".to_string()),
                ("b".to_string(), "\"x\"".to_string()),
                ("c".to_string(), "[1, 2]".to_string()),
            ]
        );
    }

    #[test]
    fn handles_nested_and_escaped_content() {
        let doc = r#"{"session": {"name": "a\"}b", "inner": {"x": [1, {"y": "]"}]}}, "messages": [{"content": "hi \\ {there}"}, {"content": "\u4f60好"}]}"#;
        let entries = collect_entries(doc);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "session");
        assert!(entries[0].1.starts_with('{') && entries[0].1.ends_with('}'));

        let elements = collect_elements(&entries[1].1);
        assert_eq!(elements.len(), 2);
        assert_eq!(elements[0], r#"{"content": "hi \\ {there}"}"#);
    }

    #[test]
    fn handles_empty_arrays_and_objects() {
        let entries = collect_entries(r#"{"avatars": {}, "messages": []}"#);
        assert_eq!(
            entries,
            vec![
                ("avatars".to_string(), "{}".to_string()),
                ("messages".to_string(), "[]".to_string()),
            ]
        );
        assert!(collect_elements("[]").is_empty());
    }

    #[test]
    fn skips_bom() {
        let doc = "\u{FEFF}{\"messages\": [3]}";
        let entries = collect_entries(doc);
        assert_eq!(entries[0].0, "messages");
        assert_eq!(collect_elements(&entries[0].1), vec!["3".to_string()]);
    }

    #[test]
    fn errors_on_truncated_document() {
        let result = walk_top_level(br#"{"a": [1, 2"#, |_, _| Ok(()));
        assert!(result.is_err());
    }
}
