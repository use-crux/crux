use serde_json::{Map, Value, json};

use crate::{
    extractors::context::{CallParts, PrimitiveContext, source_ref_for_callback_property},
    extractors::data::access::{
        data_access_refs_for_properties, data_access_relation_refs, primitive_data_intelligence,
    },
    extractors::definition::{NativeDefinitionInput, native_static_definition, safe_id},
    extractors::injection::model::{
        relation_refs_for_injection_use, use_entries_for_property, use_entry_values,
        use_entry_variables,
    },
    extractors::injection::tools::tool_contributions_for_property,
    extractors::record_values::{direct_string_property, has_property},
    extractors::routing::output::extracted_facts,
    extractors::schema::schema_property,
    extractors::source_refs::{
        helper_refs_for_property, property_source_ref, template_interpolation_source_refs,
    },
};

const CALLBACK_PROPERTIES: [&str; 6] = ["resolve", "render", "handler", "when", "system", "tools"];

pub(crate) fn context_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "context" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let local_id = explicit_id
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("context:{}", safe_id(&local_id));
    let input_schema = schema_property(context, &id, config, "input")?;
    let data_accesses = data_access_refs_for_properties(context, config, &CALLBACK_PROPERTIES);
    let use_entries = use_entries_for_property(context, config, "use");
    let used_contexts = use_entry_variables(&use_entries);
    let use_entry_values = use_entry_values(&use_entries);
    let tools = tool_contributions_for_property(context, config, "tools");
    let is_static = !has_property(config, "input");
    let mut source_refs = input_schema.source_refs;
    source_refs.extend(context_callback_refs(context, &id, config)?);
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
    metadata.insert("isStatic".to_string(), Value::Bool(is_static));
    metadata.insert(
        "facts".to_string(),
        context_fact_metadata(
            is_static,
            &used_contexts,
            &use_entry_values,
            tools.facts.clone(),
        ),
    );
    metadata.insert(
        "intelligence".to_string(),
        context_intelligence(
            input_schema.schema.as_ref(),
            &data_accesses,
            &used_contexts,
            &tools.references,
        ),
    );

    let mut references = relation_refs_for_injection_use("context", &id, &use_entries);
    references.extend(tools.references.iter().map(
        |to_variable| json!({"type": "context.uses_tool", "fromId": id, "toVariable": to_variable}),
    ));
    references.extend(data_access_relation_refs(&id, &data_accesses, "context"));

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "context",
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

fn context_callback_refs(
    context: &PrimitiveContext<'_>,
    id: &str,
    config: &crate::protocol::StaticSyntaxValue,
) -> Option<Vec<Value>> {
    let mut refs = Vec::new();
    for (property, role) in [
        ("resolve", "resolver"),
        ("render", "callback"),
        ("handler", "handler"),
        ("when", "policy"),
    ] {
        if let Some(ref_value) =
            source_ref_for_callback_property(context, id, config, property, role)?
        {
            refs.push(ref_value);
        }
    }
    if let Some(ref_value) = system_source_ref(context, id, config)? {
        refs.push(ref_value);
    }
    Some(refs)
}

fn system_source_ref(
    context: &PrimitiveContext<'_>,
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

fn context_fact_metadata(
    is_static: bool,
    used_contexts: &[String],
    use_entries: &[Value],
    tool_facts: Option<Value>,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("context".to_string()));
    if !used_contexts.is_empty() {
        facts.insert("use".to_string(), json!(used_contexts));
    }
    if !use_entries.is_empty() {
        facts.insert("useEntries".to_string(), Value::Array(use_entries.to_vec()));
    }
    facts.insert("isStatic".to_string(), Value::Bool(is_static));
    if let Some(tool_facts) = tool_facts {
        facts.insert("tools".to_string(), tool_facts);
    }
    Value::Object(facts)
}

fn context_intelligence(
    schema: Option<&Value>,
    data_accesses: &[crate::extractors::data::access::DataAccessRef],
    used_contexts: &[String],
    tool_refs: &[String],
) -> Value {
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(schema) = schema {
        intelligence.insert("contract".to_string(), json!({ "inputSchema": schema }));
    }
    if let Some(data) =
        primitive_data_intelligence(data_accesses).and_then(|value| value.get("data").cloned())
    {
        intelligence.insert("data".to_string(), data);
    }
    if !used_contexts.is_empty() || !tool_refs.is_empty() {
        let mut dependencies = Map::new();
        if !used_contexts.is_empty() {
            dependencies.insert("contexts".to_string(), json!(used_contexts));
        }
        if !tool_refs.is_empty() {
            dependencies.insert("tools".to_string(), json!(tool_refs));
        }
        intelligence.insert("dependencies".to_string(), Value::Object(dependencies));
    }
    Value::Object(intelligence)
}
