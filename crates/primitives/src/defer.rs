//! Static projection for public request-scoped deferred work.

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::{
    context::call_parts,
    definition::{NativeDefinitionInput, safe_id, source_ref, static_index_definition},
    manifest::CustomProjectionInput,
    protocol::{StaticSourceMatch, StaticSyntaxValue},
    routing::output::extracted_facts,
};

/// Projects one binding-resolved public `defer()` call.
pub(crate) fn defer_facts(input: &CustomProjectionInput<'_>) -> Option<Value> {
    let parts = public_defer_parts(input.source_match)?;
    let ordinal = input.matches[..=input.match_index]
        .iter()
        .filter(|source_match| public_defer_parts(source_match).is_some())
        .count();
    let named = parts.args.len() > 1;
    let mode = if named { "named" } else { "inline" };
    let path_hash = Sha256::digest(input.relative_path.as_bytes());
    let id = format!(
        "deferred-work:{mode}:{}:{}:{ordinal}",
        safe_id(input.relative_path),
        path_hash[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
    );

    let mut metadata = Map::new();
    metadata.insert("mode".to_string(), Value::String(mode.to_string()));
    metadata.insert(
        "indexPresentation".to_string(),
        json!({ "standalone": true }),
    );
    metadata.insert(
        "facts".to_string(),
        json!({ "kind": "deferred-work", "mode": mode }),
    );
    metadata.insert(
        "relativePath".to_string(),
        Value::String(input.relative_path.to_string()),
    );
    metadata.insert("callOrdinal".to_string(), json!(ordinal));
    let call_column = parts.source.column.saturating_sub(1);
    let mut source_lines = input.source_text.lines();
    let prior = source_lines
        .by_ref()
        .take(parts.source.line.saturating_sub(1))
        .collect::<Vec<_>>();
    let source_line = source_lines.next().unwrap_or_default();
    let before_call = format!(
        "{}\n{}",
        prior.join("\n"),
        source_line.get(..call_column).unwrap_or_default()
    );
    metadata.insert(
        "consumed".to_string(),
        Value::Bool(is_consumed(&before_call)),
    );
    metadata.insert(
        "eagerExecution".to_string(),
        Value::Bool(parts.eager_execution),
    );

    let target = named
        .then(|| parts.args.first().and_then(identifier))
        .flatten();
    if let Some(target) = target {
        metadata.insert("target".to_string(), Value::String(target.to_string()));
    }
    let references = target
        .map(|target| {
            vec![json!({
                "type": "defer.targets_task",
                "fromId": id,
                "toVariable": target,
            })]
        })
        .unwrap_or_default();
    let source_refs = if let Some(target) = target {
        vec![source_ref(
            &id,
            "config",
            "target",
            target,
            parts.source,
            Some(target),
            parts.snippet,
        )]
    } else {
        let symbol = parts.args.first().and_then(identifier).unwrap_or("inline");
        vec![source_ref(
            &id,
            "callback",
            "callback",
            symbol,
            parts.source,
            parts.args.first().and_then(identifier),
            parts.snippet,
        )]
    };

    Some(extracted_facts(
        &format!("defer_{ordinal}"),
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "deferred-work",
            name: format!("{mode} deferred work"),
            file: input.relative_path,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        source_refs,
    ))
}

fn is_consumed(before_call: &str) -> bool {
    let tail_start = before_call
        .char_indices()
        .rev()
        .nth(511)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let tail = &before_call[tail_start..];
    tail.rsplit([';', '{', '}'])
        .next()
        .is_some_and(|expression| {
            expression.contains("await ")
                || expression.contains("return ")
                || expression.contains("Promise.all")
                || expression.contains("Promise.allSettled")
                || expression.contains("Promise.race")
                || expression.contains("Promise.any")
        })
}

fn public_defer_parts(source_match: &StaticSourceMatch) -> Option<crate::context::CallParts<'_>> {
    let parts = call_parts(source_match)?;
    (parts.match_kind == "call"
        && parts.callee_name == "defer"
        && parts.callee_direct != Some(false)
        && parts.callee_module_specifier == Some("@use-crux/core"))
    .then_some(parts)
}

fn identifier(value: &StaticSyntaxValue) -> Option<&str> {
    match value {
        StaticSyntaxValue::Identifier { name } => Some(name),
        _ => None,
    }
}
