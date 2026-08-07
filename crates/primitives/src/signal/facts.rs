use serde_json::{Map, Value};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    record_values::has_property,
    routing::output::extracted_facts,
    schema::schema_property,
    signal::values::{TRANSPORT_MODULES, string_property},
};

/// Projects canonical exported Signal definitions and their authored schema.
pub(crate) fn signal_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "signal" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let signal_id = string_property(config, "id", &context.initializers);
    let identity = if signal_id.is_some() {
        "static"
    } else {
        "partial"
    };
    let authored_identity = signal_id.clone().unwrap_or_else(|| {
        format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        )
    });
    let id = format!("signal:{}", safe_id(&authored_identity));
    let schema = schema_property(context, &id, config, "schema")?;

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("signal".to_string()));
    if let Some(signal_id) = &signal_id {
        facts.insert("signalId".to_string(), Value::String(signal_id.clone()));
    }
    facts.insert("identity".to_string(), Value::String(identity.to_string()));

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
            name: signal_id.unwrap_or_else(|| parts.variable_name.to_string()),
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

/// Projects one authored polling transport declaration.
pub(crate) fn polling_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "polling" || parts.callee_direct == Some(false) {
        return None;
    }
    if !parts
        .callee_module_specifier
        .is_some_and(|module| TRANSPORT_MODULES.contains(&module))
    {
        return None;
    }
    let has_poll = parts
        .object_arg
        .is_some_and(|value| has_property(value, "poll"));
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
        Value::String("polling".to_string()),
    );
    facts.insert("hasPoll".to_string(), Value::Bool(has_poll));

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
