use serde::Serialize;
use serde_json::{Value, json};

use crate::definition::fingerprint_json;

pub(crate) fn assertion_sites_from_source(
    file: &str,
    export_name: &str,
    source: &str,
) -> Vec<Value> {
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let lines = normalized.split('\n').collect::<Vec<_>>();
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, text)| {
            let assertion = assertion_call_match(text)?;
            let line = index + 1;
            let column = assertion.column + 1;
            let callback_level = callback_level_near(&lines, index);
            let normalized_assertion_text = normalize_assertion_text(&text[assertion.column..]);
            let id = format!(
                "assertion-site:{}",
                fingerprint_json(&AssertionSiteFingerprint {
                    authored_file: file,
                    export_name,
                    callback_kind: assertion.kind,
                    callback_level,
                    line,
                    column,
                    normalized_assertion_text: &normalized_assertion_text,
                })
            );
            Some(json!({
                "assertionSiteId": id,
                "callbackKind": assertion.kind,
                "callbackLevel": callback_level,
                "authoredFile": file,
                "line": line,
                "column": column,
                "sourceRef": format!("{file}:{line}:{column}"),
                "normalizedAssertionText": normalized_assertion_text,
            }))
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssertionSiteFingerprint<'a> {
    authored_file: &'a str,
    export_name: &'a str,
    callback_kind: &'a str,
    callback_level: &'a str,
    line: usize,
    column: usize,
    normalized_assertion_text: &'a str,
}

struct AssertionMatch {
    kind: &'static str,
    column: usize,
}

fn assertion_call_match(text: &str) -> Option<AssertionMatch> {
    let expect = first_call_index(text, "ctx.expect");
    expect.map(|column| AssertionMatch {
        kind: "expect",
        column,
    })
}

fn first_call_index(text: &str, callee: &str) -> Option<usize> {
    let index = text.find(callee)?;
    let after = text[index + callee.len()..].trim_start();
    (after.starts_with('(') || after.starts_with(".soft")).then_some(index)
}

fn callback_level_near(lines: &[&str], line_index: usize) -> &'static str {
    let start = line_index.saturating_sub(19);
    for index in (start..=line_index).rev() {
        let text = lines[index].trim();
        if text.starts_with("expect:") || text.starts_with("afterScores:") {
            return "eval";
        }
        if text.contains("expect:") && text.contains("input:") {
            return "case";
        }
    }
    "unknown"
}

fn normalize_assertion_text(text: &str) -> String {
    text.trim().trim_end_matches(';').to_string()
}
