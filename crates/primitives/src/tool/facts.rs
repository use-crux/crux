use serde_json::{Map, Value};

use crate::{
    context::{PrimitiveContext, call_parts, source_ref_for_callback_property},
    data::access::{
        data_access_refs_for_config_object, data_access_refs_for_properties,
        data_access_relation_refs, primitive_data_intelligence, unique_data_accesses,
    },
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    manifest::CustomProjectionInput,
    protocol::{SourceLocation, SourceSnippet, StaticSourceMatch, StaticSyntaxValue},
    record_values::{direct_string_property, has_property},
    routing::output::extracted_facts,
    schema::{SchemaProjection, schema_property},
    source_refs::helper_refs_for_property,
};

const CALLBACK_PROPERTIES: [&str; 3] = ["execute", "run", "handler"];

struct ToolParts<'a> {
    variable_name: &'a str,
    object: &'a StaticSyntaxValue,
    source: &'a SourceLocation,
    snippet: Option<&'a SourceSnippet>,
}

/// Projects the facts for one complete first-party `tool` packet.
///
/// The `tool` primitive matches both a `createTool`/`tool` call and a bare
/// tool-schema object, so it owns its own match handling behind the manifest's
/// custom-handler entry. The manifest stamps the `tool` extractor identity.
pub(crate) fn tool_native_facts(input: &CustomProjectionInput<'_>) -> Option<Value> {
    let (context, parts) = match input.source_match {
        StaticSourceMatch::Call { .. } => {
            let call = call_parts(input.source_match)?;
            if !matches!(call.callee_name, "createTool" | "tool") {
                return None;
            }
            let object = call.object_arg?;
            let context = PrimitiveContext::new_with_records(
                input.file,
                input.imports,
                input.local_initializers,
                &call,
                input.records_by_file,
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
            let context = PrimitiveContext::from_initializers_with_records(
                input.file,
                input.imports,
                input.local_initializers,
                match_initializers,
                input.records_by_file,
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
    tool_facts(&context, &parts)
}

fn tool_facts(context: &PrimitiveContext<'_>, parts: &ToolParts<'_>) -> Option<Value> {
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
        static_index_definition(NativeDefinitionInput {
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
    data_accesses: &[crate::data::access::DataAccessRef],
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
