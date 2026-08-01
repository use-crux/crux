//! Built-in lint rules for Connected Knowledge static contracts.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::builder::{
    StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence, relation_evidence,
};
use crate::facts::{StaticIndexDefinition, StaticIndexLintFinding, StaticIndexRelation};
use crate::helpers::{metadata_path, metadata_value};

pub(crate) fn knowledge_lint_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
    relations: &[StaticIndexRelation],
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let relation_types = declared_relation_type_names(definitions);
    let mut findings =
        expand_relations_unknown_type_findings(builder, definitions, &relation_types);
    findings.extend(recipe_producer_conflict_findings(
        builder,
        definitions,
        by_id,
    ));
    findings.extend(assertions_unknown_type_selection_findings(
        builder,
        definitions,
        relations,
        by_id,
    ));
    findings
}

fn expand_relations_unknown_type_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
    declared: &BTreeSet<String>,
) -> Vec<StaticIndexLintFinding> {
    definitions
        .iter()
        .filter(|definition| definition.kind == "rag.recipe.step")
        .filter(|definition| recipe_step_name(definition).is_some_and(is_expand_relations_step))
        .filter_map(|definition| {
            let selected = selected_type_names(definition);
            let unknown = unknown_names(&selected, declared);
            if unknown.is_empty() {
                return None;
            }
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "expand-relations-unknown-type",
                key: &format!("{}:{}", definition.id, unknown.join(",")),
                message: format!(
                    "expandRelations() selects unknown relation {} {}; declared relation vocabulary: {}.",
                    type_label(unknown.len()),
                    quoted_list(&unknown),
                    vocabulary_summary(declared),
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![
                    definition_evidence(definition, "expandRelations() type selection"),
                    json!({
                        "kind": "definition",
                        "label": "Declared relation vocabulary",
                        "definitionId": definition.id,
                        "source": definition.source,
                        "data": {
                            "selectedTypes": selected,
                            "unknownTypes": unknown,
                            "declaredTypes": declared.iter().cloned().collect::<Vec<_>>()
                        },
                    }),
                ],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn recipe_producer_conflict_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let mut by_recipe = BTreeMap::<String, Vec<&StaticIndexDefinition>>::new();
    for definition in definitions {
        if definition.kind != "rag.recipe.step" || !is_recipe_producer_step(definition) {
            continue;
        }
        let recipe_id = metadata_value(definition, "recipeId")
            .and_then(Value::as_str)
            .unwrap_or("<unknown-recipe>");
        by_recipe
            .entry(recipe_id.to_string())
            .or_default()
            .push(definition);
    }

    by_recipe
        .into_iter()
        .filter_map(|(recipe_id, mut producers)| {
            producers.sort_by_key(|definition| {
                metadata_value(definition, "index")
                    .and_then(Value::as_u64)
                    .unwrap_or(u64::MAX)
            });
            if producers.len() < 2 {
                return None;
            }
            let first = producers[0];
            let second = producers[1];
            let recipe = by_id.get(recipe_id.as_str()).copied();
            let primary = recipe.unwrap_or(first);
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "knowledge-recipe-producer-conflict",
                key: recipe_id.as_str(),
                message: format!(
                    "Retrieval recipe has more than one producer step: \"{}\" and \"{}\". Use exactly one of retrieve() or globalSearch().",
                    recipe_step_display_id(first),
                    recipe_step_display_id(second),
                ),
                source: second.source.as_ref().or(first.source.as_ref()),
                primary_definition_id: Some(primary.id.as_str()),
                related_definition_ids: std::iter::once(recipe_id.clone())
                    .chain(producers.iter().map(|definition| definition.id.clone()))
                    .collect(),
                evidence: producers
                    .iter()
                    .map(|definition| definition_evidence(definition, "Recipe producer step"))
                    .collect(),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn assertions_unknown_type_selection_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
    relations: &[StaticIndexRelation],
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let mut findings = Vec::new();

    for relation in relations {
        if !relation.r#type.contains("assertions") {
            continue;
        }
        let Some(target) = by_id.get(relation.to.as_str()).copied() else {
            continue;
        };
        if target.kind != "knowledge.assertions" {
            continue;
        }
        let selected = selected_type_names_from_value(relation.metadata.as_ref())
            .or_else(|| selected_type_names_from_value(metadata_value(target, "facts")));
        append_assertion_selection_finding(
            builder,
            &mut findings,
            target,
            selected.unwrap_or_default(),
            relation.source.as_ref().or(target.source.as_ref()),
            Some(relation),
        );
    }

    for definition in definitions {
        if definition.kind != "knowledge.assertions" {
            continue;
        }
        let selected = selected_type_names(definition);
        append_assertion_selection_finding(
            builder,
            &mut findings,
            definition,
            selected,
            definition.source.as_ref(),
            None,
        );
    }

    findings
}

fn append_assertion_selection_finding(
    builder: &StaticIndexLintBuilder,
    findings: &mut Vec<StaticIndexLintFinding>,
    definition: &StaticIndexDefinition,
    selected: Vec<String>,
    source: Option<&crate::facts::StaticIndexSourceLocation>,
    relation: Option<&StaticIndexRelation>,
) {
    if selected.is_empty() {
        return;
    }
    let declared = declared_type_names(definition);
    let unknown = unknown_names(&selected, &declared);
    if unknown.is_empty() {
        return;
    }
    let mut evidence = vec![
        definition_evidence(definition, "Assertion stage type vocabulary"),
        json!({
            "kind": "definition",
            "label": "Assertion type selection",
            "definitionId": definition.id,
            "source": source,
            "data": {
                "selectedTypes": selected,
                "unknownTypes": unknown,
                "declaredTypes": declared.iter().cloned().collect::<Vec<_>>()
            },
        }),
    ];
    if let Some(relation) = relation {
        evidence.push(relation_evidence(relation, "Assertion selection site"));
    }
    if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
        rule_id: "assertions-unknown-type-selection",
        key: &format!("{}:{}", definition.id, unknown.join(",")),
        message: format!(
            "Assertion selection for \"{}\" names unknown {} {}; declared assertion types: {}.",
            definition.name,
            type_label(unknown.len()),
            quoted_list(&unknown),
            vocabulary_summary(&declared),
        ),
        source,
        primary_definition_id: Some(definition.id.as_str()),
        related_definition_ids: vec![definition.id.clone()],
        evidence,
        fixes: Vec::new(),
    }) {
        findings.push(finding);
    }
}

fn declared_relation_type_names(definitions: &[StaticIndexDefinition]) -> BTreeSet<String> {
    definitions
        .iter()
        .filter(|definition| definition.kind == "knowledge.relation")
        .flat_map(declared_type_names)
        .collect()
}

fn declared_type_names(definition: &StaticIndexDefinition) -> BTreeSet<String> {
    type_names_from_value(metadata_path(definition, &["facts"]))
        .into_iter()
        .collect()
}

fn selected_type_names(definition: &StaticIndexDefinition) -> Vec<String> {
    selected_type_names_from_value(metadata_path(definition, &["facts"]))
        .or_else(|| selected_type_names_from_value(definition.metadata.as_ref()))
        .unwrap_or_default()
}

fn selected_type_names_from_value(value: Option<&Value>) -> Option<Vec<String>> {
    let value = value?;
    for key in [
        "selectedTypes",
        "selectedTypeNames",
        "types",
        "typeNames",
        "relationTypes",
        "assertionTypes",
    ] {
        if let Some(names) = string_array(value.get(key)) {
            return Some(names);
        }
    }
    None
}

fn type_names_from_value(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|value| {
            string_array(value.get("typeNames")).or_else(|| string_array(value.get("types")))
        })
        .unwrap_or_default()
}

fn string_array(value: Option<&Value>) -> Option<Vec<String>> {
    let array = value?.as_array()?;
    let values = array
        .iter()
        .filter_map(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    Some(values)
}

fn unknown_names(selected: &[String], declared: &BTreeSet<String>) -> Vec<String> {
    selected
        .iter()
        .filter(|name| !declared.contains(name.as_str()))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn recipe_step_name(definition: &StaticIndexDefinition) -> Option<&str> {
    metadata_path(definition, &["facts", "stepId"])
        .and_then(Value::as_str)
        .or_else(|| metadata_value(definition, "stepId").and_then(Value::as_str))
        .or_else(|| Some(definition.name.as_str()))
}

fn recipe_step_display_id(definition: &StaticIndexDefinition) -> String {
    recipe_step_name(definition)
        .unwrap_or(definition.name.as_str())
        .to_string()
}

fn is_expand_relations_step(value: &str) -> bool {
    matches!(value, "expand-relations" | "expandRelations")
}

fn is_recipe_producer_step(definition: &StaticIndexDefinition) -> bool {
    recipe_step_name(definition)
        .is_some_and(|value| matches!(value, "retrieve" | "globalSearch" | "global-search"))
}

fn type_label(count: usize) -> &'static str {
    if count == 1 { "type" } else { "types" }
}

fn quoted_list(values: &[String]) -> String {
    values
        .iter()
        .map(|value| format!("\"{value}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

fn vocabulary_summary(values: &BTreeSet<String>) -> String {
    if values.is_empty() {
        "none".to_string()
    } else {
        quoted_list(&values.iter().cloned().collect::<Vec<_>>())
    }
}
