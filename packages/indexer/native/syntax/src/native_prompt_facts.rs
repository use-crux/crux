use serde_json::{Map, Value, json};

use crate::{
    native_data_access::{
        data_access_refs_for_properties, data_access_relation_refs, primitive_data_intelligence,
    },
    native_definition::{NativeDefinitionInput, native_static_definition, safe_id},
    native_injection::{
        relation_refs_for_injection_use, use_entries_for_property, use_entry_values,
        use_entry_variables,
    },
    native_injection_tools::{identifier_refs_for_property, tool_contributions_for_property},
    native_record_values::{direct_string_property, has_property},
    native_routing_model::{CallParts, RoutingContext, source_ref_for_callback_property},
    native_routing_output::extracted_facts,
    native_schema::schema_property,
    native_source_refs::{
        helper_refs_for_property, property_source_ref, template_interpolation_source_refs,
    },
};

const CALLBACK_PROPERTIES: [&str; 3] = ["prompt", "system", "tools"];

pub(crate) fn prompt_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "prompt" {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let local_id = explicit_id
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("prompt:{}", safe_id(&local_id));
    let input_schema = schema_property(context, &id, config, "input")?;
    let output_schema = schema_property(context, &id, config, "output")?;
    let data_accesses = data_access_refs_for_properties(context, config, &CALLBACK_PROPERTIES);
    let use_entries = use_entries_for_property(context, config, "use");
    let used_contexts = use_entry_variables(&use_entries);
    let use_entry_values = use_entry_values(&use_entries);
    let used_constraints = identifier_refs_for_property(context, config, "constraints");
    let used_guardrails = identifier_refs_for_property(context, config, "guardrails");
    let tools = tool_contributions_for_property(context, config, "tools");
    let mut source_refs = input_schema.source_refs;
    source_refs.extend(output_schema.source_refs);
    source_refs.extend(prompt_callback_refs(context, &id, config)?);
    source_refs.extend(template_interpolation_source_refs(
        context, &id, config, "system", "system",
    )?);
    for property in CALLBACK_PROPERTIES {
        source_refs.extend(helper_refs_for_property(context, &id, config, property, 1)?);
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if let Some(schema) = input_schema.schema.clone() {
        metadata.insert("inputSchema".to_string(), schema);
    }
    if let Some(schema) = output_schema.schema.clone() {
        metadata.insert("outputSchema".to_string(), schema);
    }
    metadata.insert(
        "hasOutput".to_string(),
        Value::Bool(has_property(config, "output")),
    );
    metadata.insert(
        "facts".to_string(),
        prompt_fact_metadata(
            config,
            &used_contexts,
            &use_entry_values,
            tools.facts.clone(),
            &used_constraints,
            &used_guardrails,
        ),
    );
    metadata.insert(
        "intelligence".to_string(),
        prompt_intelligence(
            input_schema.schema.as_ref(),
            output_schema.schema.as_ref(),
            &data_accesses,
            &used_contexts,
            &tools.references,
            &used_constraints,
            &used_guardrails,
        ),
    );

    let mut references = relation_refs_for_injection_use("prompt", &id, &use_entries);
    references.extend(tools.references.iter().map(
        |to_variable| json!({"type": "prompt.uses_tool", "fromId": id, "toVariable": to_variable}),
    ));
    references.extend(used_constraints.iter().map(
        |from_variable| json!({"type": "constraint.applies_to", "fromVariable": from_variable, "toId": id}),
    ));
    references.extend(used_guardrails.iter().map(
        |from_variable| json!({"type": "guardrail.applies_to", "fromVariable": from_variable, "toId": id}),
    ));
    references.extend(data_access_relation_refs(&id, &data_accesses, "prompt"));

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "prompt",
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

fn prompt_callback_refs(
    context: &RoutingContext<'_>,
    id: &str,
    config: &crate::protocol::StaticSyntaxValue,
) -> Option<Vec<Value>> {
    let mut refs = Vec::new();
    if let Some(ref_value) =
        source_ref_for_callback_property(context, id, config, "prompt", "prompt")?
    {
        refs.push(ref_value);
    }
    if let Some(ref_value) = system_source_ref(context, id, config)? {
        refs.push(ref_value);
    }
    Some(refs)
}

fn system_source_ref(
    context: &RoutingContext<'_>,
    id: &str,
    config: &crate::protocol::StaticSyntaxValue,
) -> Option<Option<Value>> {
    let property = property_source_ref(
        context,
        id,
        config,
        "system",
        "system",
        Some(json!({"fragment": true})),
        false,
    )?;
    if property.is_some() {
        return Some(property);
    }
    source_ref_for_callback_property(context, id, config, "system", "system")
}

fn prompt_fact_metadata(
    config: &crate::protocol::StaticSyntaxValue,
    used_contexts: &[String],
    use_entries: &[Value],
    tool_facts: Option<Value>,
    constraints: &[String],
    guardrails: &[String],
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("prompt".to_string()));
    facts.insert("use".to_string(), json!(used_contexts));
    if !use_entries.is_empty() {
        facts.insert("useEntries".to_string(), Value::Array(use_entries.to_vec()));
    }
    if let Some(tool_facts) = tool_facts {
        facts.insert("tools".to_string(), tool_facts);
    }
    if !constraints.is_empty() {
        facts.insert("constraints".to_string(), json!(constraints));
    }
    if !guardrails.is_empty() {
        facts.insert("guardrails".to_string(), json!(guardrails));
    }
    facts.insert(
        "hasSystem".to_string(),
        Value::Bool(has_property(config, "system")),
    );
    facts.insert(
        "hasPrompt".to_string(),
        Value::Bool(has_property(config, "prompt")),
    );
    facts.insert(
        "hasMessages".to_string(),
        Value::Bool(has_property(config, "messages")),
    );
    facts.insert(
        "hasTests".to_string(),
        Value::Bool(has_property(config, "tests")),
    );
    Value::Object(facts)
}

fn prompt_intelligence(
    input_schema: Option<&Value>,
    output_schema: Option<&Value>,
    data_accesses: &[crate::native_data_access::DataAccessRef],
    used_contexts: &[String],
    tool_refs: &[String],
    constraints: &[String],
    guardrails: &[String],
) -> Value {
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if input_schema.is_some() || output_schema.is_some() {
        let mut contract = Map::new();
        if let Some(schema) = input_schema {
            contract.insert("inputSchema".to_string(), schema.clone());
        }
        if let Some(schema) = output_schema {
            contract.insert("outputSchema".to_string(), schema.clone());
        }
        intelligence.insert("contract".to_string(), Value::Object(contract));
    }
    if let Some(data) =
        primitive_data_intelligence(data_accesses).and_then(|value| value.get("data").cloned())
    {
        intelligence.insert("data".to_string(), data);
    }
    if !used_contexts.is_empty()
        || !tool_refs.is_empty()
        || !constraints.is_empty()
        || !guardrails.is_empty()
    {
        let mut dependencies = Map::new();
        if !used_contexts.is_empty() {
            dependencies.insert("contexts".to_string(), json!(used_contexts));
        }
        if !tool_refs.is_empty() {
            dependencies.insert("tools".to_string(), json!(tool_refs));
        }
        if !constraints.is_empty() {
            dependencies.insert("constraints".to_string(), json!(constraints));
        }
        if !guardrails.is_empty() {
            dependencies.insert("guardrails".to_string(), json!(guardrails));
        }
        intelligence.insert("dependencies".to_string(), Value::Object(dependencies));
    }
    Value::Object(intelligence)
}
