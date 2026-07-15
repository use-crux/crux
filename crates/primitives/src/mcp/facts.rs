use std::collections::HashSet;

use serde_json::{Map, Value, json};
use url::Url;

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{direct_string_property, property_value, resolve_static_value},
    routing::output::extracted_facts,
};

pub(crate) fn mcp_server_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "mcp" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let server_id = direct_string_property(config, "id")?;
    let definition_id = format!("mcp.server:{}", safe_id(&server_id));
    let mut facts = Map::new();
    facts.insert("kind".into(), json!("mcp.server"));
    facts.insert("serverId".into(), json!(server_id));
    if let Some(transport) = transport_facts(context, config) {
        facts.insert("transport".into(), transport);
    }
    if let Some(tools) = selection_facts(config) {
        facts.insert("tools".into(), tools);
    }

    let mut metadata = Map::new();
    if parts.exported {
        metadata.insert("exportName".into(), json!(parts.variable_name));
    }
    metadata.insert("facts".into(), Value::Object(facts));
    let mut definition = static_index_definition(NativeDefinitionInput {
        id: definition_id.clone(),
        kind: "mcp.server",
        name: server_id.clone(),
        file: context.fingerprint_file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    definition.as_object_mut()?.remove("sourceSnippet");

    let expected_tools = expected_tool_definitions(config, parts, &server_id);
    let references = expected_tools
        .iter()
        .filter_map(|tool| tool.get("id").and_then(Value::as_str))
        .map(|tool_id| {
            json!({
                "type": "mcp.server.provides_tool",
                "fromId": definition_id,
                "toId": tool_id,
            })
        })
        .collect();
    Some(extracted_facts(
        parts.variable_name,
        definition,
        expected_tools,
        references,
        Vec::new(),
    ))
}

fn transport_facts(context: &PrimitiveContext<'_>, config: &StaticSyntaxValue) -> Option<Value> {
    let transport = property_value(config, "transport")?;
    let resolved = resolve_static_value(transport, &context.initializers, &mut HashSet::new());
    match resolved {
        StaticSyntaxValue::Call { callee, args, .. } if callee.name == "stdio" => {
            let config = args.first()?;
            let mut facts = Map::new();
            facts.insert("kind".into(), json!("stdio"));
            if let Some(command) =
                direct_string_property(config, "command").and_then(|value| lexical_basename(&value))
            {
                facts.insert("executable".into(), json!(command));
            }
            Some(Value::Object(facts))
        }
        StaticSyntaxValue::Call { callee, args, .. } if callee.name == "streamableHttp" => {
            let config = args.first()?;
            let mut facts = Map::new();
            facts.insert("kind".into(), json!("streamable-http"));
            if let Some(url) = direct_string_property(config, "url").and_then(safe_http_url) {
                facts.insert("origin".into(), json!(url.origin().ascii_serialization()));
                facts.insert("pathname".into(), json!(url.path()));
            }
            Some(Value::Object(facts))
        }
        StaticSyntaxValue::Function { .. } => Some(json!({ "kind": "resolver" })),
        _ => None,
    }
}

fn selection_facts(config: &StaticSyntaxValue) -> Option<Value> {
    let tools = property_value(config, "tools")?;
    let prefix = direct_string_property(tools, "prefix");
    let allow = literal_string_array(property_value(tools, "allow"));
    let deny = literal_string_array(property_value(tools, "deny"));
    let mut facts = Map::new();
    if let Some(allow) = allow {
        facts.insert("allow".into(), json!(allow));
    } else if let Some(deny) = deny {
        facts.insert("deny".into(), json!(deny));
    }
    if let Some(prefix) = prefix {
        facts.insert("prefix".into(), json!(prefix));
    }
    (!facts.is_empty()).then_some(Value::Object(facts))
}

fn expected_tool_definitions(
    config: &StaticSyntaxValue,
    parts: &CallParts<'_>,
    server_id: &str,
) -> Vec<Value> {
    let Some(tools) = property_value(config, "tools") else {
        return Vec::new();
    };
    let Some(allow) = literal_string_array(property_value(tools, "allow")) else {
        return Vec::new();
    };
    let prefix = direct_string_property(tools, "prefix").unwrap_or_default();
    allow
        .into_iter()
        .map(|remote_name| {
            let exposed_name = format!("{prefix}{remote_name}");
            json!({
                "id": format!("tool:{}", safe_id(&exposed_name)),
                "kind": "tool",
                "name": exposed_name,
                "source": parts.source,
                "fidelity": "partial",
                "metadata": {
                    "facts": {
                        "kind": "tool",
                        "toolName": exposed_name,
                        "mcp": {
                            "serverId": server_id,
                            "remoteName": remote_name,
                            "exposedName": exposed_name,
                            "provenance": "authored-expected",
                        },
                    },
                },
            })
        })
        .collect()
}

fn literal_string_array(value: Option<&StaticSyntaxValue>) -> Option<Vec<String>> {
    let StaticSyntaxValue::Array { elements } = value? else {
        return None;
    };
    elements
        .iter()
        .map(|value| match value {
            StaticSyntaxValue::Literal {
                value: LiteralValue::String(value),
            } => Some(value.clone()),
            _ => None,
        })
        .collect()
}

fn lexical_basename(value: &str) -> Option<String> {
    value
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .map(str::to_string)
}

fn safe_http_url(value: String) -> Option<Url> {
    let url = Url::parse(&value).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}
