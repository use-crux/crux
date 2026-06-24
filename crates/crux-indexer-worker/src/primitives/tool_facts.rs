use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::{
    primitives::data_access::{
        data_access_refs_for_config_object, data_access_refs_for_properties,
        data_access_relation_refs, primitive_data_intelligence, unique_data_accesses,
    },
    primitives::definition::{NativeDefinitionInput, native_static_definition, safe_id},
    primitives::record_values::{direct_string_property, has_property},
    primitives::routing_model::{RoutingContext, call_parts, source_ref_for_callback_property},
    primitives::routing_output::extracted_facts,
    primitives::schema::{SchemaProjection, schema_property},
    primitives::source_refs::helper_refs_for_property,
    protocol::{
        SourceLocation, SourceSnippet, StaticImportRecord, StaticInitializerRecord,
        StaticNativeFactExtractorIdentity, StaticNativeFactProjection, StaticSourceMatch,
        StaticSyntaxFileRecord, StaticSyntaxValue,
    },
};

const CALLBACK_PROPERTIES: [&str; 3] = ["execute", "run", "handler"];

struct ToolParts<'a> {
    variable_name: &'a str,
    object: &'a StaticSyntaxValue,
    source: &'a SourceLocation,
    snippet: Option<&'a SourceSnippet>,
}

/// Projects one complete first-party `tool` fact packet when the record evidence is sufficient.
pub(crate) fn project_tool_native_fact(
    file: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Option<StaticNativeFactProjection> {
    let (context, parts) = match source_match {
        StaticSourceMatch::Call { .. } => {
            let call = call_parts(source_match)?;
            if !matches!(call.callee_name, "createTool" | "tool") {
                return None;
            }
            let object = call.object_arg?;
            let context = RoutingContext::new_with_records(
                file,
                imports,
                local_initializers,
                &call,
                records_by_file,
            );
            (
                context,
                ToolParts {
                    variable_name: call.variable_name,
                    object,
                    source: call.source,
                    snippet: call.snippet,
                },
            )
        }
        StaticSourceMatch::Object {
            variable_name,
            local_name: _,
            object,
            source,
            snippet,
            local_initializers: match_initializers,
            ..
        } => {
            if !is_tool_schema_object(object) {
                return None;
            }
            let context = RoutingContext::from_initializers_with_records(
                file,
                imports,
                local_initializers,
                match_initializers,
                records_by_file,
            );
            (
                context,
                ToolParts {
                    variable_name,
                    object,
                    source,
                    snippet: snippet.as_ref(),
                },
            )
        }
        _ => return None,
    };
    let facts = tool_facts(&context, &parts)?;
    Some(StaticNativeFactProjection {
        match_index,
        replaces: vec![StaticNativeFactExtractorIdentity {
            extension: "@crux/indexer/crux-core".to_string(),
            extractor: "tool".to_string(),
        }],
        facts,
    })
}

fn tool_facts(context: &RoutingContext<'_>, parts: &ToolParts<'_>) -> Option<Value> {
    let explicit_name = direct_string_property(parts.object, "name")
        .or_else(|| direct_string_property(parts.object, "title"));
    let local_id = explicit_name
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("tool:{}", safe_id(&local_id));
    let input_schema = schema_property(context, &id, parts.object, "input")?;
    let named_input_schema = schema_property(context, &id, parts.object, "inputSchema")?;
    let parameters_schema = schema_property(context, &id, parts.object, "parameters")?;
    let selected_schema = select_schema(&input_schema, &named_input_schema, &parameters_schema);
    let data_accesses = unique_data_accesses(
        data_access_refs_for_config_object(context, parts.object)
            .into_iter()
            .chain(data_access_refs_for_properties(
                context,
                parts.object,
                &CALLBACK_PROPERTIES,
            ))
            .collect(),
    );

    let has_execute = CALLBACK_PROPERTIES
        .iter()
        .any(|property| has_property(parts.object, property));
    let has_to_model_output = has_property(parts.object, "toModelOutput");
    let name = explicit_name.unwrap_or_else(|| parts.variable_name.to_string());

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if let Some(schema) = selected_schema.cloned() {
        metadata.insert("inputSchema".to_string(), schema);
    }
    metadata.insert("hasExecute".to_string(), Value::Bool(has_execute));
    metadata.insert(
        "hasToModelOutput".to_string(),
        Value::Bool(has_to_model_output),
    );
    metadata.insert(
        "facts".to_string(),
        tool_metadata_facts(&name, has_execute, has_to_model_output),
    );
    metadata.insert(
        "intelligence".to_string(),
        tool_intelligence(selected_schema, &data_accesses),
    );

    let mut source_refs = Vec::new();
    source_refs.extend(input_schema.source_refs);
    source_refs.extend(named_input_schema.source_refs);
    source_refs.extend(parameters_schema.source_refs);
    for property in CALLBACK_PROPERTIES {
        if let Some(source_ref) = source_ref_for_callback_property(
            context,
            &id,
            parts.object,
            property,
            callback_role(property),
        )? {
            source_refs.push(source_ref);
        }
        source_refs.extend(helper_refs_for_property(
            context,
            &id,
            parts.object,
            property,
            1,
        )?);
    }

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "tool",
            name,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        data_access_relation_refs(&id, &data_accesses, "tool"),
        source_refs,
    ))
}

fn is_tool_schema_object(object: &StaticSyntaxValue) -> bool {
    direct_string_property(object, "name").is_some()
        && direct_string_property(object, "description").is_some()
        && ["input", "inputSchema", "parameters"]
            .iter()
            .any(|property| has_property(object, property))
}

fn select_schema<'a>(
    input: &'a SchemaProjection,
    named_input: &'a SchemaProjection,
    parameters: &'a SchemaProjection,
) -> Option<&'a Value> {
    input
        .schema
        .as_ref()
        .or(named_input.schema.as_ref())
        .or(parameters.schema.as_ref())
}

fn tool_metadata_facts(name: &str, has_execute: bool, has_to_model_output: bool) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("tool".to_string()));
    facts.insert("toolName".to_string(), Value::String(name.to_string()));
    facts.insert("hasExecute".to_string(), Value::Bool(has_execute));
    facts.insert(
        "hasToModelOutput".to_string(),
        Value::Bool(has_to_model_output),
    );
    Value::Object(facts)
}

fn tool_intelligence(
    schema: Option<&Value>,
    data_accesses: &[crate::primitives::data_access::DataAccessRef],
) -> Value {
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(schema) = schema {
        let mut contract = Map::new();
        contract.insert("inputSchema".to_string(), schema.clone());
        intelligence.insert("contract".to_string(), Value::Object(contract));
    }
    if let Some(data) =
        primitive_data_intelligence(data_accesses).and_then(|value| value.get("data").cloned())
    {
        intelligence.insert("data".to_string(), data);
    }
    Value::Object(intelligence)
}

fn callback_role(property: &str) -> &'static str {
    match property {
        "execute" => "execute",
        "handler" => "handler",
        _ => "callback",
    }
}
