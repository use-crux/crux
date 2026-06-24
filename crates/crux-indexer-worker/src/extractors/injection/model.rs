use serde_json::{Map, Value, json};

use crate::{
    extractors::context::PrimitiveContext,
    extractors::record_values::{property_value, resolve_static_value},
    protocol::StaticSyntaxValue,
};

#[derive(Clone)]
pub(crate) struct UseEntry {
    variable: Option<String>,
    relation_hint: &'static str,
    conditionality: &'static str,
    via: &'static str,
    branch: Option<String>,
}

pub(crate) fn use_entries_for_property(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    property: &str,
) -> Vec<UseEntry> {
    property_value(object, property)
        .map(|value| use_entries_from_value(context, value, InheritedUse::default()))
        .unwrap_or_default()
}

pub(crate) fn use_entry_values(entries: &[UseEntry]) -> Vec<Value> {
    entries.iter().map(UseEntry::to_value).collect()
}

pub(crate) fn use_entry_variables(entries: &[UseEntry]) -> Vec<String> {
    entries
        .iter()
        .filter_map(|entry| entry.variable.clone())
        .collect()
}

pub(crate) fn relation_refs_for_injection_use(
    owner: &str,
    from_id: &str,
    entries: &[UseEntry],
) -> Vec<Value> {
    entries
        .iter()
        .filter_map(|entry| {
            let variable = entry.variable.as_ref()?;
            Some(json!({
                "type": relation_type_for_hint(owner, entry.relation_hint),
                "typeByTargetKind": {
                    "context": format!("{owner}.uses_context"),
                    "injectable": format!("{owner}.uses_injectable"),
                    "memory": format!("{owner}.uses_memory"),
                    "blackboard": format!("{owner}.uses_blackboard"),
                },
                "fromId": from_id,
                "toVariable": variable,
            }))
        })
        .collect()
}

fn use_entries_from_value(
    context: &PrimitiveContext<'_>,
    value: &StaticSyntaxValue,
    inherited: InheritedUse,
) -> Vec<UseEntry> {
    match value {
        StaticSyntaxValue::Array { elements } => elements
            .iter()
            .flat_map(|element| use_entries_from_value(context, element, inherited.clone()))
            .collect(),
        StaticSyntaxValue::Identifier { name } => {
            if let Some(initializer) = context.initializers.get(name.as_str()) {
                if matches!(initializer.value, StaticSyntaxValue::Array { .. }) {
                    return use_entries_from_value(
                        context,
                        &initializer.value,
                        InheritedUse {
                            conditionality: Some(inherited.conditionality.unwrap_or("always")),
                            via: Some(inherited.via.unwrap_or("array-ref")),
                            branch: inherited.branch,
                        },
                    );
                }
            }
            vec![UseEntry {
                variable: Some(name.clone()),
                relation_hint: "unknown",
                conditionality: inherited.conditionality.unwrap_or("always"),
                via: inherited.via.unwrap_or("direct"),
                branch: inherited.branch,
            }]
        }
        StaticSyntaxValue::Call { callee, args, .. } => {
            let call_name = callee.local_name.as_deref().unwrap_or(&callee.name);
            if call_name == "when" {
                return args
                    .get(1)
                    .map(|value| {
                        use_entries_from_value(
                            context,
                            value,
                            InheritedUse {
                                conditionality: Some("when"),
                                via: Some("when"),
                                branch: inherited.branch,
                            },
                        )
                    })
                    .unwrap_or_default();
            }
            if call_name == "match" && args.first().is_some() {
                return match_use_entries(context, args.first().unwrap());
            }
            vec![UseEntry::dynamic(inherited)]
        }
        _ => vec![UseEntry {
            variable: None,
            relation_hint: "unknown",
            conditionality: "unknown",
            via: inherited.via.unwrap_or("direct"),
            branch: inherited.branch,
        }],
    }
}

fn match_use_entries(context: &PrimitiveContext<'_>, value: &StaticSyntaxValue) -> Vec<UseEntry> {
    let mut entries = Vec::new();
    if let Some(cases) = property_value(value, "cases") {
        if let StaticSyntaxValue::Object { properties, .. } =
            resolve_static_value(cases, &context.initializers, &mut Default::default())
        {
            for property in properties
                .iter()
                .filter(|property| property.spread != Some(true))
            {
                entries.extend(use_entries_from_value(
                    context,
                    &property.value,
                    InheritedUse {
                        conditionality: Some("match-case"),
                        via: Some("match"),
                        branch: Some(property.name.clone()),
                    },
                ));
            }
        }
    }
    if let Some(defaults) = property_value(value, "default") {
        entries.extend(use_entries_from_value(
            context,
            defaults,
            InheritedUse {
                conditionality: Some("match-default"),
                via: Some("match"),
                branch: Some("default".to_string()),
            },
        ));
    }
    entries
}

impl UseEntry {
    fn dynamic(inherited: InheritedUse) -> Self {
        Self {
            variable: None,
            relation_hint: "unknown",
            conditionality: "dynamic",
            via: inherited.via.unwrap_or("direct"),
            branch: inherited.branch,
        }
    }

    fn to_value(&self) -> Value {
        let mut value = Map::new();
        if let Some(variable) = &self.variable {
            value.insert("variable".to_string(), Value::String(variable.clone()));
        }
        value.insert(
            "relationHint".to_string(),
            Value::String(self.relation_hint.to_string()),
        );
        value.insert(
            "conditionality".to_string(),
            Value::String(self.conditionality.to_string()),
        );
        value.insert("via".to_string(), Value::String(self.via.to_string()));
        if let Some(branch) = &self.branch {
            value.insert("branch".to_string(), Value::String(branch.clone()));
        }
        Value::Object(value)
    }
}

#[derive(Clone, Default)]
struct InheritedUse {
    conditionality: Option<&'static str>,
    via: Option<&'static str>,
    branch: Option<String>,
}

fn relation_type_for_hint(owner: &str, hint: &str) -> String {
    match hint {
        "injectable" => format!("{owner}.uses_injectable"),
        "memory" => format!("{owner}.uses_memory"),
        "blackboard" => format!("{owner}.uses_blackboard"),
        _ => format!("{owner}.uses_context"),
    }
}
