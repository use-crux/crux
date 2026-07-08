use serde_json::{Map, Value, json};

use crate::{
    composition::values::{PipelineTarget, pipeline_stage_target},
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    protocol::StaticSyntaxValue,
    record_values::{
        direct_string_property, object_array_value, object_map_identifier_entries, property_value,
    },
};

pub(crate) struct CompositionChild {
    pub(crate) id: String,
    pub(crate) definition: Value,
    pub(crate) target_variable: Option<String>,
}

pub(crate) fn composition_child_definitions(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    composition_id: &str,
) -> Vec<CompositionChild> {
    match parts.callee_name {
        "parallel" => parallel_branch_definitions(context, parts, config, composition_id),
        "pipeline" => pipeline_stage_definitions(context, parts, config, composition_id),
        _ => Vec::new(),
    }
}

pub(crate) fn composition_child_relation_refs(
    call_name: &str,
    children: &[CompositionChild],
) -> Vec<Value> {
    children
        .iter()
        .flat_map(|child| child_relation_refs(call_name, child))
        .collect()
}

fn parallel_branch_definitions(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    composition_id: &str,
) -> Vec<CompositionChild> {
    object_map_identifier_entries(property_value(config, "agents"), &context.initializers)
        .into_iter()
        .enumerate()
        .map(|(index, (key, value))| {
            let id = format!("{composition_id}:branch:{}", safe_id(&key));
            let mut metadata = Map::new();
            metadata.insert(
                "compositionId".to_string(),
                Value::String(composition_id.to_string()),
            );
            metadata.insert("branchId".to_string(), Value::String(key.clone()));
            metadata.insert(
                "indexPresentation".to_string(),
                folded_index_child(composition_id, "parallel.includes_branch", "branch", index),
            );
            metadata.insert("targetVariable".to_string(), Value::String(value.clone()));
            metadata.insert(
                "targetProperty".to_string(),
                Value::String("agent".to_string()),
            );
            metadata.insert(
                "facts".to_string(),
                json!({
                    "kind": "composition.parallel.branch",
                    "compositionId": composition_id,
                    "branchId": key,
                    "targetVariable": value,
                }),
            );
            metadata.insert(
                "intelligence".to_string(),
                child_intelligence("parallel", "concurrent"),
            );
            CompositionChild {
                id: id.clone(),
                target_variable: Some(value),
                definition: child_definition(
                    context,
                    parts,
                    id,
                    "composition.parallel.branch",
                    key,
                    metadata,
                ),
            }
        })
        .collect()
}

fn pipeline_stage_definitions(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    composition_id: &str,
) -> Vec<CompositionChild> {
    object_array_value(property_value(config, "steps"), &context.initializers)
        .into_iter()
        .enumerate()
        .map(|(index, stage)| {
            let stage_id = direct_string_property(stage, "name")
                .unwrap_or_else(|| format!("stage-{}", index + 1));
            let target = pipeline_stage_target(context, stage);
            let id = format!("{composition_id}:stage:{}", safe_id(&stage_id));
            let mut metadata = Map::new();
            metadata.insert(
                "compositionId".to_string(),
                Value::String(composition_id.to_string()),
            );
            metadata.insert("stageId".to_string(), Value::String(stage_id.clone()));
            metadata.insert("index".to_string(), json!(index));
            metadata.insert(
                "indexPresentation".to_string(),
                folded_index_child(composition_id, "pipeline.includes_stage", "stage", index),
            );
            if let Some(target) = &target {
                metadata.insert(
                    "targetVariable".to_string(),
                    Value::String(target.variable.clone()),
                );
                metadata.insert(
                    "targetProperty".to_string(),
                    Value::String(target.property.to_string()),
                );
            }
            metadata.insert(
                "facts".to_string(),
                pipeline_stage_facts(composition_id, &stage_id, index, target.as_ref()),
            );
            metadata.insert(
                "intelligence".to_string(),
                child_intelligence("sequential", "ordered"),
            );
            CompositionChild {
                id: id.clone(),
                target_variable: target.map(|target| target.variable),
                definition: child_definition(
                    context,
                    parts,
                    id,
                    "composition.pipeline.stage",
                    stage_id,
                    metadata,
                ),
            }
        })
        .collect()
}

fn child_definition(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    id: String,
    kind: &'static str,
    name: String,
    metadata: Map<String, Value>,
) -> Value {
    static_index_definition(NativeDefinitionInput {
        id,
        kind,
        name,
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    })
}

fn child_relation_refs(call_name: &str, child: &CompositionChild) -> Vec<Value> {
    let (Some(includes_type), Some(uses_type)) =
        (includes_relation(call_name), uses_relation(call_name))
    else {
        return Vec::new();
    };
    let composition_id = child
        .definition
        .get("metadata")
        .and_then(|metadata| metadata.get("compositionId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if composition_id.is_empty() {
        return Vec::new();
    }
    let mut refs = vec![json!({"type": includes_type, "fromId": composition_id, "toId": child.id})];
    if let Some(target) = &child.target_variable {
        refs.push(child_target_ref(call_name, uses_type, &child.id, target));
    }
    refs
}

fn child_target_ref(call_name: &str, uses_type: &str, child_id: &str, target: &str) -> Value {
    let (flow, prompt, tool, routing) = if call_name == "parallel" {
        (
            "parallel.branch.uses_flow",
            "parallel.branch.uses_prompt",
            "parallel.branch.uses_tool",
            "parallel.branch.uses_routing",
        )
    } else {
        (
            "pipeline.stage.uses_flow",
            "pipeline.stage.uses_prompt",
            "pipeline.stage.uses_tool",
            "pipeline.stage.uses_routing",
        )
    };
    json!({
        "type": uses_type,
        "typeByTargetKind": {
            "agent": uses_type,
            "flow": flow,
            "prompt": prompt,
            "tool": tool,
            "routing.router": routing,
            "routing.split": routing,
            "routing.retry": routing,
            "routing.cascade": routing,
            "routing.fallback": routing,
        },
        "fromId": child_id,
        "toVariable": target,
    })
}

fn pipeline_stage_facts(
    composition_id: &str,
    stage_id: &str,
    index: usize,
    target: Option<&PipelineTarget>,
) -> Value {
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("composition.pipeline.stage".to_string()),
    );
    facts.insert(
        "compositionId".to_string(),
        Value::String(composition_id.to_string()),
    );
    facts.insert("stageId".to_string(), Value::String(stage_id.to_string()));
    facts.insert("index".to_string(), json!(index));
    if let Some(target) = target {
        facts.insert(
            "targetVariable".to_string(),
            Value::String(target.variable.clone()),
        );
    }
    Value::Object(facts)
}

fn child_intelligence(mode: &str, ordering: &str) -> Value {
    json!({
        "confidence": "static",
        "control": { "mode": mode, "ordering": ordering },
    })
}

fn includes_relation(call_name: &str) -> Option<&'static str> {
    match call_name {
        "parallel" => Some("parallel.includes_branch"),
        "pipeline" => Some("pipeline.includes_stage"),
        _ => None,
    }
}

fn uses_relation(call_name: &str) -> Option<&'static str> {
    match call_name {
        "parallel" => Some("parallel.branch.uses_agent"),
        "pipeline" => Some("pipeline.stage.uses_agent"),
        _ => None,
    }
}
