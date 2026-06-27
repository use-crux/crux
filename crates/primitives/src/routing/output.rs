use serde_json::{Map, Value, json};

pub(crate) fn extracted_facts(
    variable_name: &str,
    definition: Value,
    extra_definitions: Vec<Value>,
    references: Vec<Value>,
    source_refs: Vec<Value>,
) -> Value {
    let mut primary = Map::new();
    primary.insert(
        "variableName".to_string(),
        Value::String(variable_name.to_string()),
    );
    primary.insert("definition".to_string(), definition);
    if !extra_definitions.is_empty() {
        primary.insert(
            "extraDefinitions".to_string(),
            Value::Array(extra_definitions),
        );
    }
    json!({
        "definitions": [Value::Object(primary)],
        "references": references,
        "sourceRefs": source_refs,
    })
}

pub(crate) fn routing_target_relation_refs(
    from_id: &str,
    target: Option<&str>,
    owner: &str,
) -> Vec<Value> {
    let Some(target) = target else {
        return Vec::new();
    };
    let (router, cascade, fallback, agent, prompt) = match owner {
        "router.route" => (
            "router.route.uses_router",
            "router.route.uses_cascade",
            "router.route.uses_fallback",
            "router.route.uses_agent",
            "router.route.uses_prompt",
        ),
        "cascade.tier" => (
            "cascade.tier.uses_router",
            "cascade.tier.uses_cascade",
            "cascade.tier.uses_fallback",
            "cascade.tier.uses_agent",
            "cascade.tier.uses_prompt",
        ),
        _ => (
            "fallback.option.uses_router",
            "fallback.option.uses_cascade",
            "fallback.option.uses_fallback",
            "fallback.option.uses_agent",
            "fallback.option.uses_prompt",
        ),
    };
    vec![json!({
        "type": router,
        "typeByTargetKind": {
            "routing.router": router,
            "routing.cascade": cascade,
            "routing.fallback": fallback,
            "agent": agent,
            "prompt": prompt,
        },
        "fromId": from_id,
        "toVariable": target,
    })]
}

pub(crate) fn child_facts_with_target(
    kind: &str,
    parent_definition_id: &str,
    routing_id: &str,
    index_key: &str,
    index: usize,
    target_variable: Option<&str>,
    extra: Option<(&str, Value)>,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String(kind.to_string()));
    facts.insert(
        "parentDefinitionId".to_string(),
        Value::String(parent_definition_id.to_string()),
    );
    facts.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    facts.insert(index_key.to_string(), json!(index));
    if let Some(target_variable) = target_variable {
        facts.insert(
            "targetVariable".to_string(),
            Value::String(target_variable.to_string()),
        );
    }
    if let Some((key, value)) = extra {
        facts.insert(key.to_string(), value);
    }
    Value::Object(facts)
}

pub(crate) fn fallback_option_facts(
    parent_definition_id: &str,
    routing_id: Option<&str>,
    index: usize,
    target_variable: Option<&str>,
) -> Value {
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("routing.fallback.option".to_string()),
    );
    facts.insert(
        "parentDefinitionId".to_string(),
        Value::String(parent_definition_id.to_string()),
    );
    if let Some(routing_id) = routing_id {
        facts.insert(
            "routingId".to_string(),
            Value::String(routing_id.to_string()),
        );
    }
    facts.insert("optionIndex".to_string(), json!(index));
    if let Some(target_variable) = target_variable {
        facts.insert(
            "targetVariable".to_string(),
            Value::String(target_variable.to_string()),
        );
    }
    Value::Object(facts)
}

pub(crate) fn fallback_parent_facts(
    routing_id: Option<&str>,
    has_stable_id: bool,
    option_count: usize,
) -> Value {
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("routing.fallback".to_string()),
    );
    if let Some(routing_id) = routing_id {
        facts.insert(
            "routingId".to_string(),
            Value::String(routing_id.to_string()),
        );
    }
    facts.insert("hasStableId".to_string(), Value::Bool(has_stable_id));
    facts.insert("optionCount".to_string(), json!(option_count));
    Value::Object(facts)
}

pub(crate) fn insert_number(metadata: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), json!(value));
    }
}

pub(crate) fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

pub(crate) fn metadata_bool(metadata: &Map<String, Value>, key: &str) -> bool {
    metadata.get(key).and_then(Value::as_bool).unwrap_or(false)
}
