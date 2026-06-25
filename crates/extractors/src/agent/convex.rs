use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{
        NativeDefinitionInput, native_static_definition, safe_id, source_ref_with_metadata,
    },
    protocol::StaticSyntaxValue,
    record_values::{
        direct_identifier, direct_string_property, has_property, object_map_identifier_entries,
        property_value, resolve_static_value,
    },
    routing::output::extracted_facts,
    source_refs::{helper_refs_for_property, property_source_ref},
};

const CONVEX_CALLBACK_PROPERTIES: [&str; 3] = ["usageHandler", "contextHandler", "prepare"];

pub(crate) fn convex_agent_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if !is_convex_agent_match(parts) {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_name = direct_string_property(config, "name");
    let local_id = explicit_name
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("agent:{}", safe_id(&local_id));
    let tool_refs =
        object_map_identifier_entries(property_value(config, "tools"), &context.initializers)
            .into_iter()
            .map(|(_, value)| value)
            .collect::<Vec<_>>();
    let prompt_ref = property_value(config, "prompt")
        .and_then(direct_identifier)
        .or_else(|| prompt_ref_from_resolve_call(context, config));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert(
        "runtime".to_string(),
        Value::String("convex-agent".to_string()),
    );
    metadata.insert("hasTools".to_string(), json!(has_property(config, "tools")));
    metadata.insert(
        "hasContextHandler".to_string(),
        json!(has_property(config, "contextHandler")),
    );
    metadata.insert(
        "hasUsageHandler".to_string(),
        json!(has_property(config, "usageHandler")),
    );
    metadata.insert(
        "hasPrepare".to_string(),
        json!(has_property(config, "prepare")),
    );
    if has_property(config, "maxSteps") {
        metadata.insert(
            "maxSteps".to_string(),
            Value::String("configured".to_string()),
        );
    }

    let mut references = Vec::new();
    references.extend(
        tool_refs
            .iter()
            .map(|to_variable| json!({"type": "agent.uses_tool", "toVariable": to_variable})),
    );
    if let Some(prompt_ref) = prompt_ref {
        references.push(json!({"type": "agent.uses_prompt", "toVariable": prompt_ref}));
    }

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "agent",
            name: explicit_name.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        convex_agent_source_refs(context, &id, config)?,
    ))
}

fn is_convex_agent_match(parts: &CallParts<'_>) -> bool {
    (parts.match_kind == "call" && parts.callee_name == "convexAgent")
        || (parts.callee_direct != Some(false)
            && parts.match_kind == "new"
            && parts.callee_name == "Agent")
}

fn prompt_ref_from_resolve_call(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
) -> Option<String> {
    let value = property_value(object, "languageModel")?;
    let resolved = resolve_static_value(value, &context.initializers, &mut Default::default());
    let StaticSyntaxValue::Call { callee, args, .. } = resolved else {
        return None;
    };
    let call_name = callee.local_name.as_deref().unwrap_or(&callee.name);
    if call_name != "resolve" {
        return None;
    }
    args.first().and_then(direct_identifier)
}

fn convex_agent_source_refs(
    context: &PrimitiveContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
) -> Option<Vec<Value>> {
    let mut refs = Vec::new();
    for property in ["prompt", "tools"] {
        if let Some(ref_value) = property_source_ref(
            context,
            definition_id,
            object,
            property,
            "config",
            None,
            false,
        )? {
            refs.push(ref_value);
        }
    }
    for property in CONVEX_CALLBACK_PROPERTIES {
        if let Some(ref_value) = property_source_ref(
            context,
            definition_id,
            object,
            property,
            "callback",
            None,
            true,
        )? {
            refs.push(ref_value);
        }
    }
    refs.extend(tool_map_contributor_refs(context, definition_id, object)?);
    for property in ["tools", "usageHandler", "contextHandler", "prepare"] {
        refs.extend(helper_refs_for_property(
            context,
            definition_id,
            object,
            property,
            1,
        )?);
    }
    Some(refs)
}

fn tool_map_contributor_refs(
    context: &PrimitiveContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
) -> Option<Vec<Value>> {
    let Some(tools) = context.resolve_record_source(property_value(object, "tools"))? else {
        return Some(Vec::new());
    };
    let StaticSyntaxValue::Object { properties, .. } = tools.value else {
        return Some(Vec::new());
    };
    let mut refs = Vec::new();
    for property in properties {
        let Some(name) = direct_identifier(&property.value) else {
            continue;
        };
        let identifier = StaticSyntaxValue::Identifier { name };
        let Some(resolved) = context.resolve_record_source(Some(&identifier))? else {
            continue;
        };
        refs.push(source_ref_with_metadata(
            definition_id,
            "config",
            "tools",
            &resolved.symbol,
            &resolved.source,
            resolved.function_name.as_deref(),
            resolved.snippet.as_ref(),
            Some(json!({"toolMapContributor": if property.spread == Some(true) { "spread" } else { "property" }})),
        ));
    }
    Some(refs)
}
