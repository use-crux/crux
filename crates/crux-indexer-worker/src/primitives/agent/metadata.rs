use serde_json::{Map, Value, json};

use crate::{
    primitives::data::access::{DataAccessRef, primitive_data_intelligence},
    primitives::routing::model::RoutingContext,
    primitives::source_refs::helper_refs_for_property,
    protocol::StaticSyntaxValue,
};

pub(crate) const AGENT_CALLBACK_PROPERTIES: [&str; 5] = [
    "handler",
    "run",
    "execute",
    "contextHandler",
    "usageHandler",
];

pub(crate) fn callback_role(property: &str) -> &'static str {
    match property {
        "handler" => "handler",
        "execute" => "execute",
        _ => "callback",
    }
}

pub(crate) fn agent_callback_source_refs(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
) -> Option<Vec<Value>> {
    let mut source_refs = Vec::new();
    for property in AGENT_CALLBACK_PROPERTIES {
        if let Some(ref_value) =
            crate::primitives::routing::model::source_ref_for_callback_property(
                context,
                definition_id,
                object,
                property,
                callback_role(property),
            )?
        {
            source_refs.push(ref_value);
        }
        source_refs.extend(helper_refs_for_property(
            context,
            definition_id,
            object,
            property,
            1,
        )?);
    }
    Some(source_refs)
}

pub(crate) fn agent_fact_metadata(
    prompt_ref: Option<&str>,
    tool_refs: &[String],
    handoffs: &[String],
    constraints: &[String],
    guardrails: &[String],
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("agent".to_string()));
    if let Some(prompt_ref) = prompt_ref {
        facts.insert(
            "promptId".to_string(),
            Value::String(prompt_ref.to_string()),
        );
    }
    if !tool_refs.is_empty() {
        facts.insert("toolNames".to_string(), json!(tool_refs));
    }
    if !handoffs.is_empty() {
        facts.insert("handoffs".to_string(), json!(handoffs));
    }
    if !constraints.is_empty() {
        facts.insert("constraints".to_string(), json!(constraints));
    }
    if !guardrails.is_empty() {
        facts.insert("guardrails".to_string(), json!(guardrails));
    }
    Value::Object(facts)
}

pub(crate) fn agent_intelligence(
    prompt_ref: Option<&str>,
    tool_refs: &[String],
    handoffs: &[String],
    data_accesses: &[DataAccessRef],
    constraints: &[String],
    guardrails: &[String],
) -> Option<Value> {
    let data =
        primitive_data_intelligence(data_accesses).and_then(|value| value.get("data").cloned());
    if prompt_ref.is_none()
        && tool_refs.is_empty()
        && handoffs.is_empty()
        && constraints.is_empty()
        && guardrails.is_empty()
        && data.is_none()
    {
        return None;
    }
    let mut dependencies = Map::new();
    if let Some(prompt_ref) = prompt_ref {
        dependencies.insert("prompt".to_string(), Value::String(prompt_ref.to_string()));
        dependencies.insert("prompts".to_string(), json!([prompt_ref]));
    }
    if !tool_refs.is_empty() {
        dependencies.insert("tools".to_string(), json!(tool_refs));
    }
    if !handoffs.is_empty() {
        dependencies.insert("handoffs".to_string(), json!(handoffs));
        dependencies.insert("agents".to_string(), json!(handoffs));
    }
    if !constraints.is_empty() {
        dependencies.insert("constraints".to_string(), json!(constraints));
    }
    if !guardrails.is_empty() {
        dependencies.insert("guardrails".to_string(), json!(guardrails));
    }
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    intelligence.insert(
        "control".to_string(),
        json!({"mode": if handoffs.is_empty() { "immediate" } else { "event-driven" }, "ordering": "event-driven"}),
    );
    intelligence.insert("dependencies".to_string(), Value::Object(dependencies));
    if let Some(data) = data {
        intelligence.insert("data".to_string(), data);
    }
    Some(Value::Object(intelligence))
}
