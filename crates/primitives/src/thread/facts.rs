use serde_json::{Map, Value};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    record_values::direct_string_property,
    routing::output::extracted_facts,
};

pub(crate) fn thread_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "thread" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let authored_id = explicit_id
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("thread:{}", safe_id(&authored_id));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    parts.add_direct_export_evidence(&mut metadata);
    metadata.insert(
        "facts".to_string(),
        Value::Object(Map::from_iter([(
            "kind".to_string(),
            Value::String("thread".to_string()),
        )])),
    );

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "thread",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ))
}
