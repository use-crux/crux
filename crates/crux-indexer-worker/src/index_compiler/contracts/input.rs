//! Expanded input-contract projection for injection relations.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::index_compiler::contracts::schema::{
    clone_object_schema, contribution_key, contributions_from_schema,
    merge_object_schema_contributions, own_input_schema, source_input_schema,
};
use crate::index_compiler::core::facts::{NativeStaticDefinition, NativeStaticRelation};
use crate::index_compiler::read::helpers::{
    definition_export_name, definition_metadata, object_entry,
};

/// Adds inherited input fields from statically resolved context/injectable edges.
pub(crate) fn with_expanded_input_contracts(
    definitions: Vec<NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticDefinition> {
    let by_id = definitions
        .iter()
        .map(|definition| (definition.id.clone(), definition.clone()))
        .collect::<BTreeMap<_, _>>();
    let outgoing = outgoing_relations(relations);
    definitions
        .into_iter()
        .map(|mut definition| {
            if !can_receive_injected_input(&definition.kind) {
                return definition;
            }
            let own_input_schema = own_input_schema(&definition);
            let base = own_input_schema.as_ref().and_then(clone_object_schema);
            let contributions = collect_input_contributions(&definition, &by_id, &outgoing);
            if contributions.is_empty() {
                return definition;
            }
            let expanded_input_schema =
                merge_object_schema_contributions(base.as_ref(), &contributions);
            let mut metadata = definition_metadata(&definition);
            let intelligence = object_entry(&mut metadata, "intelligence");
            intelligence
                .entry("confidence".to_string())
                .or_insert_with(|| Value::String("static".to_string()));
            let contract = object_entry(intelligence, "contract");
            if let Some(schema) = own_input_schema {
                contract.insert("inputSchema".to_string(), schema);
            }
            contract.insert("expandedInputSchema".to_string(), expanded_input_schema);
            contract.insert(
                "inputContributions".to_string(),
                Value::Array(contributions),
            );
            definition.metadata = Some(Value::Object(metadata));
            definition
        })
        .collect()
}

fn outgoing_relations(
    relations: &[NativeStaticRelation],
) -> BTreeMap<String, Vec<NativeStaticRelation>> {
    let mut outgoing = BTreeMap::<String, Vec<NativeStaticRelation>>::new();
    for relation in relations {
        outgoing
            .entry(relation.from.clone())
            .or_default()
            .push(relation.clone());
    }
    outgoing
}

fn collect_input_contributions(
    owner: &NativeStaticDefinition,
    by_id: &BTreeMap<String, NativeStaticDefinition>,
    outgoing: &BTreeMap<String, Vec<NativeStaticRelation>>,
) -> Vec<Value> {
    let mut state = ContributionState::default();
    visit_contributions(
        owner,
        by_id,
        outgoing,
        vec![owner.id.clone()],
        EdgeFacts {
            conditionality: Some("always".to_string()),
            via: Some("direct".to_string()),
            branch: None,
        },
        &mut state,
    );
    state.contributions
}

#[derive(Default)]
struct ContributionState {
    contributions: Vec<Value>,
    seen_edges: BTreeSet<String>,
    seen_fields: BTreeSet<String>,
}

#[derive(Clone, Default)]
pub(crate) struct EdgeFacts {
    pub(crate) conditionality: Option<String>,
    pub(crate) via: Option<String>,
    pub(crate) branch: Option<String>,
}

fn visit_contributions(
    from: &NativeStaticDefinition,
    by_id: &BTreeMap<String, NativeStaticDefinition>,
    outgoing: &BTreeMap<String, Vec<NativeStaticRelation>>,
    path: Vec<String>,
    inherited: EdgeFacts,
    state: &mut ContributionState,
) {
    let Some(relations) = outgoing.get(&from.id) else {
        return;
    };
    for relation in ordered_input_relations(from, by_id, relations) {
        if !is_input_injecting_relation(&relation.r#type)
            || !state.seen_edges.insert(relation.id.clone())
        {
            continue;
        }
        let Some(target) = by_id.get(&relation.to) else {
            continue;
        };
        if !can_contribute_input(&target.kind) {
            continue;
        }
        let edge = use_facts_for_target(from, target).unwrap_or_default();
        let conditionality = combine_conditionality(
            inherited.conditionality.as_deref(),
            edge.conditionality.as_deref(),
        );
        let via = edge.via.clone().or_else(|| inherited.via.clone());
        let branch = edge.branch.clone().or_else(|| inherited.branch.clone());
        let mut next_path = path.clone();
        next_path.push(target.id.clone());
        for contribution in contributions_from_schema(
            source_input_schema(target).as_ref(),
            target,
            &next_path,
            &EdgeFacts {
                conditionality: conditionality.clone(),
                via: via.clone(),
                branch: branch.clone(),
            },
        ) {
            let key = contribution_key(&contribution);
            if state.seen_fields.insert(key) {
                state.contributions.push(contribution);
            }
        }
        visit_contributions(
            target,
            by_id,
            outgoing,
            next_path,
            EdgeFacts {
                conditionality,
                via,
                branch,
            },
            state,
        );
    }
}

fn ordered_input_relations<'a>(
    from: &NativeStaticDefinition,
    by_id: &BTreeMap<String, NativeStaticDefinition>,
    relations: &'a [NativeStaticRelation],
) -> Vec<&'a NativeStaticRelation> {
    let mut ordered = relations.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        let left_order = by_id
            .get(&left.to)
            .and_then(|target| use_entry_index_for_target(from, target))
            .unwrap_or(usize::MAX);
        let right_order = by_id
            .get(&right.to)
            .and_then(|target| use_entry_index_for_target(from, target))
            .unwrap_or(usize::MAX);
        left_order
            .cmp(&right_order)
            .then_with(|| left.id.cmp(&right.id))
    });
    ordered
}

