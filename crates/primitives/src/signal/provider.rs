use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    record_values::{has_property, property_value},
    routing::output::extracted_facts,
    signal::values::{
        PROVIDER_MODULES, config_source_refs, reference_name, signal_map, string_property,
        webhook_kind,
    },
};

/// Projects one authored Signal provider definition.
pub(crate) fn signal_provider_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "signalProvider" || parts.callee_direct == Some(false) {
        return None;
    }
    if !parts
        .callee_module_specifier
        .is_some_and(|module| PROVIDER_MODULES.contains(&module))
    {
        return None;
    }
    let options = parts.object_arg?;
    let provider_id = string_property(options, "id", &context.initializers);
    let identity = if provider_id.is_some() {
        "static"
    } else {
        "partial"
    };
    let authored_identity = provider_id.clone().unwrap_or_else(|| {
        format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        )
    });
    let id = format!("signal.provider:{}", safe_id(&authored_identity));
    let transport_value = property_value(options, "transport");
    let transport_variable = reference_name(transport_value);
    let transport_resolved = context.resolve_record_source(transport_value).flatten();
    let transport_kind = webhook_kind(
        transport_resolved.as_ref().map(|resolved| resolved.value),
        transport_value,
    );
    let inline_transport_definition_id = match (transport_kind, transport_value) {
        (Some(_), Some(crate::protocol::StaticSyntaxValue::Call { source, .. })) => Some(format!(
            "signal.transport:{}",
            safe_id(&format!(
                "{}:{}:{}",
                context.fingerprint_file, source.line, source.column
            ))
        )),
        _ => None,
    };
    let (signal_ids, signal_variables) = signal_map(context, property_value(options, "signals"));
    let has_on_event = has_property(options, "onEvent");

    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("signal.provider".to_string()),
    );
    if let Some(provider_id) = &provider_id {
        facts.insert("providerId".to_string(), Value::String(provider_id.clone()));
    }
    facts.insert("identity".to_string(), Value::String(identity.to_string()));
    if let Some(transport_kind) = transport_kind {
        facts.insert(
            "transportKind".to_string(),
            Value::String(transport_kind.to_string()),
        );
    }
    if let Some(transport_variable) = &transport_variable {
        facts.insert(
            "transportVariable".to_string(),
            Value::String(transport_variable.clone()),
        );
    }
    if !signal_ids.is_empty() {
        facts.insert("signalIds".to_string(), json!(signal_ids));
    }
    if !signal_variables.is_empty() {
        facts.insert("signalVariables".to_string(), json!(signal_variables));
    }
    facts.insert("hasOnEvent".to_string(), Value::Bool(has_on_event));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    parts.add_direct_export_evidence(&mut metadata);
    metadata.insert("facts".to_string(), Value::Object(facts));

    let mut references = Vec::new();
    if let Some(transport_variable) = transport_variable {
        references.push(json!({
            "type": "signal.provider.uses_transport",
            "toVariable": transport_variable,
        }));
    } else if let Some(transport_definition_id) = inline_transport_definition_id {
        references.push(json!({
            "type": "signal.provider.uses_transport",
            "toId": transport_definition_id,
        }));
    }
    for variable in signal_variables {
        references.push(json!({
            "type": "signal.provider.publishes_signal",
            "toVariable": variable,
        }));
    }

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "signal.provider",
            name: provider_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        config_source_refs(
            &id,
            options,
            &["id", "transport", "signals", "onEvent"],
            "Signal provider",
        ),
    ))
}
