use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    protocol::StaticSyntaxValue,
    rag::metadata::{dependency_metadata, unique_defined},
    record_values::{
        direct_identifier, direct_string_property, object_array_value, property_value,
    },
    routing::output::{extracted_facts, insert_string},
    storage::dependencies::{
        storage_config_references, storage_dependency_metadata, storage_relation_refs,
    },
};

pub(crate) fn rag_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    match parts.callee_name {
        "knowledgeBase" if parts.callee_direct != Some(false) => {
            knowledge_base_facts(context, parts)
        }
        "retriever" => retriever_facts(context, parts),
        "retrievalRecipe" if parts.callee_direct != Some(false) => recipe_facts(context, parts),
        _ => None,
    }
}

fn knowledge_base_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let id = format!(
        "rag.knowledgeBase:{}",
        safe_id(
            &explicit_id
                .clone()
                .unwrap_or_else(|| parts.local_name.to_string())
        )
    );
    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    insert_string(&mut metadata, "namespace", explicit_id.clone());
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "rag.knowledgeBase",
            "knowledgeBaseId": explicit_id.clone().unwrap_or_else(|| parts.variable_name.to_string()),
        }),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({ "confidence": "static" }),
    );

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "rag.knowledgeBase",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ))
}

fn retriever_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let id = format!(
        "rag.retriever:{}",
        safe_id(
            &explicit_id
                .clone()
                .unwrap_or_else(|| parts.local_name.to_string())
        )
    );

    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("rag.retriever".to_string()),
    );
    facts.insert(
        "retrieverId".to_string(),
        Value::String(
            explicit_id
                .clone()
                .unwrap_or_else(|| parts.variable_name.to_string()),
        ),
    );

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    insert_string(
        &mut metadata,
        "namespace",
        direct_string_property(config, "namespace"),
    );
    metadata.insert("facts".to_string(), Value::Object(facts));
    let storage_refs = storage_config_references(Some(config), &context.initializers);
    let storage_dependencies = storage_dependency_metadata(&storage_refs);
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(storage_dependencies) = storage_dependencies {
        intelligence.insert("dependencies".to_string(), storage_dependencies);
    }
    metadata.insert("intelligence".to_string(), Value::Object(intelligence));

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "rag.retriever",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        storage_relation_refs("rag.retriever", &storage_refs),
        Vec::new(),
    ))
}

fn recipe_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let retriever_ref = property_value(config, "retriever").and_then(direct_identifier);
    let explicit_id = direct_string_property(config, "id");
    let recipe_name = explicit_id
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("rag.recipe:{}", safe_id(&recipe_name));
    let steps = recipe_steps(context, parts, config, &id);
    let retrievers = unique_defined(
        retriever_ref.as_deref().into_iter().chain(
            steps
                .iter()
                .filter_map(|step| step.retriever_variable.as_deref()),
        ),
    );
    let scorers = unique_defined(
        steps
            .iter()
            .filter_map(|step| step.scorer_variable.as_deref()),
    );

    let step_ids = steps
        .iter()
        .map(|step| Value::String(step.id.clone()))
        .collect::<Vec<_>>();
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    let mut control = Map::new();
    control.insert("mode".to_string(), Value::String("sequential".to_string()));
    control.insert("ordering".to_string(), Value::String("ordered".to_string()));
    if !step_ids.is_empty() {
        control.insert("children".to_string(), Value::Array(step_ids.clone()));
    }
    intelligence.insert("control".to_string(), Value::Object(control));
    if !retrievers.is_empty() || !scorers.is_empty() {
        intelligence.insert(
            "dependencies".to_string(),
            dependency_metadata(&retrievers, &scorers),
        );
    }
    if !step_ids.is_empty() {
        intelligence.insert("children".to_string(), Value::Array(step_ids));
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert(
        "facts".to_string(),
        json!({ "kind": "rag.recipe", "recipeId": recipe_name }),
    );
    metadata.insert("intelligence".to_string(), Value::Object(intelligence));

    let references = recipe_references(retriever_ref.as_deref(), &steps);
    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "rag.recipe",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        steps.into_iter().map(|step| step.definition).collect(),
        references,
        Vec::new(),
    ))
}

struct RecipeStep {
    id: String,
    definition: Value,
    retriever_variable: Option<String>,
    scorer_variable: Option<String>,
}

fn recipe_steps(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    recipe_id: &str,
) -> Vec<RecipeStep> {
    object_array_value(property_value(config, "steps"), &context.initializers)
        .into_iter()
        .enumerate()
        .map(|(index, step)| recipe_step(context, parts, recipe_id, step, index))
        .collect()
}

fn recipe_step(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    recipe_id: &str,
    step: &StaticSyntaxValue,
    index: usize,
) -> RecipeStep {
    let step_id = direct_string_property(step, "id")
        .or_else(|| direct_string_property(step, "name"))
        .unwrap_or_else(|| format!("step-{}", index + 1));
    let definition_id = format!("{recipe_id}:step:{}", safe_id(&step_id));
    let retriever_variable = identifier_property(step, "retriever");
    let scorer_variable = identifier_property(step, "scorer")
        .or_else(|| identifier_property(step, "judge"))
        .or_else(|| identifier_property(step, "reranker"));

    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("rag.recipe.step".to_string()),
    );
    facts.insert("stepId".to_string(), Value::String(step_id.clone()));
    facts.insert("index".to_string(), json!(index));
    insert_string(&mut facts, "retrieverId", retriever_variable.clone());

    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    intelligence.insert(
        "control".to_string(),
        json!({ "mode": "sequential", "ordering": "ordered" }),
    );
    if retriever_variable.is_some() || scorer_variable.is_some() {
        intelligence.insert(
            "dependencies".to_string(),
            dependency_metadata(
                &retriever_variable.iter().cloned().collect::<Vec<_>>(),
                &scorer_variable.iter().cloned().collect::<Vec<_>>(),
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
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        retriever_variable,
        scorer_variable,
    }
}

fn recipe_references(retriever_ref: Option<&str>, steps: &[RecipeStep]) -> Vec<Value> {
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
    }
    refs
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}
