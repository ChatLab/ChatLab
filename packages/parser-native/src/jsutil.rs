//! Small helpers replicating JavaScript semantics shared by format kernels.

use std::path::Path;

use serde_json::Value;

/// `path.basename(filePath).replace(/\.json$/i, '') || fallback`
pub fn extract_name_from_file_path(file_path: &str, fallback: &str) -> String {
    let basename = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let suffix_start = basename.len().saturating_sub(5);
    let stripped = match basename.get(suffix_start..) {
        Some(suffix) if suffix.eq_ignore_ascii_case(".json") => &basename[..suffix_start],
        _ => basename.as_str(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_name_keeps_multibyte_name_without_json_suffix() {
        assert_eq!(extract_name_from_file_path("/tmp/测试", "fallback"), "测试");
    }

    #[test]
    fn extract_name_strips_json_suffix_case_insensitively() {
        assert_eq!(
            extract_name_from_file_path("/tmp/测试.JSON", "fallback"),
            "测试"
        );
    }

    #[test]
    fn extract_name_uses_fallback_for_empty_basename() {
        assert_eq!(extract_name_from_file_path("", "fallback"), "fallback");
    }
}
