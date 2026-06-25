use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value, json};

use crate::{
    context::PrimitiveContext,
    protocol::StaticSyntaxValue,
    record_values::{direct_identifier, property_value, resolve_static_value},
};

pub(crate) struct ToolContributions {
    pub facts: Option<Value>,
    pub references: Vec<String>,
}

pub(crate) fn tool_contributions_for_property(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    property: &str,
) -> ToolContributions {
    property_value(object, property)
        .map(|value| tool_contributions_from_value(context, value))
        .unwrap_or_else(|| ToolContributions {
            facts: None,
            references: Vec::new(),
        })
}

pub(crate) fn tool_contributions_for_return_object_property(
    object: &StaticSyntaxValue,
    property: &str,
) -> ToolContributions {
    let Some(value) = property_value(object, property) else {
        return ToolContributions {
            facts: None,
            references: Vec::new(),
        };
    };
    if matches!(value, StaticSyntaxValue::Object { .. }) {
        return tool_contributions_from_object(value, false);
    }
    dynamic_tool_contributions()
}

pub(crate) fn identifier_refs_for_property(
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
        StaticSyntaxValue::Identifier { name } => vec![name.clone()],
        _ => Vec::new(),
    }
}

fn tool_contributions_from_value(
    context: &PrimitiveContext<'_>,
    value: &StaticSyntaxValue,
) -> ToolContributions {
    match resolve_static_value(value, &context.initializers, &mut Default::default()) {
        StaticSyntaxValue::Object { .. } => tool_contributions_from_object(
            resolve_static_value(value, &context.initializers, &mut Default::default()),
            false,
        ),
        StaticSyntaxValue::Call { callee, .. } => tool_contributions_from_factory_call(
            context,
            callee.local_name.as_deref().unwrap_or(&callee.name),
            &mut HashSet::new(),
        ),
        StaticSyntaxValue::Identifier { name } => ToolContributions {
            facts: Some(json!({"hasTools": true, "variables": [name]})),
            references: vec![name.clone()],
        },
        _ => ToolContributions {
            facts: Some(json!({"hasTools": true, "dynamic": true})),
            references: Vec::new(),
        },
    }
}

fn tool_contributions_from_factory_call(
    context: &PrimitiveContext<'_>,
    call_name: &str,
    seen: &mut HashSet<String>,
) -> ToolContributions {
    let key = format!("{}:{call_name}", context.file);
    if !seen.insert(key) {
        return dynamic_tool_contributions();
    }
    let identifier = StaticSyntaxValue::Identifier {
        name: call_name.to_string(),
    };
    let Some(Some(resolved)) = context.resolve_record_source(Some(&identifier)) else {
        return dynamic_tool_contributions();
    };
    let StaticSyntaxValue::Function {
        returns,
        local_initializers,
        ..
    } = resolved.value
    else {
        return dynamic_tool_contributions();
    };
    let helper_initializers = local_initializers
        .iter()
        .map(|initializer| (initializer.name.as_str(), initializer))
        .collect::<HashMap<_, _>>();
    let object = returns
        .iter()
        .filter_map(|value| {
            let resolved =
                resolve_static_value(value, &helper_initializers, &mut Default::default());
            matches!(resolved, StaticSyntaxValue::Object { .. }).then_some(resolved)
        })
        .max_by_key(|value| match value {
            StaticSyntaxValue::Object { properties, .. } => properties.len(),
            _ => 0,
        });
    object
        .map(|object| tool_contributions_from_object(object, true))
        .unwrap_or_else(dynamic_tool_contributions)
}

fn tool_contributions_from_object(object: &StaticSyntaxValue, dynamic: bool) -> ToolContributions {
    let StaticSyntaxValue::Object { properties, .. } = object else {
        return dynamic_tool_contributions();
    };
    let has_spread = properties
        .iter()
        .any(|property| property.spread == Some(true));
    let contributions = properties
        .iter()
        .filter(|property| property.spread != Some(true))
        .filter_map(|property| {
            direct_identifier(&property.value).map(|reference| (property.name.clone(), reference))
        })
        .collect::<Vec<_>>();
    tool_contributions_from_pairs(contributions, dynamic || has_spread)
}

fn dynamic_tool_contributions() -> ToolContributions {
    ToolContributions {
        facts: Some(json!({"hasTools": true, "dynamic": true})),
        references: Vec::new(),
    }
}

fn tool_contributions_from_pairs(
    contributions: Vec<(String, String)>,
    dynamic: bool,
) -> ToolContributions {
    let references = contributions
        .iter()
        .map(|(_, reference)| reference.clone())
        .collect::<Vec<_>>();
    let mut facts = Map::new();
    facts.insert("hasTools".to_string(), Value::Bool(true));
    if dynamic {
        facts.insert("dynamic".to_string(), Value::Bool(true));
    }
    if !contributions.is_empty() {
        facts.insert(
            "names".to_string(),
            Value::Array(
                contributions
                    .iter()
                    .map(|(name, _)| Value::String(name.clone()))
                    .collect(),
            ),
        );
        facts.insert(
            "variables".to_string(),
            Value::Array(references.iter().cloned().map(Value::String).collect()),
        );
    }
    ToolContributions {
        facts: Some(Value::Object(facts)),
        references,
    }
}
