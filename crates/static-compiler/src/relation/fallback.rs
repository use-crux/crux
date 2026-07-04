//! Stable fallback target ids for unresolved static relation refs.

/// Synthesizes the same fallback target id as the TypeScript relation resolver.
pub(crate) fn fallback_relation_target_id(
    relation_type: &str,
    variable: Option<&str>,
) -> Option<String> {
    let variable = variable?;
    match relation_type {
        "agent.uses_prompt" | "flow.step.uses_prompt" => {
            Some(format!("prompt:{}", safe_use_entry_id(variable)))
        }
        "prompt.uses_context" | "context.uses_context" | "injectable.uses_context" => {
            Some(format!("context:{}", safe_use_entry_id(variable)))
        }
        "prompt.uses_injectable" | "context.uses_injectable" => {
            Some(format!("injectable:{}", safe_use_entry_id(variable)))
        }
        "prompt.uses_tool"
        | "context.uses_tool"
        | "injectable.uses_tool"
        | "agent.uses_tool"
        | "flow.step.uses_tool" => Some(format!("tool:{variable}")),
        "prompt.uses_memory"
        | "context.uses_memory"
        | "agent.reads_memory"
        | "agent.writes_memory"
        | "prompt.reads_memory"
        | "prompt.writes_memory"
        | "context.reads_memory"
        | "context.writes_memory"
        | "tool.reads_memory"
        | "tool.writes_memory"
        | "flow.step.uses_memory"
        | "flow.step.reads_memory"
        | "flow.step.writes_memory"
        | "swarm.uses_memory" => Some(format!("memory:{}", safe_use_entry_id(variable))),
        "prompt.uses_blackboard"
        | "context.uses_blackboard"
        | "agent.reads_blackboard"
        | "agent.writes_blackboard"
        | "prompt.reads_blackboard"
        | "prompt.writes_blackboard"
        | "context.reads_blackboard"
        | "context.writes_blackboard"
        | "tool.reads_blackboard"
        | "tool.writes_blackboard"
        | "flow.step.uses_blackboard"
        | "flow.step.reads_blackboard"
        | "flow.step.writes_blackboard"
        | "swarm.uses_blackboard" => Some(format!("blackboard:{}", safe_use_entry_id(variable))),
        "agent.reads_workspace"
        | "agent.writes_workspace"
        | "prompt.reads_workspace"
        | "prompt.writes_workspace"
        | "context.reads_workspace"
        | "context.writes_workspace"
        | "tool.reads_workspace"
        | "tool.writes_workspace"
        | "flow.step.reads_workspace"
        | "flow.step.writes_workspace" => {
            Some(format!("workspace:{}", safe_use_entry_id(variable)))
        }
        "rag.recipe.uses_retriever"
        | "rag.recipe.step.uses_retriever"
        | "rag.pipeline.uses_retriever"
        | "rag.pipeline.stage.uses_retriever" => {
            Some(format!("rag.retriever:{}", safe_use_entry_id(variable)))
        }
        "storage.bundle.uses_record_store"
        | "rag.retriever.uses_record_store"
        | "workspace.uses_record_store" => Some(format!(
            "storage.recordStore:{}",
            safe_use_entry_id(variable)
        )),
        "storage.bundle.uses_vector_store"
        | "rag.retriever.uses_vector_store"
        | "workspace.uses_vector_store" => Some(format!(
            "storage.vectorStore:{}",
            safe_use_entry_id(variable)
        )),
        "storage.bundle.uses_blob_store"
        | "rag.retriever.uses_blob_store"
        | "workspace.uses_blob_store" => {
            Some(format!("storage.blobStore:{}", safe_use_entry_id(variable)))
        }
        "storage.scope.wraps_storage" | "rag.retriever.uses_storage" | "workspace.uses_storage" => {
            Some(format!("storage.bundle:{}", safe_use_entry_id(variable)))
        }
        "evaluation.scores_prompt" => Some(format!("prompt:{}", safe_use_entry_id(variable))),
        "evaluation.uses_scorer" => Some(format!("scorer:{}", safe_use_entry_id(variable))),
        "constraint.applies_to" | "guardrail.applies_to" | "eval.covers_definition" => {
            variable.contains(':').then(|| variable.to_string())
        }
        _ => None,
    }
}

pub(crate) fn safe_use_entry_id(value: &str) -> String {
    let mut output = String::new();
    let mut previous_was_lower_or_digit = false;
    for character in value.chars() {
        if character.is_ascii_uppercase() && previous_was_lower_or_digit {
            output.push('-');
        }
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            output.push(character.to_ascii_lowercase());
            previous_was_lower_or_digit =
                character.is_ascii_lowercase() || character.is_ascii_digit();
        } else {
            output.push('-');
            previous_was_lower_or_digit = false;
        }
    }
    output.trim_matches('-').to_string()
}
