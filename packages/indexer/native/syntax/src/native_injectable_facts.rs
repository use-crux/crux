use serde_json::{Map, Value, json};

use crate::{
    native_definition::{NativeDefinitionInput, native_static_definition, safe_id},
    native_injection::{
        relation_refs_for_injection_use, use_entries_for_property, use_entry_values,
        use_entry_variables,
    },
    native_injection_tools::{
        identifier_refs_for_property, tool_contributions_for_return_object_property,
    },
    native_record_values::{direct_string_property, property_value, resolve_static_value},
    native_routing_model::{CallParts, RoutingContext, source_ref_for_callback_property},
    native_routing_output::extracted_facts,
    native_schema::schema_property,
    native_source_refs::helper_refs_for_property,
    protocol::StaticSyntaxValue,
};

const RETURN_PROPERTIES: [&str; 5] = ["contexts", "tools", "constraints", "guardrails", "metadata"];

pub(crate) fn injectable_facts(
    context: &RoutingContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "injectable" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let local_id = explicit_id
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("injectable:{}", safe_id(&local_id));
    let input_schema = schema_property(context, &id, config, "input")?;
    let return_object = injectable_return_object(context, config);
    let contributions = return_object
        .as_ref()
        .map(|object| injectable_contributions(context, object))
        .unwrap_or_default();
    let mut source_refs = input_schema.source_refs;
    if let Some(ref_value) =
        source_ref_for_callback_property(context, &id, config, "inject", "callback")?
    {
        source_refs.push(ref_value);
    }
    source_refs.extend(helper_refs_for_property(context, &id, config, "inject", 1)?);

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if let Some(schema) = input_schema.schema.clone() {
        metadata.insert("inputSchema".to_string(), schema);
    }
    metadata.insert(
        "facts".to_string(),
        injectable_fact_metadata(
            explicit_id.as_deref(),
            &contributions.use_entry_values,
            contributions.tool_facts.clone(),
            contributions.contribution_facts.clone(),
            &contributions.may_inject,
        ),
    );
    metadata.insert(
        "intelligence".to_string(),
        injectable_intelligence(
            input_schema.schema.as_ref(),
            &contributions.context_refs,
            &contributions.tool_refs,
            &contributions.constraint_refs,
            &contributions.guardrail_refs,
        ),
    );

    let mut references =
        relation_refs_for_injection_use("injectable", &id, &contributions.use_entries);
    references.extend(
        contributions
            .tool_refs
            .iter()
            .map(|to_variable| json!({"type": "injectable.uses_tool", "fromId": id, "toVariable": to_variable})),
    );

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "injectable",
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

#[derive(Default)]
struct InjectableContributions {
    use_entries: Vec<crate::native_injection::UseEntry>,
    use_entry_values: Vec<Value>,
    context_refs: Vec<String>,
    tool_facts: Option<Value>,
    tool_refs: Vec<String>,
    contribution_facts: Option<Value>,
    constraint_refs: Vec<String>,
    guardrail_refs: Vec<String>,
    may_inject: Vec<String>,
}

fn injectable_contributions(
    context: &RoutingContext<'_>,
    object: &StaticSyntaxValue,
) -> InjectableContributions {
    let use_entries = use_entries_for_property(context, object, "contexts");
    let use_entry_values = use_entry_values(&use_entries);
    let context_refs = use_entry_variables(&use_entries);
    let tools = tool_contributions_for_return_object_property(object, "tools");
    let constraint_refs = identifier_refs_for_property(context, object, "constraints");
    let guardrail_refs = identifier_refs_for_property(context, object, "guardrails");
    let contribution_facts = contribution_facts(object, &constraint_refs, &guardrail_refs);
    InjectableContributions {
        use_entries,
        use_entry_values,
        context_refs,
        tool_facts: tools.facts,
        tool_refs: tools.references,
        contribution_facts,
        constraint_refs,
        guardrail_refs,
        may_inject: RETURN_PROPERTIES
            .iter()
            .filter(|property| property_value(object, property).is_some())
            .map(|property| property.to_string())
            .collect(),
    }
}

fn injectable_return_object<'a>(
    context: &RoutingContext<'_>,
    config: &'a StaticSyntaxValue,
) -> Option<StaticSyntaxValue> {
    let value = property_value(config, "inject")?;
    let resolved = resolve_static_value(value, &context.initializers, &mut Default::default());
    first_returned_object(resolved)
}

