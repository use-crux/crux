use serde_json::{Map, Value};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    record_values::{direct_string_property, has_property},
    routing::output::extracted_facts,
    schema::schema_property,
    signal::values::TRANSPORT_MODULES,
};

/// Projects canonical exported Signal definitions and their authored schema.
pub(crate) fn signal_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "signal" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let signal_id = direct_string_property(config, "id")?;
    let id = format!("signal:{}", safe_id(&signal_id));
    let schema = schema_property(context, &id, config, "schema")?;

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("signal".to_string()));
    facts.insert("signalId".to_string(), Value::String(signal_id.clone()));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    parts.add_direct_export_evidence(&mut metadata);
    if let Some(schema) = schema.schema {
        metadata.insert("schema".to_string(), schema);
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "signal",
            name: signal_id,
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        schema.source_refs,
    ))
}

/// Projects one authored webhook transport declaration.
pub(crate) fn webhook_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "webhook" || parts.callee_direct == Some(false) {
        return None;
    }
    if !parts
        .callee_module_specifier
        .is_some_and(|module| TRANSPORT_MODULES.contains(&module))
    {
        return None;
    }
    let has_handle = parts
        .object_arg
        .is_some_and(|value| has_property(value, "handle"));
    let id = format!(
        "signal.transport:{}",
        safe_id(&format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        ))
    );
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("signal.transport".to_string()),
    );
    facts.insert(
        "transportKind".to_string(),
        Value::String("webhook".to_string()),
    );
    facts.insert("hasHandle".to_string(), Value::Bool(has_handle));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    parts.add_direct_export_evidence(&mut metadata);
    metadata.insert("facts".to_string(), Value::Object(facts));

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "signal.transport",
            name: parts.variable_name.to_string(),
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
