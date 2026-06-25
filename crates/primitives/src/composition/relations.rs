use serde_json::{Value, json};

use crate::{
    composition::output::{CompositionChild, composition_child_relation_refs},
    composition::values::{identifier_array, pipeline_stage_target},
    context::PrimitiveContext,
    definition::safe_id,
    protocol::StaticSyntaxValue,
    record_values::{
        direct_string_property, object_array_value, object_map_identifier_entries, property_value,
        reference_property,
    },
};

pub(crate) fn composition_references(
    context: &PrimitiveContext<'_>,
    call_name: &str,
    config: &StaticSyntaxValue,
    composition_id: &str,
    children: &[CompositionChild],
) -> Vec<Value> {
    let mut refs = composition_agent_refs(context, call_name, config)
        .into_iter()
        .map(composition_uses_ref)
        .collect::<Vec<_>>();
    refs.extend(structural_relation_refs(
        context,
        call_name,
        config,
        composition_id,
    ));
    refs.extend(composition_child_relation_refs(call_name, children));
    refs
}

fn composition_agent_refs(
    context: &PrimitiveContext<'_>,
    call_name: &str,
    config: &StaticSyntaxValue,
) -> Vec<String> {
    match call_name {
        "parallel" | "swarm" => {
            object_map_identifier_entries(property_value(config, "agents"), &context.initializers)
                .into_iter()
                .map(|(_, value)| value)
                .collect()
        }
        "consensus" => identifier_array(context, config, "agents"),
        "pipeline" => object_array_value(property_value(config, "steps"), &context.initializers)
            .into_iter()
            .filter_map(|stage| pipeline_stage_target(context, stage).map(|target| target.variable))
            .collect(),
        _ => Vec::new(),
    }
}

fn structural_relation_refs(
    context: &PrimitiveContext<'_>,
    call_name: &str,
    config: &StaticSyntaxValue,
    composition_id: &str,
) -> Vec<Value> {
    match call_name {
        "consensus" => consensus_relation_refs(context, config, composition_id),
        "swarm" => swarm_relation_refs(context, config, composition_id),
        _ => Vec::new(),
    }
}

fn consensus_relation_refs(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    composition_id: &str,
) -> Vec<Value> {
    let mut refs = identifier_array(context, config, "agents")
        .into_iter()
        .map(|to_variable| json!({"type": "consensus.includes_agent", "fromId": composition_id, "toVariable": to_variable}))
        .collect::<Vec<_>>();
    if let Some(judge) = reference_property(config, "judge", &context.initializers) {
        refs.push(json!({
            "type": "consensus.uses_judge",
            "typeByTargetKind": { "agent": "consensus.uses_judge", "scorer": "consensus.uses_scorer" },
            "fromId": composition_id,
            "toVariable": judge,
        }));
    }
    if let Some(scorer) = reference_property(config, "scorer", &context.initializers) {
        refs.push(json!({"type": "consensus.uses_scorer", "fromId": composition_id, "toVariable": scorer}));
    }
    refs
}

fn swarm_relation_refs(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    composition_id: &str,
) -> Vec<Value> {
    let mut refs = object_map_identifier_entries(property_value(config, "agents"), &context.initializers)
        .into_iter()
        .map(|(_, value)| json!({"type": "swarm.includes_agent", "fromId": composition_id, "toVariable": value}))
        .collect::<Vec<_>>();
    if let Some(coordinator) = direct_string_property(config, "startAgent") {
        refs.push(json!({"type": "swarm.coordinated_by", "fromId": composition_id, "toId": format!("agent:{}", safe_id(&coordinator))}));
    }
    if let Some(blackboard) = reference_property(config, "blackboard", &context.initializers) {
        refs.push(json!({"type": "swarm.uses_blackboard", "fromId": composition_id, "toVariable": blackboard}));
    }
    if let Some(memory) = reference_property(config, "memory", &context.initializers) {
        refs.push(
            json!({"type": "swarm.uses_memory", "fromId": composition_id, "toVariable": memory}),
        );
    }
    refs.extend(identifier_array(context, config, "memory").into_iter().map(
        |memory| json!({"type": "swarm.uses_memory", "fromId": composition_id, "toVariable": memory}),
    ));
    refs
}

fn composition_uses_ref(to_variable: String) -> Value {
    json!({
        "type": "composition.uses_agent",
        "typeByTargetKind": {
            "agent": "composition.uses_agent",
            "flow": "composition.uses_flow",
            "prompt": "composition.uses_prompt",
            "tool": "composition.uses_tool",
            "routing.router": "composition.uses_routing",
            "routing.cascade": "composition.uses_routing",
            "routing.fallback": "composition.uses_routing",
        },
        "toVariable": to_variable,
    })
}
