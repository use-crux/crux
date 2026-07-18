use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    eval::assertions::assertion_sites_from_source,
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_identifier, direct_string_property, object_array_value, property_value,
    },
    routing::output::extracted_facts,
};

pub(crate) fn eval_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    source_text: &str,
) -> Option<Value> {
    if parts.callee_name != "evaluate" || parts.callee_direct == Some(false) {
        return None;
    }
    if parts.args.first().and_then(string_argument).is_some() {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let name = explicit_id.clone().unwrap_or_else(|| {
        if parts.variable_name == "default" {
            derived_authored_eval_id(context.fingerprint_file)
        } else {
            parts.variable_name.to_string()
        }
    });
    let id = format!("eval:{}", safe_id(&name));
    let cases = eval_cases(context, parts, config, &id, &name);
    let total_cases = case_count(config, context);
    let coverage = task_coverage_refs(config, &id, explicit_id.as_deref());
    let assertion_sites =
        assertion_sites_from_source(context.file, parts.variable_name, source_text);

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("eval".to_string()));
    if total_cases > 0 {
        facts.insert("caseCount".to_string(), json!(total_cases));
    }
    if let Some(covers) = coverage.metadata.clone() {
        facts.insert("covers".to_string(), covers);
    }
    if !assertion_sites.is_empty() {
        facts.insert(
            "assertionSites".to_string(),
            Value::Array(assertion_sites.clone()),
        );
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("explicitId".to_string(), Value::Bool(explicit_id.is_some()));
    metadata.insert(
        "evalContract".to_string(),
        Value::String("crux.eval".to_string()),
    );
    metadata.insert("requiredHostCapabilities".to_string(), json!([]));
    facts.insert(
        "evalContract".to_string(),
        Value::String("crux.eval".to_string()),
    );
    facts.insert("requiredHostCapabilities".to_string(), json!([]));
    if total_cases > 0 {
        metadata.insert("caseCount".to_string(), json!(total_cases));
    }
    if let Some(covers) = coverage.metadata.clone() {
        metadata.insert("covers".to_string(), covers);
    }
    if !assertion_sites.is_empty() {
        metadata.insert("assertionSites".to_string(), Value::Array(assertion_sites));
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    let references = cases
        .iter()
        .map(|case| json!({ "type": "eval.includes_case", "fromId": id, "toId": case.id }))
        .chain(coverage.refs)
        .collect();

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "eval",
            name,
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        cases.into_iter().map(|case| case.definition).collect(),
        references,
        Vec::new(),
    ))
}

struct EvalCase {
    id: String,
    definition: Value,
}

fn eval_cases(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    eval_definition_id: &str,
    eval_name: &str,
) -> Vec<EvalCase> {
    object_array_value(property_value(config, "cases"), &context.initializers)
        .into_iter()
        .enumerate()
        .filter_map(|(index, case)| {
            let explicit_case_id = direct_string_property(case, "id");
            let case_name =
                direct_string_property(case, "name").or_else(|| explicit_case_id.clone())?;
            let case_id = safe_id(explicit_case_id.as_deref().unwrap_or(&case_name));
            let definition_id = format!("eval.case:{}:{}", safe_id(eval_name), case_id);
            let mut facts = Map::new();
            facts.insert("kind".to_string(), Value::String("eval.case".to_string()));
            facts.insert("evalId".to_string(), Value::String(eval_name.to_string()));

            let mut metadata = Map::new();
            metadata.insert("evalId".to_string(), Value::String(eval_name.to_string()));
            metadata.insert("caseId".to_string(), Value::String(case_id));
            metadata.insert("facts".to_string(), Value::Object(facts));
            metadata.insert(
                "indexPresentation".to_string(),
                folded_index_child(eval_definition_id, "eval.includes_case", "case", index),
            );
            Some(EvalCase {
                id: definition_id.clone(),
                definition: static_index_definition(NativeDefinitionInput {
                    id: definition_id,
                    kind: "eval.case",
                    name: case_name,
                    file: context.fingerprint_file,
                    source: parts.source,
                    snippet: parts.snippet,
                    metadata,
                }),
            })
        })
        .collect()
}

struct CoverageRefs {
    refs: Vec<Value>,
    metadata: Option<Value>,
}

fn task_coverage_refs(
    config: &StaticSyntaxValue,
    eval_definition_id: &str,
    explicit_id: Option<&str>,
) -> CoverageRefs {
    let explicit_targets = string_array_property(config, "covers");
    if !explicit_targets.is_empty() {
        return CoverageRefs {
            refs: explicit_targets
                .iter()
                .map(|to_id| {
                    json!({
                        "type": "eval.covers_definition",
                        "fromId": eval_definition_id,
                        "toId": to_id,
                    })
                })
                .collect(),
            metadata: Some(json!(explicit_targets)),
        };
    }

    let single = identifier_property(config, "task");
    let inferred = explicit_id.and_then(coverage_target_from_eval_id);
    let refs = if let Some(single) = &single {
        vec![match inferred {
            Some(fallback) => json!({
                "type": "eval.covers_definition",
                "fromId": eval_definition_id,
                "toVariable": single,
                "fallbackToId": fallback,
            }),
            None => json!({
                "type": "eval.covers_definition",
                "fromId": eval_definition_id,
                "toVariable": single,
            }),
        }]
    } else if let Some(inferred) = inferred {
        vec![json!({
            "type": "eval.covers_definition",
            "fromId": eval_definition_id,
            "toId": inferred,
        })]
    } else {
        Vec::new()
    };
    CoverageRefs {
        refs,
        metadata: single.map(|value| json!([value])),
    }
}

fn coverage_target_from_eval_id(explicit_id: &str) -> Option<String> {
    let (prefix, rest) = explicit_id.split_once('.')?;
    let target_prefix = match prefix {
        "prompt" => "prompt",
        "flow" => "flow",
        "agent" => "agent",
        "context" => "context",
        "memory" => "memory",
        _ => return None,
    };
    (!rest.is_empty()).then(|| format!("{target_prefix}:{}", safe_id(rest)))
}

fn case_count(config: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> usize {
    object_array_value(property_value(config, "cases"), &context.initializers).len()
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}

fn string_array_property(config: &StaticSyntaxValue, property: &str) -> Vec<String> {
    let Some(StaticSyntaxValue::Array { elements }) = property_value(config, property) else {
        return Vec::new();
    };
    elements.iter().filter_map(string_argument).collect()
}

fn string_argument(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}

fn derived_authored_eval_id(file: &str) -> String {
    let normalized = file.replace('\\', "/");
    let relative = normalized.strip_prefix("evals/").unwrap_or(&normalized);
    [".eval.tsx", ".eval.ts", ".eval.mjs", ".eval.js"]
        .iter()
        .find_map(|suffix| relative.strip_suffix(suffix))
        .unwrap_or(relative)
        .replace('/', ".")
}
