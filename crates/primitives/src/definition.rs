use serde::Serialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::{
    protocol::{SourceLocation, SourceSnippet},
    runtime::join::routing_runtime_join,
};

#[derive(Debug, Clone)]
pub(crate) struct NativeDefinitionInput<'a> {
    pub id: String,
    pub kind: &'a str,
    pub name: String,
    pub file: &'a str,
    pub source: &'a SourceLocation,
    pub snippet: Option<&'a SourceSnippet>,
    pub metadata: Map<String, Value>,
}

/// Builds the Project Definition shape emitted by the TypeScript static definition builder.
pub(crate) fn static_index_definition(input: NativeDefinitionInput<'_>) -> Value {
    let mut definition = Map::new();
    definition.insert("id".to_string(), Value::String(input.id.clone()));
    definition.insert("kind".to_string(), Value::String(input.kind.to_string()));
    definition.insert("name".to_string(), Value::String(input.name.clone()));
    definition.insert("source".to_string(), json!(input.source));
    if let Some(snippet) = input.snippet {
        definition.insert("sourceSnippet".to_string(), json!(snippet));
    }
    definition.insert(
        "fidelity".to_string(),
        Value::String("resolved".to_string()),
    );
    definition.insert("status".to_string(), Value::String("active".to_string()));
    definition.insert(
        "fingerprint".to_string(),
        Value::String(definition_fingerprint(
            input.kind,
            &input.name,
            input.file,
            input.snippet.map(|snippet| snippet.source.as_str()),
        )),
    );

    let mut metadata = Map::new();
    metadata.insert(
        "runtimeJoin".to_string(),
        routing_runtime_join(&input.id, input.kind, &input.name, &input.metadata),
    );
    metadata.extend(input.metadata);
    metadata.insert("static".to_string(), Value::Bool(true));
    definition.insert("metadata".to_string(), Value::Object(metadata));
    Value::Object(definition)
}

pub(crate) fn safe_id(value: &str) -> String {
    let mut output = String::new();
    let mut pending_dash = false;
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '-') {
            if pending_dash && !output.ends_with('-') {
                output.push('-');
            }
            output.push(character);
            pending_dash = false;
        } else {
            pending_dash = true;
        }
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.is_empty() {
        fingerprint_json(&value)
    } else {
        trimmed
    }
}

pub(crate) fn folded_index_child(
    parent_definition_id: &str,
    parent_relation_type: &str,
    role: &str,
    order: usize,
) -> Value {
    json!({
        "standalone": false,
        "parentDefinitionId": parent_definition_id,
        "parentRelationType": parent_relation_type,
        "role": role,
        "order": order,
    })
}

pub(crate) fn source_ref(
    definition_id: &str,
    role: &str,
    property: &str,
    symbol: &str,
    source: &SourceLocation,
    function_name: Option<&str>,
    snippet: Option<&SourceSnippet>,
) -> Value {
    source_ref_with_metadata(
        definition_id,
        role,
        property,
        symbol,
        source,
        function_name,
        snippet,
        None,
    )
}

pub(crate) fn source_ref_with_metadata(
    definition_id: &str,
    role: &str,
    property: &str,
    symbol: &str,
    source: &SourceLocation,
    function_name: Option<&str>,
    snippet: Option<&SourceSnippet>,
    metadata: Option<Value>,
) -> Value {
    let mut ref_value = Map::new();
    ref_value.insert(
        "id".to_string(),
        Value::String(format!("{definition_id}:source:{role}:{property}:{symbol}")),
    );
    ref_value.insert("role".to_string(), Value::String(role.to_string()));
    ref_value.insert("property".to_string(), Value::String(property.to_string()));
    ref_value.insert("symbol".to_string(), Value::String(symbol.to_string()));
    ref_value.insert(
        "source".to_string(),
        source_location_with_function(source, function_name),
    );
    if let Some(snippet) = snippet {
        ref_value.insert("snippet".to_string(), json!(snippet));
    }
    ref_value.insert(
        "fidelity".to_string(),
        Value::String("resolved".to_string()),
    );
    if let Some(metadata) = metadata {
        ref_value.insert("metadata".to_string(), metadata);
    }
    json!({
        "definitionId": definition_id,
        "ref": Value::Object(ref_value),
    })
}

fn source_location_with_function(source: &SourceLocation, function_name: Option<&str>) -> Value {
    let mut value = Map::new();
    value.insert("file".to_string(), Value::String(source.file.clone()));
    value.insert("line".to_string(), json!(source.line));
    value.insert("column".to_string(), json!(source.column));
    if let Some(function_name) = function_name {
        value.insert(
            "function".to_string(),
            Value::String(function_name.to_string()),
        );
    }
    Value::Object(value)
}

#[derive(Serialize)]
struct DefinitionFingerprint<'a> {
    kind: &'a str,
    name: &'a str,
    file: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<&'a str>,
}

fn definition_fingerprint(kind: &str, name: &str, file: &str, text: Option<&str>) -> String {
    fingerprint_json(&DefinitionFingerprint {
        kind,
        name,
        file,
        text,
    })
}

pub(crate) fn fingerprint_json<T: Serialize>(value: &T) -> String {
    let encoded = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(encoded.as_bytes());
    hex_lower(&hasher.finalize())[..16].to_string()
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::safe_id;

    /// Known outputs shared by the TypeScript indexer (`safeId`/`fingerprint` in
    /// `packages/indexer/src/indexer/definitions.ts`) and the core runtime
    /// (`safeDefinitionId` in `packages/core/src/observability/definition-ref.ts`).
    /// All three must be byte-identical or the runtime→index join breaks.
    #[test]
    fn safe_id_matches_indexer_fingerprint_for_empty_normalization() {
        assert_eq!(safe_id("!!!"), "3614a738f9bd68a6");
        assert_eq!(safe_id("@@@"), "0109b085b18e8995");
        assert_eq!(safe_id("→→→"), "b446c7cc369e6b13");
        assert_eq!(safe_id("   "), "7c1e8804d7423330");
        assert_eq!(safe_id("()[]{}"), "171889b67faa6147");
        assert_eq!(safe_id("日本語"), "d2b94e6e664483bb");
        assert_eq!(safe_id("\t\n"), "1f1a1a4546fdcf8c");
    }

    #[test]
    fn safe_id_keeps_non_empty_normalized_ids() {
        assert_eq!(safe_id("..."), "...");
        assert_eq!(safe_id("::"), "::");
        assert_eq!(safe_id("a b"), "a-b");
    }
}
