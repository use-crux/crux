//! Native injection read model used by built-in lint rules.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::static_compiler::core::facts::{NativeStaticDefinition, NativeStaticRelation};
use crate::static_compiler::lint::contracts::contract_input_contributions;
use crate::static_compiler::lint::injection::model_helpers::{
    can_own_injection, combine_conditionality, entry_projection, facts_use_entries,
    injection_outgoing_relations, is_dynamic_use_entry, string_array_field, tools_facts,
    traversable_injection_kind, use_entry_for_target,
};

#[derive(Debug, Clone, Default)]
pub(crate) struct NativeStaticInjectionModel {
    pub(crate) input_contributions: Vec<Value>,
    pub(crate) tool_contributions: Vec<Value>,
    pub(crate) dynamic_entries: Vec<Value>,
    pub(crate) unresolved_entries: Vec<Value>,
}

#[derive(Clone)]
struct WalkState {
    path: Vec<String>,
    conditionality: Option<String>,
    via: Option<String>,
    branch: Option<String>,
}

pub(crate) fn build_all_injection_models<'a>(
    definitions: &'a [NativeStaticDefinition],
    relations: &'a [NativeStaticRelation],
    by_id: &BTreeMap<&'a str, &'a NativeStaticDefinition>,
) -> BTreeMap<&'a str, NativeStaticInjectionModel> {
    let outgoing = injection_outgoing_relations(relations);
    definitions
        .iter()
        .filter(|definition| can_own_injection(&definition.kind))
        .filter_map(|definition| {
            build_injection_model(definition, by_id, &outgoing)
                .map(|model| (definition.id.as_str(), model))
        })
        .collect()
}

fn build_injection_model<'a>(
    root: &'a NativeStaticDefinition,
    by_id: &BTreeMap<&'a str, &'a NativeStaticDefinition>,
    outgoing: &BTreeMap<&'a str, Vec<&'a NativeStaticRelation>>,
) -> Option<NativeStaticInjectionModel> {
    let mut model = NativeStaticInjectionModel {
        input_contributions: contract_input_contributions(root),
        ..NativeStaticInjectionModel::default()
    };
    let mut visited_edges = BTreeSet::<String>::new();
    visit(
        root,
        by_id,
        outgoing,
        WalkState {
            path: vec![root.id.clone()],
            conditionality: Some("always".to_string()),
            via: Some("direct".to_string()),
            branch: None,
        },
        &mut visited_edges,
        &mut model,
    );
    Some(model)
}

fn visit<'a>(
    definition: &'a NativeStaticDefinition,
    by_id: &BTreeMap<&'a str, &'a NativeStaticDefinition>,
    outgoing: &BTreeMap<&'a str, Vec<&'a NativeStaticRelation>>,
    state: WalkState,
    visited_edges: &mut BTreeSet<String>,
    model: &mut NativeStaticInjectionModel,
) {
    for entry in facts_use_entries(definition) {
        if is_dynamic_use_entry(&entry) {
            model
                .dynamic_entries
                .push(entry_projection(definition.id.as_str(), &entry));
        }
        if entry.get("variable").and_then(Value::as_str).is_some()
            && entry.get("targetDefinitionId").is_none()
            && !is_dynamic_use_entry(&entry)
        {
            model
                .unresolved_entries
                .push(entry_projection(definition.id.as_str(), &entry));
        }
    }
    append_tool_contributions(definition, &state, model);

    for relation in outgoing.get(definition.id.as_str()).into_iter().flatten() {
        if !visited_edges.insert(relation.id.clone()) {
            continue;
        }
        let target = by_id.get(relation.to.as_str()).copied();
        let entry = target.and_then(|target| use_entry_for_target(definition, target, relation));
        let conditionality = combine_conditionality(
            state.conditionality.as_deref(),
            entry
                .as_ref()
                .and_then(|entry| entry.get("conditionality"))
                .and_then(Value::as_str),
        );
        let via = entry
            .as_ref()
            .and_then(|entry| entry.get("via"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| state.via.clone());
        let branch = entry
            .as_ref()
            .and_then(|entry| entry.get("branch"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| state.branch.clone());
        let mut path = state.path.clone();
        path.push(relation.to.clone());
        if target.is_some_and(|target| traversable_injection_kind(&target.kind)) {
            visit(
                target.unwrap(),
                by_id,
                outgoing,
                WalkState {
                    path,
                    conditionality,
                    via,
                    branch,
                },
                visited_edges,
                model,
            );
        }
    }
}

fn append_tool_contributions(
    definition: &NativeStaticDefinition,
    state: &WalkState,
    model: &mut NativeStaticInjectionModel,
) {
    let Some(tools) = tools_facts(definition) else {
        return;
    };
    let names = string_array_field(&tools, "names");
    let variables = string_array_field(&tools, "variables");
    for name in names {
        model
            .tool_contributions
            .push(tool_contribution(definition, state, Some(("name", name))));
    }
    for variable in variables {
        model.tool_contributions.push(tool_contribution(
            definition,
            state,
            Some(("variable", variable)),
        ));
    }
    if tools.get("dynamic").and_then(Value::as_bool) == Some(true)
        && string_array_field(&tools, "names").is_empty()
        && string_array_field(&tools, "variables").is_empty()
    {
        model
            .tool_contributions
            .push(tool_contribution(definition, state, None));
    }
}

fn tool_contribution(
    definition: &NativeStaticDefinition,
    state: &WalkState,
    named: Option<(&str, String)>,
) -> Value {
    let mut object = Map::new();
    object.insert(
        "sourceDefinitionId".to_string(),
        Value::String(definition.id.clone()),
    );
    object.insert(
        "sourceKind".to_string(),
        Value::String(definition.kind.clone()),
    );
    object.insert(
        "path".to_string(),
        Value::Array(state.path.iter().cloned().map(Value::String).collect()),
    );
    if tools_facts(definition).and_then(|tools| tools.get("dynamic").and_then(Value::as_bool))
        == Some(true)
    {
        object.insert("dynamic".to_string(), Value::Bool(true));
    }
    if let Some(value) = &state.conditionality {
        object.insert("conditionality".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = &state.branch {
        object.insert("branch".to_string(), Value::String(value.clone()));
    }
    if let Some((key, value)) = named {
        object.insert(key.to_string(), Value::String(value));
    }
    Value::Object(object)
}
