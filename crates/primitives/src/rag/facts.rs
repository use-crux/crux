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
};

pub(crate) fn rag_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_direct == Some(false) {
        return None;
    }
    match parts.callee_name {
        "retriever" => retriever_facts(context, parts),
        "retrievalPipeline" => pipeline_facts(context, parts),
        _ => None,
    }
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
    metadata.insert(
        "intelligence".to_string(),
        json!({ "confidence": "static" }),
    );

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
        Vec::new(),
        Vec::new(),
    ))
}

fn pipeline_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let retriever_ref = parts.args.first().and_then(direct_identifier);
    let id = format!("rag.pipeline:{}", safe_id(parts.variable_name));
    let stages = pipeline_stages(context, parts, &id);
    let retrievers = unique_defined(
        retriever_ref.as_deref().into_iter().chain(
            stages
                .iter()
                .filter_map(|stage| stage.retriever_variable.as_deref()),
        ),
    );
    let scorers = unique_defined(
        stages
            .iter()
            .filter_map(|stage| stage.scorer_variable.as_deref()),
    );

    let stage_ids = stages
        .iter()
        .map(|stage| Value::String(stage.id.clone()))
        .collect::<Vec<_>>();
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    let mut control = Map::new();
    control.insert("mode".to_string(), Value::String("sequential".to_string()));
    control.insert("ordering".to_string(), Value::String("ordered".to_string()));
    if !stage_ids.is_empty() {
        control.insert("children".to_string(), Value::Array(stage_ids.clone()));
    }
    intelligence.insert("control".to_string(), Value::Object(control));
    if !retrievers.is_empty() || !scorers.is_empty() {
        intelligence.insert(
            "dependencies".to_string(),
            dependency_metadata(&retrievers, &scorers),
        );
    }
    if !stage_ids.is_empty() {
        intelligence.insert("children".to_string(), Value::Array(stage_ids));
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("facts".to_string(), json!({ "kind": "rag.pipeline" }));
    metadata.insert("intelligence".to_string(), Value::Object(intelligence));

    let references = pipeline_references(retriever_ref.as_deref(), &stages);
    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "rag.pipeline",
            name: parts.variable_name.to_string(),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        stages.into_iter().map(|stage| stage.definition).collect(),
        references,
        Vec::new(),
    ))
}

struct PipelineStage {
    id: String,
    definition: Value,
    retriever_variable: Option<String>,
    scorer_variable: Option<String>,
}

fn pipeline_stages(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    pipeline_id: &str,
) -> Vec<PipelineStage> {
    object_array_value(parts.args.get(1), &context.initializers)
        .into_iter()
        .enumerate()
        .map(|(index, stage)| pipeline_stage(context, parts, pipeline_id, stage, index))
        .collect()
}

fn pipeline_stage(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    pipeline_id: &str,
    stage: &StaticSyntaxValue,
    index: usize,
) -> PipelineStage {
    let stage_id =
        direct_string_property(stage, "name").unwrap_or_else(|| format!("stage-{}", index + 1));
    let definition_id = format!("{pipeline_id}:stage:{}", safe_id(&stage_id));
    let retriever_variable = identifier_property(stage, "retriever");
    let scorer_variable = identifier_property(stage, "scorer")
        .or_else(|| identifier_property(stage, "judge"))
        .or_else(|| identifier_property(stage, "reranker"));

    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("rag.pipeline.stage".to_string()),
    );
    facts.insert("stageId".to_string(), Value::String(stage_id.clone()));
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
    metadata.insert(
        "pipelineId".to_string(),
        Value::String(pipeline_id.to_string()),
    );
    metadata.insert("stageId".to_string(), Value::String(stage_id.clone()));
    metadata.insert("index".to_string(), json!(index));
    insert_string(
        &mut metadata,
        "retrieverVariable",
        retriever_variable.clone(),
    );
    insert_string(&mut metadata, "scorerVariable", scorer_variable.clone());
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(pipeline_id, "rag.pipeline.includes_stage", "stage", index),
    );
    metadata.insert("facts".to_string(), Value::Object(facts));
    metadata.insert("intelligence".to_string(), Value::Object(intelligence));

    PipelineStage {
        id: definition_id.clone(),
        definition: static_index_definition(NativeDefinitionInput {
            id: definition_id,
            kind: "rag.pipeline.stage",
            name: stage_id,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        retriever_variable,
        scorer_variable,
    }
}

fn pipeline_references(retriever_ref: Option<&str>, stages: &[PipelineStage]) -> Vec<Value> {
    let mut refs = Vec::new();
    if let Some(retriever_ref) = retriever_ref {
        refs.push(json!({ "type": "rag.pipeline.uses_retriever", "toVariable": retriever_ref }));
    }
    for stage in stages {
        refs.push(json!({
            "type": "rag.pipeline.includes_stage",
            "toId": stage.id,
        }));
        if let Some(retriever) = &stage.retriever_variable {
            refs.push(json!({
                "type": "rag.pipeline.stage.uses_retriever",
                "fromId": stage.id,
                "toVariable": retriever,
            }));
        }
        if let Some(scorer) = &stage.scorer_variable {
            refs.push(json!({
                "type": "rag.pipeline.stage.uses_scorer",
                "fromId": stage.id,
                "toVariable": scorer,
            }));
        }
    }
    refs
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}
