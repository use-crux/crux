use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, source_ref, static_index_definition},
    protocol::StaticSyntaxValue,
    record_values::{direct_string_property, property_value},
    routing::output::extracted_facts,
    signal::values::{
        PROVIDER_MODULES, config_ref_fact, config_source_refs, live_fields, provider_definition_id,
        provider_id_from_resolved, reference_name,
    },
};

/// Projects one authored managed transport binding declaration.
pub(crate) fn managed_transport_binding_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "managedTransportBinding" || parts.callee_direct == Some(false) {
        return None;
    }
    if !parts
        .callee_module_specifier
        .is_some_and(|module| PROVIDER_MODULES.contains(&module))
    {
        return None;
    }
    let provider_arg = parts.args.first()?;
    let options = parts.object_arg.or_else(|| {
        parts.args.get(1).and_then(|value| match value {
            StaticSyntaxValue::Object { .. } => Some(value),
            _ => None,
        })
    });
    let provider_variable = reference_name(Some(provider_arg));
    let provider_resolved = context.resolve_record_source(Some(provider_arg)).flatten();
    let provider_definition_id = provider_definition_id(context, provider_resolved.as_ref());
    let binding_id = options.and_then(|value| direct_string_property(value, "id"));
    let signal_id = options.and_then(|value| direct_string_property(value, "signalId"));
    let adapter_id = options.and_then(|value| direct_string_property(value, "adapterId"));
    let provider_name = options.and_then(|value| direct_string_property(value, "provider"));
    let config_ref = options.and_then(config_ref_fact);
    let live_fields = options.map(live_fields).unwrap_or_default();
    let provider_id =
        provider_name.or_else(|| provider_id_from_resolved(context, provider_resolved.as_ref()));
    let stable = binding_id.is_some()
        && provider_id.is_some()
        && signal_id.is_some()
        && matches!(
            config_ref.as_ref().and_then(|value| value.get("kind")),
            Some(Value::String(kind)) if kind == "literal"
        )
        && live_fields.is_empty();
    let authored_identity = if stable {
        binding_id.clone().unwrap_or_default()
    } else {
        format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        )
    };
    let id = format!("signal.transportBinding:{}", safe_id(&authored_identity));

    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("signal.transportBinding".to_string()),
    );
    if let Some(binding_id) = &binding_id {
        facts.insert("bindingId".to_string(), Value::String(binding_id.clone()));
    }
    facts.insert(
        "identity".to_string(),
        Value::String(if stable { "static" } else { "partial" }.to_string()),
    );
    if let Some(provider_variable) = &provider_variable {
        facts.insert(
            "providerVariable".to_string(),
            Value::String(provider_variable.clone()),
        );
    }
    if let Some(provider_definition_id) = &provider_definition_id {
        facts.insert(
            "providerDefinitionId".to_string(),
            Value::String(provider_definition_id.clone()),
        );
    }
    if let Some(provider_id) = &provider_id {
        facts.insert("providerId".to_string(), Value::String(provider_id.clone()));
    }
    if let Some(adapter_id) = adapter_id {
        facts.insert("adapterId".to_string(), Value::String(adapter_id));
    }
    if let Some(config_ref) = config_ref {
        facts.insert("configRef".to_string(), config_ref);
    }
    if let Some(signal_id) = &signal_id {
        facts.insert("signalId".to_string(), Value::String(signal_id.clone()));
        facts.insert(
            "target".to_string(),
            json!({ "kind": "signal", "signalId": signal_id }),
        );
    } else if options
        .and_then(|value| property_value(value, "signalId"))
        .and_then(|value| reference_name(Some(value)))
        .is_some()
    {
        facts.insert("target".to_string(), json!({ "kind": "unresolved" }));
    } else {
        facts.insert("target".to_string(), json!({ "kind": "dynamic" }));
    }
    if !live_fields.is_empty() {
        facts.insert("liveFields".to_string(), json!(live_fields));
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    parts.add_direct_export_evidence(&mut metadata);
    metadata.insert("facts".to_string(), Value::Object(facts));

    let mut references = Vec::new();
    if let Some(provider_definition_id) = &provider_definition_id {
        references.push(json!({
            "type": "signal.transportBinding.binds_provider",
            "toId": provider_definition_id,
        }));
    } else if let Some(provider_variable) = provider_variable {
        references.push(json!({
            "type": "signal.transportBinding.binds_provider",
            "toVariable": provider_variable,
        }));
    }
    if let Some(signal_id) = &signal_id {
        references.push(json!({
            "type": "signal.transportBinding.targets_signal",
            "toId": format!("signal:{}", safe_id(signal_id)),
        }));
    }

    let mut names = vec!["id", "configRef", "signalId", "provider", "adapterId"];
    names.extend(live_fields.iter().copied());
    let mut source_refs = options
        .map(|value| config_source_refs(&id, value, &names, "managed transport binding"))
        .unwrap_or_default();
    if let Some(resolved) = provider_resolved {
        source_refs.push(source_ref(
            &id,
            "config",
            "provider",
            &resolved.symbol,
            &resolved.source,
            resolved.function_name.as_deref(),
            resolved.snippet.as_ref(),
        ));
    }

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "signal.transportBinding",
            name: binding_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        source_refs,
    ))
}
