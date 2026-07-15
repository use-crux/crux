use serde_json::{Map, Value, json};
use std::collections::HashSet;

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    protocol::StaticSyntaxValue,
    rag::metadata::dependency_metadata,
    record_values::{
        direct_identifier, direct_string_property, property_value, resolve_static_value,
    },
    routing::output::insert_string,
};

pub(super) struct RecipeStep {
    pub(super) id: String,
    pub(super) definition: Value,
    pub(super) retriever_variable: Option<String>,
    pub(super) scorer_variable: Option<String>,
    pub(super) reranker_variable: Option<String>,
}

struct RecipeStepSource<'a> {
    object: &'a StaticSyntaxValue,
    call_name: Option<&'a str>,
}

pub(super) fn recipe_steps(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    recipe_id: &str,
) -> Vec<RecipeStep> {
    recipe_step_sources(property_value(config, "steps"), context)
        .into_iter()
        .enumerate()
        .map(|(index, step)| recipe_step(context, parts, recipe_id, step, index))
        .collect()
}

fn recipe_step_sources<'a>(
    value: Option<&'a StaticSyntaxValue>,
    context: &'a PrimitiveContext<'_>,
) -> Vec<RecipeStepSource<'a>> {
    let Some(StaticSyntaxValue::Array { elements }) =
        value.map(|value| resolve_static_value(value, &context.initializers, &mut HashSet::new()))
    else {
        return Vec::new();
    };
    elements
        .iter()
        .filter_map(|element| recipe_step_source(element, context))
        .collect()
}

fn recipe_step_source<'a>(
    value: &'a StaticSyntaxValue,
    context: &'a PrimitiveContext<'_>,
) -> Option<RecipeStepSource<'a>> {
    let resolved = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    match resolved {
        StaticSyntaxValue::Object { .. } => Some(RecipeStepSource {
            object: resolved,
            call_name: None,
        }),
        StaticSyntaxValue::Call { callee, args, .. } => {
            let config =
                resolve_static_value(args.first()?, &context.initializers, &mut HashSet::new());
            matches!(config, StaticSyntaxValue::Object { .. }).then_some(RecipeStepSource {
                object: config,
                call_name: Some(callee.local_name.as_deref().unwrap_or(callee.name.as_str())),
            })
        }
        _ => None,
    }
}

fn recipe_step(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    recipe_id: &str,
    step: RecipeStepSource<'_>,
    index: usize,
) -> RecipeStep {
    let step_id = direct_string_property(step.object, "id")
        .or_else(|| direct_string_property(step.object, "name"))
        .or_else(|| step.call_name.map(ToString::to_string))
        .unwrap_or_else(|| format!("step-{}", index + 1));
    let definition_id = format!("{recipe_id}:step:{}", safe_id(&step_id));
    let retriever_variable = identifier_property(step.object, "retriever");
    let scorer_variable = identifier_property(step.object, "scorer")
        .or_else(|| identifier_property(step.object, "judge"));
    let reranker_variable = identifier_property(step.object, "engine")
        .or_else(|| identifier_property(step.object, "reranker"));

    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("rag.recipe.step".to_string()),
    );
    facts.insert("stepId".to_string(), Value::String(step_id.clone()));
    facts.insert("index".to_string(), json!(index));
    insert_string(&mut facts, "retrieverId", retriever_variable.clone());
    insert_string(&mut facts, "rerankerId", reranker_variable.clone());

    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    intelligence.insert(
        "control".to_string(),
        json!({ "mode": "sequential", "ordering": "ordered" }),
    );
    if retriever_variable.is_some() || scorer_variable.is_some() || reranker_variable.is_some() {
        intelligence.insert(
            "dependencies".to_string(),
            dependency_metadata(
                &retriever_variable.iter().cloned().collect::<Vec<_>>(),
                &scorer_variable.iter().cloned().collect::<Vec<_>>(),
                &reranker_variable.iter().cloned().collect::<Vec<_>>(),
            ),
        );
    }

    let mut metadata = Map::new();
    metadata.insert("recipeId".to_string(), Value::String(recipe_id.to_string()));
    metadata.insert("stepId".to_string(), Value::String(step_id.clone()));
    metadata.insert("index".to_string(), json!(index));
    insert_string(
        &mut metadata,
        "retrieverVariable",
        retriever_variable.clone(),
    );
    insert_string(&mut metadata, "scorerVariable", scorer_variable.clone());
    insert_string(&mut metadata, "rerankerVariable", reranker_variable.clone());
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(recipe_id, "rag.recipe.includes_step", "step", index),
    );
    metadata.insert("facts".to_string(), Value::Object(facts));
    metadata.insert("intelligence".to_string(), Value::Object(intelligence));

    RecipeStep {
        id: definition_id.clone(),
        definition: static_index_definition(NativeDefinitionInput {
            id: definition_id,
            kind: "rag.recipe.step",
            name: step_id,
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        retriever_variable,
        scorer_variable,
        reranker_variable,
    }
}

pub(super) fn recipe_references(retriever_ref: Option<&str>, steps: &[RecipeStep]) -> Vec<Value> {
    let mut refs = Vec::new();
    if let Some(retriever_ref) = retriever_ref {
        refs.push(json!({ "type": "rag.recipe.uses_retriever", "toVariable": retriever_ref }));
    }
    for step in steps {
        refs.push(json!({
            "type": "rag.recipe.includes_step",
            "toId": step.id,
        }));
        if let Some(retriever) = &step.retriever_variable {
            refs.push(json!({
                "type": "rag.recipe.step.uses_retriever",
                "fromId": step.id,
                "toVariable": retriever,
            }));
        }
        if let Some(scorer) = &step.scorer_variable {
            refs.push(json!({
                "type": "rag.recipe.step.uses_scorer",
                "fromId": step.id,
                "toVariable": scorer,
            }));
        }
        if let Some(reranker) = &step.reranker_variable {
            refs.push(json!({
                "type": "rag.recipe.step.uses_reranker",
                "fromId": step.id,
                "toVariable": reranker,
            }));
        }
    }
    refs
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}