fn use_facts_for_target(
    owner: &NativeStaticDefinition,
    target: &NativeStaticDefinition,
) -> Option<EdgeFacts> {
    use_entries(owner).into_iter().find_map(|entry| {
        let object = entry.as_object()?;
        let variable = object.get("variable").and_then(Value::as_str)?;
        if variable != target.name
            && definition_export_name(target).as_deref() != Some(variable)
            && !target.id.ends_with(&format!(":{variable}"))
        {
            return None;
        }
        Some(EdgeFacts {
            conditionality: object
                .get("conditionality")
                .and_then(Value::as_str)
                .map(str::to_string),
            via: object
                .get("via")
                .and_then(Value::as_str)
                .map(str::to_string),
            branch: object
                .get("branch")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    })
}

fn use_entry_index_for_target(
    owner: &NativeStaticDefinition,
    target: &NativeStaticDefinition,
) -> Option<usize> {
    use_entries(owner)
        .into_iter()
        .position(|entry| use_entry_matches_target(&entry, target))
}

fn use_entry_matches_target(entry: &Value, target: &NativeStaticDefinition) -> bool {
    let Some(object) = entry.as_object() else {
        return false;
    };
    let Some(variable) = object.get("variable").and_then(Value::as_str) else {
        return false;
    };
    variable == target.name
        || definition_export_name(target).as_deref() == Some(variable)
        || target.id.ends_with(&format!(":{variable}"))
}

fn use_entries(definition: &NativeStaticDefinition) -> Vec<Value> {
    definition
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("facts"))
        .and_then(|facts| facts.get("useEntries"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn combine_conditionality(inherited: Option<&str>, current: Option<&str>) -> Option<String> {
    if inherited.is_none() || inherited == Some("always") {
        return Some(current.unwrap_or(inherited.unwrap_or("always")).to_string());
    }
    inherited.map(str::to_string)
}

fn can_receive_injected_input(kind: &str) -> bool {
    matches!(kind, "prompt" | "context" | "injectable")
}

fn can_contribute_input(kind: &str) -> bool {
    matches!(kind, "context" | "injectable")
}

fn is_input_injecting_relation(relation_type: &str) -> bool {
    matches!(
        relation_type,
        "prompt.uses_context"
            | "prompt.uses_injectable"
            | "context.uses_context"
            | "context.uses_injectable"
            | "injectable.uses_context"
    )
}
