use serde_json::{Map, Value, json};

use crate::{
    agent::convex::convex_agent_facts,
    agent::metadata::{
        AGENT_CALLBACK_PROPERTIES, agent_callback_source_refs, agent_fact_metadata,
        agent_intelligence,
    },
    context::{CallParts, PrimitiveContext},
    data::access::{
        data_access_refs_for_config_object, data_access_refs_for_properties,
        data_access_relation_refs, unique_data_accesses,
    },
    definition::{NativeDefinitionInput, native_static_definition, safe_id},
    injection::tools::identifier_refs_for_property,
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_identifier, direct_string_property, property_value, resolve_static_value,
    },
    routing::output::extracted_facts,
};

pub(crate) fn agent_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if let Some(facts) = convex_agent_facts(context, parts) {
        return Some(facts);
    }
    if parts.match_kind != "call"
        || parts.callee_name != "agent"
        || parts.callee_direct == Some(false)
    {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let local_id = explicit_id
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("agent:{}", safe_id(&local_id));
    let prompt_ref = property_value(config, "prompt").and_then(direct_identifier);
    let tool_refs = identifier_array_property(context, config, "tools");
    let language_model_ref = property_value(config, "languageModel").and_then(direct_identifier);
    let handoffs = handoff_ids(context, config, "handoffs");
    let constraints = identifier_refs_for_property(context, config, "constraints");
    let guardrails = identifier_refs_for_property(context, config, "guardrails");
    let data_accesses = unique_data_accesses(
        data_access_refs_for_config_object(context, config)
            .into_iter()
            .chain(data_access_refs_for_properties(
                context,
                config,
                &AGENT_CALLBACK_PROPERTIES,
            ))
            .collect(),
    );
    let source_refs = agent_callback_source_refs(context, &id, config)?;

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if let Some(tool_names) = tool_names_for_property(context, config, "tools") {
        metadata.insert("toolNames".to_string(), json!(tool_names));
    }
    metadata.insert("handoffs".to_string(), json!(handoffs));
    metadata.insert(
        "facts".to_string(),
        agent_fact_metadata(
            prompt_ref.as_deref(),
            &tool_refs,
            &handoffs,
            &constraints,
            &guardrails,
        ),
    );
    if let Some(intelligence) = agent_intelligence(
        prompt_ref.as_deref(),
        &tool_refs,
        &handoffs,
        &data_accesses,
        &constraints,
        &guardrails,
    ) {
        metadata.insert("intelligence".to_string(), intelligence);
    }

    let mut references = Vec::new();
    if let Some(prompt_ref) = prompt_ref {
        references.push(json!({"type": "agent.uses_prompt", "toVariable": prompt_ref}));
    }
    references.extend(
        tool_refs
            .iter()
            .map(|to_variable| json!({"type": "agent.uses_tool", "toVariable": to_variable})),
    );
    if let Some(language_model_ref) = language_model_ref {
        references.push(json!({
            "type": "agent.uses_routing",
            "typeByTargetKind": {
                "routing.router": "agent.uses_routing",
                "routing.cascade": "agent.uses_routing",
                "routing.fallback": "agent.uses_routing",
            },
            "toVariable": language_model_ref,
        }));
    }
    references.extend(handoffs.iter().map(
        |handoff_id| json!({"type": "agent.can_handoff_to", "toId": format!("agent:{}", safe_id(handoff_id))}),
    ));
    references.extend(constraints.iter().map(
        |from_variable| json!({"type": "constraint.applies_to", "fromVariable": from_variable, "toId": id}),
    ));
    references.extend(guardrails.iter().map(
        |from_variable| json!({"type": "guardrail.applies_to", "fromVariable": from_variable, "toId": id}),
    ));
    references.extend(data_access_relation_refs(&id, &data_accesses, "agent"));

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "agent",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        source_refs,
    ))
}

fn identifier_array_property(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    property: &str,
) -> Vec<String> {
    let Some(value) = property_value(object, property) else {
        return Vec::new();
    };
    match resolve_static_value(value, &context.initializers, &mut Default::default()) {
        StaticSyntaxValue::Array { elements } => {
            elements.iter().filter_map(direct_identifier).collect()
        }
        _ => Vec::new(),
    }
}

fn tool_names_for_property(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    property: &str,
) -> Option<Vec<String>> {
    let value = property_value(object, property)?;
    match resolve_static_value(value, &context.initializers, &mut Default::default()) {
        StaticSyntaxValue::Array { elements } => {
            let names = elements
                .iter()
                .filter_map(direct_identifier)
                .collect::<Vec<_>>();
            (!names.is_empty()).then_some(names)
        }
        StaticSyntaxValue::Object { properties, .. } => {
            let names = properties
                .iter()
                .filter(|property| property.spread != Some(true))
                .map(|property| property.name.clone())
                .collect::<Vec<_>>();
            (!names.is_empty()).then_some(names)
        }
        _ => None,
    }
}

fn handoff_ids(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    property: &str,
) -> Vec<String> {
    let Some(value) = property_value(object, property) else {
        return Vec::new();
    };
    match resolve_static_value(value, &context.initializers, &mut Default::default()) {
        StaticSyntaxValue::Array { elements } => elements
            .iter()
            .filter_map(|element| match element {
                StaticSyntaxValue::Literal {
                    value: LiteralValue::String(value),
                } => Some(value.clone()),
                StaticSyntaxValue::Object { .. } => direct_string_property(element, "id"),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}
