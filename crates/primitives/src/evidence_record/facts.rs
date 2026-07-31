use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{has_property, object_property, resolve_static_value},
    routing::output::extracted_facts,
};

const CORE_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/evidence"];
const SOURCE_PROPERTIES: &[&str] = &[
    "role",
    "kind",
    "conclusion",
    "data",
    "ref",
    "subject",
    "idempotencyKey",
    "supersedes",
];

/// Projects a canonical `evidence.record()` member call from bounded syntax.
pub(crate) fn evidence_record_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "record"
        || !parts
            .callee_module_specifier
            .is_some_and(|module| CORE_MODULES.contains(&module))
    {
        return None;
    }
    let receiver = parts.receiver_name?;
    if !context.has_named_import(receiver, "evidence", CORE_MODULES) {
        return None;
    }

    let input = parts
        .args
        .first()
        .map(|value| resolve_static_value(value, &context.initializers, &mut HashSet::new()));
    let object = input.filter(|value| matches!(value, StaticSyntaxValue::Object { .. }));
    let id = format!(
        "evidence.record:{}",
        safe_id(&format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        ))
    );
    let role = role_fact(string_property(object, "role", context));
    let evidence_kind = kind_fact(string_property(object, "kind", context));
    let mut safe_facts = Map::new();
    safe_facts.insert(
        "kind".to_string(),
        Value::String("evidence.record".to_string()),
    );
    safe_facts.insert("role".to_string(), Value::String(role.to_string()));
    safe_facts.insert("evidenceKind".to_string(), evidence_kind);
    safe_facts.insert(
        "sourceForm".to_string(),
        Value::String(source_form(object).to_string()),
    );
    safe_facts.insert(
        "subjectMode".to_string(),
        Value::String(
            if object.is_some_and(|value| has_property(value, "subject")) {
                "explicit"
            } else {
                "ambient"
            }
            .to_string(),
        ),
    );
    safe_facts.insert(
        "idempotent".to_string(),
        Value::Bool(object.is_some_and(|value| has_property(value, "idempotencyKey"))),
    );
    safe_facts.insert(
        "supersedes".to_string(),
        Value::Bool(object.is_some_and(|value| has_property(value, "supersedes"))),
    );
    if let Some(conclusion) = conclusion_fact(role, string_property(object, "conclusion", context))
    {
        safe_facts.insert("conclusion".to_string(), Value::String(conclusion));
    }

    let mut metadata = Map::new();
    metadata.insert("facts".to_string(), Value::Object(safe_facts));
    let mut definition = static_index_definition(NativeDefinitionInput {
        id: id.clone(),
        kind: "evidence.record",
        name: "record".to_string(),
        file: context.fingerprint_file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    definition.as_object_mut()?.remove("sourceSnippet");

    let references = parts
        .owner_variable_name
        .map(|owner| {
            vec![json!({
                "type": "evidence.record.declared_in",
                "toVariable": owner,
            })]
        })
        .unwrap_or_default();
    let source_refs = object
        .map(|value| {
            SOURCE_PROPERTIES
                .iter()
                .filter_map(|property| {
                    let source = &object_property(value, property)?.source;
                    Some(json!({
                        "definitionId": id,
                        "ref": {
                            "id": format!(
                                "{id}:source:config:{property}:{}:{}",
                                source.line, source.column
                            ),
                            "role": "config",
                            "property": property,
                            "source": source,
                            "fidelity": "resolved",
                            "description": format!("Authored evidence {property} expression."),
                        }
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    Some(extracted_facts(
        parts.variable_name,
        definition,
        Vec::new(),
        references,
        source_refs,
    ))
}

fn string_property(
    object: Option<&StaticSyntaxValue>,
    name: &str,
    context: &PrimitiveContext<'_>,
) -> Option<String> {
    let value = &object_property(object?, name)?.value;
    match resolve_static_value(value, &context.initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}

fn role_fact(value: Option<String>) -> &'static str {
    match value.as_deref() {
        Some("intent") => "intent",
        Some("authority") => "authority",
        Some("change") => "change",
        Some("verification") => "verification",
        Some("recovery") => "recovery",
        _ => "unresolved",
    }
}

fn conclusion_fact(role: &str, value: Option<String>) -> Option<String> {
    let value = value?;
    let valid = match role {
        "authority" => matches!(
            value.as_str(),
            "allowed" | "denied" | "revoked" | "inconclusive"
        ),
        "change" => matches!(
            value.as_str(),
            "applied" | "partial" | "no-change" | "unknown"
        ),
        "verification" => matches!(value.as_str(), "passed" | "failed" | "inconclusive"),
        "recovery" => matches!(
            value.as_str(),
            "available" | "unavailable" | "succeeded" | "failed" | "partial"
        ),
        _ => false,
    };
    valid.then_some(value)
}

fn source_form(object: Option<&StaticSyntaxValue>) -> &'static str {
    let Some(object) = object else {
        return "unresolved";
    };
    match (has_property(object, "data"), has_property(object, "ref")) {
        (true, false) => "inline",
        (false, true) => "reference",
        _ => "invalid",
    }
}

fn kind_fact(value: Option<String>) -> Value {
    let Some(value) = value else {
        return json!({ "classification": "unresolved" });
    };
    if canonical_kind(&value) {
        return json!({ "classification": "canonical", "value": value });
    }
    if valid_custom_kind(&value) {
        return json!({ "classification": "custom", "value": value });
    }
    json!({ "classification": "invalid" })
}

fn valid_custom_kind(value: &str) -> bool {
    let mut characters = value.chars();
    let first = characters.next();
    let last = value.chars().next_back();
    value.starts_with("custom.")
        && value.chars().count() > "custom.".chars().count()
        && first.is_some_and(|character| !is_ecmascript_whitespace(character))
        && last.is_some_and(|character| !is_ecmascript_whitespace(character))
        && !value
            .chars()
            .any(|character| matches!(character, '\u{0}'..='\u{1f}' | '\u{7f}'))
        && !value.starts_with("custom.crux.")
        && value.chars().count() <= 128
}

fn is_ecmascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{9}'..='\u{d}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'..='\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn canonical_kind(value: &str) -> bool {
    matches!(
        value,
        "approval.request"
            | "approval.decision"
            | "input"
            | "output"
            | "messages"
            | "system"
            | "context"
            | "context.contribution"
            | "prompt"
            | "prompt.budget"
            | "tool.args"
            | "tool.request"
            | "tool.result"
            | "retrieval.hits"
            | "memory.snapshot"
            | "memory.recall"
            | "memory.diff"
            | "memory.write"
            | "handoff.payload"
            | "delegate.report"
            | "constraint.report"
            | "guardrail.report"
            | "validation.feedback"
            | "error.stack"
            | "error.raw"
            | "stream.timeline"
            | "score.report"
            | "citation.report"
            | "composition.report"
            | "routing.report"
            | "cache.report"
            | "compaction.report"
            | "embedding.report"
            | "indexing.report"
            | "ingest.report"
            | "corpus.report"
            | "security.report"
            | "media.report"
    )
}

#[cfg(test)]
mod tests {
    use super::valid_custom_kind;

    #[test]
    fn custom_kind_matches_ecmascript_whitespace_and_control_boundaries() {
        assert!(valid_custom_kind("custom.a\u{85}b"));
        assert!(!valid_custom_kind("custom.a\u{feff}"));
        assert!(valid_custom_kind("custom.a\u{feff}b"));
        assert!(!valid_custom_kind("custom.a\u{7f}b"));
    }
}
