//! Small helpers replicating JavaScript semantics shared by format kernels.

use std::path::Path;

use serde_json::Value;

/// `path.basename(filePath).replace(/\.json$/i, '') || fallback`
pub fn extract_name_from_file_path(file_path: &str, fallback: &str) -> String {
    let basename = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let stripped =
        if basename.len() >= 5 && basename[basename.len() - 5..].eq_ignore_ascii_case(".json") {
            &basename[..basename.len() - 5]
        } else {
            basename.as_str()
        };
    if stripped.is_empty() {
        fallback.to_string()
    } else {
        stripped.to_string()
    }
}

/// `value || fallback` semantics for string fields: empty string is falsy.
pub fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    match value {
        Some(Value::String(s)) if !s.is_empty() => Some(s.as_str()),
        _ => None,
    }
}
