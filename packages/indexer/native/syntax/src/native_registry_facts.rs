use serde_json::{Map, Value, json};

use crate::{
    native_definition::{NativeDefinitionInput, native_static_definition, safe_id},
    native_record_values::{direct_identifier, direct_string_property, has_property},
    native_routing_model::{
        CallParts, RoutingContext, source_ref_for_callback_property, source_ref_for_static_property,
    },
    native_routing_output::{extracted_facts, insert_string},
    protocol::StaticSyntaxValue,
};

pub(crate) fn registry_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "registry" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let registry_name = direct_string_property(config, "name")?;
    let id = format!("registry:{}", safe_id(&registry_name));
    let base_url = direct_string_property(config, "baseUrl");
    let has_auth = has_property(config, "auth");

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("registry".to_string()));
    facts.insert(
        "registryName".to_string(),
        Value::String(registry_name.clone()),
    );
    insert_string(&mut facts, "baseUrl", base_url.clone());
    facts.insert("hasAuth".to_string(), Value::Bool(has_auth));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    insert_string(&mut metadata, "baseUrl", base_url);
    metadata.insert("hasAuth".to_string(), Value::Bool(has_auth));
    metadata.insert("facts".to_string(), Value::Object(facts));

    let source_refs = [
        source_ref_for_static_property(context, &id, config, "name", "config"),
        source_ref_for_static_property(context, &id, config, "baseUrl", "config"),
        source_ref_for_callback_property(context, &id, config, "auth", "callback"),
    ]
    .into_iter()
    .collect::<Option<Vec<_>>>()?
    .into_iter()
    .flatten()
    .collect();

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "registry",
            name: registry_name,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        source_refs,
    ))
}

pub(crate) fn registry_skill_facts(
    context: &RoutingContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "fromRegistry" {
        return None;
    }
    let registry_variable = parts.args.first().and_then(direct_identifier)?;
    let registry_path = parts.args.get(1).and_then(string_argument)?;
    let bundled = bundled_registry_for_variable(&registry_variable);
    let registry_name = bundled
        .as_ref()
        .map(|item| item.name.to_string())
        .or_else(|| registry_name_for_variable(context, &registry_variable))
        .unwrap_or_else(|| registry_variable.clone());
    let identifier = format!("{registry_name}:{registry_path}");
    let id = format!("skill:{}", safe_id(&identifier));

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("skill".to_string()));
    facts.insert("loader".to_string(), Value::String("registry".to_string()));
    facts.insert("identifier".to_string(), Value::String(identifier.clone()));
    facts.insert(
        "registryName".to_string(),
        Value::String(registry_name.clone()),
    );
    facts.insert(
        "registryPath".to_string(),
        Value::String(registry_path.clone()),
    );
    facts.insert(
        "registryVariable".to_string(),
        Value::String(registry_variable.clone()),
    );

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("loader".to_string(), Value::String("registry".to_string()));
    metadata.insert("identifier".to_string(), Value::String(identifier.clone()));
    metadata.insert(
        "registryName".to_string(),
        Value::String(registry_name.clone()),
    );
    metadata.insert(
        "registryPath".to_string(),
        Value::String(registry_path.clone()),
    );
    metadata.insert(
        "registryVariable".to_string(),
        Value::String(registry_variable.clone()),
    );
    metadata.insert("facts".to_string(), Value::Object(facts));

    let extra_definitions = bundled
        .as_ref()
        .map(|item| bundled_registry_definition(context, parts, &registry_variable, item))
        .into_iter()
        .collect::<Vec<_>>();
    let references = vec![match bundled {
        Some(item) => json!({ "type": "skill.uses_registry", "toId": item.id }),
        None => json!({ "type": "skill.uses_registry", "toVariable": registry_variable }),
    }];

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "skill",
            name: identifier,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        extra_definitions,
        references,
        Vec::new(),
    ))
}

struct BundledRegistry {
    id: &'static str,
    name: &'static str,
}

fn bundled_registry_for_variable(registry_variable: &str) -> Option<BundledRegistry> {
    (registry_variable == "skillsSh").then_some(BundledRegistry {
        id: "registry:skills.sh",
        name: "skills.sh",
    })
}

fn bundled_registry_definition(
    context: &RoutingContext<'_>,
    parts: &CallParts<'_>,
    registry_variable: &str,
    bundled: &BundledRegistry,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("registry".to_string()));
    facts.insert(
        "registryName".to_string(),
        Value::String(bundled.name.to_string()),
    );
    facts.insert("bundled".to_string(), Value::Bool(true));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(registry_variable.to_string()),
    );
    metadata.insert("bundled".to_string(), Value::Bool(true));
    metadata.insert("facts".to_string(), Value::Object(facts));

    native_static_definition(NativeDefinitionInput {
        id: bundled.id.to_string(),
        kind: "registry",
        name: bundled.name.to_string(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    })
}

fn registry_name_for_variable(
    context: &RoutingContext<'_>,
    registry_variable: &str,
) -> Option<String> {
    let initializer = context.initializers.get(registry_variable)?;
    match &initializer.value {
        StaticSyntaxValue::Call { callee, args, .. } if callee.name == "registry" => args
            .first()
            .and_then(|value| direct_string_property(value, "name")),
        _ => None,
    }
}

fn string_argument(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Literal {
            value: crate::protocol::LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}