fn first_returned_object(value: &StaticSyntaxValue) -> Option<StaticSyntaxValue> {
    let StaticSyntaxValue::Function { returns, .. } = value else {
        return None;
    };
    for returned in returns {
        if matches!(returned, StaticSyntaxValue::Object { .. }) {
            return Some(returned.clone());
        }
        if let Some(nested) = first_returned_object(returned) {
            return Some(nested);
        }
    }
    None
}

fn contribution_facts(
    object: &StaticSyntaxValue,
    constraints: &[String],
    guardrails: &[String],
) -> Option<Value> {
    let mut facts = Map::new();
    if !constraints.is_empty() {
        facts.insert(
            "constraints".to_string(),
            json!({ "variables": constraints }),
        );
    }
    if !guardrails.is_empty() {
        facts.insert("guardrails".to_string(), json!({ "variables": guardrails }));
    }
    if let Some(metadata) = metadata_contribution(object) {
        facts.insert("metadata".to_string(), metadata);
    }
    (!facts.is_empty()).then_some(Value::Object(facts))
}

fn metadata_contribution(object: &StaticSyntaxValue) -> Option<Value> {
    let value = property_value(object, "metadata")?;
    let StaticSyntaxValue::Object { properties, .. } = value else {
        return Some(json!({ "dynamic": true }));
    };
    let keys = properties
        .iter()
        .filter(|property| property.spread != Some(true))
        .map(|property| Value::String(property.name.clone()))
        .collect::<Vec<_>>();
    let dynamic = properties
        .iter()
        .any(|property| property.spread == Some(true));
    let mut metadata = Map::new();
    if !keys.is_empty() {
        metadata.insert("keys".to_string(), Value::Array(keys));
    }
    if dynamic {
        metadata.insert("dynamic".to_string(), Value::Bool(true));
    }
    Some(Value::Object(metadata))
}

fn injectable_fact_metadata(
    explicit_id: Option<&str>,
    use_entries: &[Value],
    tool_facts: Option<Value>,
    contribution_facts: Option<Value>,
    may_inject: &[String],
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("injectable".to_string()));
    if let Some(explicit_id) = explicit_id {
        facts.insert(
            "injectableId".to_string(),
            Value::String(explicit_id.to_string()),
        );
    }
    if !use_entries.is_empty() {
        facts.insert("useEntries".to_string(), Value::Array(use_entries.to_vec()));
    }
    if let Some(tool_facts) = tool_facts {
        facts.insert("tools".to_string(), tool_facts);
    }
    if let Some(contribution_facts) = contribution_facts {
        facts.insert("contributions".to_string(), contribution_facts);
    }
    if !may_inject.is_empty() {
        facts.insert("mayInject".to_string(), json!(may_inject));
    }
    Value::Object(facts)
}

fn injectable_intelligence(
    schema: Option<&Value>,
    contexts: &[String],
    tools: &[String],
    constraints: &[String],
    guardrails: &[String],
) -> Value {
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(schema) = schema {
        intelligence.insert("contract".to_string(), json!({ "inputSchema": schema }));
    }
    if !contexts.is_empty()
        || !tools.is_empty()
        || !constraints.is_empty()
        || !guardrails.is_empty()
    {
        let mut dependencies = Map::new();
        if !contexts.is_empty() {
            dependencies.insert("contexts".to_string(), json!(contexts));
        }
        if !tools.is_empty() {
            dependencies.insert("tools".to_string(), json!(tools));
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
