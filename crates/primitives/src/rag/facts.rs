use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    rag::metadata::{dependency_metadata, unique_defined},
    rag::recipe_steps::{recipe_references, recipe_steps},
    record_values::{direct_identifier, direct_string_property, property_value},
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
        "reranker" | "judgeReranker" => reranker_facts(context, parts),
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
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ))
}

fn reranker_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let explicit_name =
        direct_string_property(config, "id").or_else(|| direct_string_property(config, "name"));
    let id = format!(
        "rag.reranker:{}",
        safe_id(
            &explicit_name
                .clone()
                .unwrap_or_else(|| parts.local_name.to_string())
        )
    );
    let reranker_id = explicit_name
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "rag.reranker",
            "rerankerId": reranker_id,
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
            kind: "rag.reranker",
            name: explicit_name.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.fingerprint_file,
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
    insert_string(
        &mut facts,
        "indexerId",
        direct_string_property(config, "indexerId"),
    );
    insert_string(
        &mut facts,
        "namespace",
        direct_string_property(config, "namespace"),
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
            file: context.fingerprint_file,
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
    let rerankers = unique_defined(
        steps
            .iter()
            .filter_map(|step| step.reranker_variable.as_deref()),
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
    if !retrievers.is_empty() || !scorers.is_empty() || !rerankers.is_empty() {
        intelligence.insert(
            "dependencies".to_string(),
            dependency_metadata(&retrievers, &scorers, &rerankers),
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
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        steps.into_iter().map(|step| step.definition).collect(),
        references,
        Vec::new(),
    ))
}
