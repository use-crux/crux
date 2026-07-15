use serde_json::{Map, Value, json};

pub(crate) fn routing_runtime_join(
    id: &str,
    kind: &str,
    name: &str,
    metadata: &Map<String, Value>,
) -> Value {
    let mut span_attributes = Map::new();
    let mut runtime_join = Map::new();
    runtime_join.insert("definitionId".to_string(), Value::String(id.to_string()));
    runtime_join.insert("kind".to_string(), Value::String(kind.to_string()));
    runtime_join.insert("name".to_string(), Value::String(name.to_string()));

    match kind {
        "routing.router" => {
            let routing_id = metadata_string(metadata, "routingId")
                .unwrap_or_else(|| strip_definition_prefix(id, "routing.router:").to_string());
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.router".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("correlationAttributes".to_string(), json!(["routingId"]));
        }
        "routing.router.route" => {
            let routing_id = metadata_string(metadata, "routingId").unwrap_or_else(|| {
                metadata_string(metadata, "routerDefinitionId")
                    .map(|value| strip_definition_prefix(&value, "routing.router:").to_string())
                    .unwrap_or_default()
            });
            let route_key =
                metadata_string(metadata, "routeKey").unwrap_or_else(|| name.to_string());
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            span_attributes.insert("classifiedAs".to_string(), Value::String(route_key.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.router".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("routeKey".to_string(), Value::String(route_key));
            if let Some(parent) = metadata_string(metadata, "routerDefinitionId") {
                runtime_join.insert("parentDefinitionId".to_string(), Value::String(parent));
            }
            runtime_join.insert(
                "correlationAttributes".to_string(),
                json!(["routingId", "classifiedAs"]),
            );
        }
        "routing.split" => {
            let routing_id = metadata_string(metadata, "routingId")
                .unwrap_or_else(|| strip_definition_prefix(id, "routing.split:").to_string());
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.split".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("correlationAttributes".to_string(), json!(["routingId"]));
        }
        "routing.split.route" => {
            let routing_id = metadata_string(metadata, "routingId").unwrap_or_else(|| {
                metadata_string(metadata, "splitDefinitionId")
                    .map(|value| strip_definition_prefix(&value, "routing.split:").to_string())
                    .unwrap_or_default()
            });
            let route_key =
                metadata_string(metadata, "routeKey").unwrap_or_else(|| name.to_string());
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            span_attributes.insert("route".to_string(), Value::String(route_key.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.split".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("routeKey".to_string(), Value::String(route_key));
            if let Some(parent) = metadata_string(metadata, "splitDefinitionId") {
                runtime_join.insert("parentDefinitionId".to_string(), Value::String(parent));
            }
            runtime_join.insert(
                "correlationAttributes".to_string(),
                json!(["routingId", "route"]),
            );
        }
        "routing.retry" => {
            let routing_id = metadata_string(metadata, "routingId")
                .unwrap_or_else(|| strip_definition_prefix(id, "routing.retry:").to_string());
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.retry".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("correlationAttributes".to_string(), json!(["routingId"]));
        }
        "routing.retry.target" => {
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.retry".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            if let Some(routing_id) = metadata_string(metadata, "routingId") {
                span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
                runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            }
            if let Some(parent) = metadata_string(metadata, "retryDefinitionId") {
                runtime_join.insert("parentDefinitionId".to_string(), Value::String(parent));
            }
            runtime_join.insert("correlationAttributes".to_string(), json!(["routingId"]));
        }
        "routing.cascade" => {
            let routing_id = metadata_string(metadata, "routingId")
                .unwrap_or_else(|| strip_definition_prefix(id, "routing.cascade:").to_string());
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.cascade".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("correlationAttributes".to_string(), json!(["routingId"]));
        }
        "routing.cascade.tier" => {
            let routing_id = metadata_string(metadata, "routingId").unwrap_or_else(|| {
                metadata_string(metadata, "cascadeDefinitionId")
                    .map(|value| strip_definition_prefix(&value, "routing.cascade:").to_string())
                    .unwrap_or_default()
            });
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            if let Some(tier_index) = metadata.get("tierIndex").and_then(Value::as_i64) {
                span_attributes.insert(
                    "tierIndex".to_string(),
                    Value::String(tier_index.to_string()),
                );
            }
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.cascade".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            if let Some(parent) = metadata_string(metadata, "cascadeDefinitionId") {
                runtime_join.insert("parentDefinitionId".to_string(), Value::String(parent));
            }
            runtime_join.insert(
                "correlationAttributes".to_string(),
                json!(["routingId", "tierIndex"]),
            );
        }
        "routing.fallback" => {
            let routing_id = metadata_string(metadata, "routingId")
                .unwrap_or_else(|| strip_definition_prefix(id, "routing.fallback:").to_string());
            let routing_id = if routing_id.is_empty() {
                name.to_string()
            } else {
                routing_id
            };
            span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.fallback".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            runtime_join.insert("correlationAttributes".to_string(), json!(["routingId"]));
        }
        "routing.fallback.option" => {
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("routing.fallback".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            if let Some(routing_id) = metadata_string(metadata, "routingId") {
                span_attributes.insert("routingId".to_string(), Value::String(routing_id.clone()));
                runtime_join.insert("routingId".to_string(), Value::String(routing_id));
            }
            if let Some(option_index) = metadata.get("optionIndex").and_then(Value::as_i64) {
                span_attributes.insert(
                    "attempt".to_string(),
                    Value::String((option_index + 1).to_string()),
                );
            }
            if let Some(parent) = metadata_string(metadata, "fallbackDefinitionId") {
                runtime_join.insert("parentDefinitionId".to_string(), Value::String(parent));
            }
            runtime_join.insert(
                "correlationAttributes".to_string(),
                json!(["routingId", "attempt"]),
            );
        }
        "workspace" => {
            let workspace_id = strip_definition_prefix(id, "workspace:").to_string();
            span_attributes.insert(
                "workspaceId".to_string(),
                Value::String(workspace_id.clone()),
            );
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("workspace.operation".to_string()),
            );
            runtime_join.insert("workspaceId".to_string(), Value::String(workspace_id));
        }
        "rag.retriever" => {
            let retriever_id = strip_definition_prefix(id, "rag.retriever:").to_string();
            span_attributes.insert(
                "retrieverId".to_string(),
                Value::String(retriever_id.clone()),
            );
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("retrieval.*".to_string()),
            );
            runtime_join.insert("retrieverId".to_string(), Value::String(retriever_id));
        }
        "rag.recipe" => {
            let recipe_id = strip_definition_prefix(id, "rag.recipe:").to_string();
            span_attributes.insert("recipeId".to_string(), Value::String(recipe_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("retrieval.recipe".to_string()),
            );
            runtime_join.insert("recipeId".to_string(), Value::String(recipe_id));
        }
        "rag.pipeline" => {
            let rag_pipeline_id = strip_definition_prefix(id, "rag.pipeline:").to_string();
            span_attributes.insert(
                "ragPipelineId".to_string(),
                Value::String(rag_pipeline_id.clone()),
            );
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("rag.pipeline".to_string()),
            );
            runtime_join.insert("ragPipelineId".to_string(), Value::String(rag_pipeline_id));
        }
        "tool" => {
            let tool_name = name.to_string();
            span_attributes.insert("toolName".to_string(), Value::String(tool_name.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("tool.call".to_string()),
            );
            runtime_join.insert("toolName".to_string(), Value::String(tool_name));
        }
        "mcp.server" => {
            let server_id = name.to_string();
            span_attributes.insert("serverId".to_string(), Value::String(server_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("mcp.connect".to_string()),
            );
            runtime_join.insert("serverId".to_string(), Value::String(server_id));
        }
        "context" => {
            let context_id = strip_definition_prefix(id, "context:").to_string();
            span_attributes.insert("contextId".to_string(), Value::String(context_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("context.resolve".to_string()),
            );
            runtime_join.insert("contextId".to_string(), Value::String(context_id));
        }
        "prompt" => {
            let prompt_id = strip_definition_prefix(id, "prompt:").to_string();
            span_attributes.insert("promptId".to_string(), Value::String(prompt_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("prompt.resolve".to_string()),
            );
            runtime_join.insert("promptId".to_string(), Value::String(prompt_id));
        }
        "agent" => {
            let agent_id = strip_definition_prefix(id, "agent:").to_string();
            span_attributes.insert("agentId".to_string(), Value::String(agent_id.clone()));
            runtime_join.insert(
                "primitive".to_string(),
                Value::String("agent.run".to_string()),
            );
            runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
            runtime_join.insert("agentId".to_string(), Value::String(agent_id));
        }
        "flow" | "flow.step" => crate::runtime::flow::flow_runtime_join(
            kind,
            name,
            metadata,
            &mut span_attributes,
            &mut runtime_join,
        ),
        "memory" | "memory.store" | "memory.block" | "blackboard" => {
            crate::runtime::memory::memory_runtime_join(
                id,
                kind,
                metadata,
                &mut span_attributes,
                &mut runtime_join,
            )
        }
        _ => {}
    }

    runtime_join.insert("spanAttributes".to_string(), Value::Object(span_attributes));
    Value::Object(runtime_join)
}

pub(crate) fn metadata_string(metadata: &Map<String, Value>, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn strip_definition_prefix<'a>(value: &'a str, prefix: &str) -> &'a str {
    value.strip_prefix(prefix).unwrap_or(value)
}
