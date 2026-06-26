use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    data::access::{DataAccessRef, data_access_refs_for_value},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    flow::output::{flow_fact_metadata, flow_intelligence, flow_references, step_definitions},
    protocol::{LiteralValue, StaticFunctionCallValue, StaticSyntaxValue},
    record_values::{direct_string_property, has_property, property_value, resolve_static_value},
    routing::output::extracted_facts,
    schema::syntax_value_to_json_schema,
};

pub(crate) struct FlowStep {
    pub(crate) name: String,
    pub(crate) target_variable: Option<String>,
    pub(crate) data_accesses: Vec<DataAccessRef>,
    pub(crate) source_refs: Vec<Value>,
}

pub(crate) struct FlowSuspension {
    pub(crate) signal: String,
    pub(crate) step_name: Option<String>,
}

pub(crate) fn flow_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if !matches!(parts.callee_name, "flow" | "cruxFlow") || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg;
    let explicit_name = string_argument(parts.args.first())
        .or_else(|| config.and_then(|config| direct_string_property(config, "name")));
    let definition_key = explicit_name
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("flow:{}", safe_id(&definition_key));
    let runtime = flow_runtime(parts);
    let roots = flow_function_roots(context, config, parts);
    let steps = flow_steps(context, &definition_key, &roots)?;
    let step_names = unique_step_names(&steps);
    let step_ids = step_names
        .iter()
        .map(|name| {
            (
                name.clone(),
                format!("flow.step:{}:{}", safe_id(&definition_key), safe_id(name)),
            )
        })
        .collect::<Vec<_>>();
    let suspensions = flow_suspensions(&roots, step_names.last().map(String::as_str));
    let step_definitions =
        step_definitions(context, parts, &id, &definition_key, &step_names, &steps);

    let has_args = config.is_some_and(|config| has_property(config, "args"));
    let args_schema = config
        .and_then(|config| property_value(config, "args"))
        .and_then(|value| syntax_value_to_json_schema(Some(value), context));
    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("stepNames".to_string(), json!(step_names));
    if let Some(args) = config.and_then(|config| args_keys(context, config)) {
        metadata.insert("args".to_string(), json!(args));
    }
    if let Some(schema) = args_schema.clone() {
        metadata.insert("argsSchema".to_string(), schema);
    }
    metadata.insert("hasArgs".to_string(), Value::Bool(has_args));
    metadata.insert(
        "facts".to_string(),
        flow_fact_metadata(&step_names, has_args, runtime),
    );
    metadata.insert(
        "intelligence".to_string(),
        flow_intelligence(runtime, args_schema.as_ref(), &suspensions, &step_ids),
    );
    if runtime == "convex" {
        metadata.insert("runtime".to_string(), Value::String("convex".to_string()));
    }

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "flow",
            name: explicit_name.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        step_definitions,
        flow_references(&step_ids, &steps, &suspensions),
        Vec::new(),
    ))
}

fn flow_function_roots<'a>(
    context: &'a PrimitiveContext<'a>,
    config: Option<&'a StaticSyntaxValue>,
    parts: &'a CallParts<'a>,
) -> Vec<&'a StaticSyntaxValue> {
    config
        .and_then(|config| property_value(config, "handler"))
        .into_iter()
        .chain(parts.args.iter().skip(1))
        .filter_map(|value| {
            let resolved =
                resolve_static_value(value, &context.initializers, &mut Default::default());
            matches!(resolved, StaticSyntaxValue::Function { .. }).then_some(resolved)
        })
        .collect()
}

fn flow_steps(
    context: &PrimitiveContext<'_>,
    flow_key: &str,
    roots: &[&StaticSyntaxValue],
) -> Option<Vec<FlowStep>> {
    let mut steps = Vec::new();
    for call in roots.iter().flat_map(|root| function_calls(root)) {
        if call.callee.name != "step" {
            continue;
        }
        let Some(name) = string_argument(call.args.first()) else {
            continue;
        };
        let target = call.args.get(1);
        let target_variable = target.and_then(identifier_name).map(str::to_string);
        let definition_id = format!("flow.step:{}:{}", safe_id(flow_key), safe_id(&name));
        let data_accesses = target
            .map(|target| data_access_refs_for_value(context, target, 1))
            .unwrap_or_default();
        let source_refs = match &target_variable {
            Some(target_variable) => crate::flow::output::step_target_source_refs(
                context,
                &definition_id,
                target_variable,
            )?,
            None => Vec::new(),
        };
        steps.push(FlowStep {
            name,
            target_variable,
            data_accesses,
            source_refs,
        });
    }
    Some(steps)
}

fn flow_suspensions(
    roots: &[&StaticSyntaxValue],
    fallback_step_name: Option<&str>,
) -> Vec<FlowSuspension> {
    let mut refs = Vec::new();
    let mut current_step_name: Option<String> = None;
    for call in roots.iter().flat_map(|root| function_calls(root)) {
        if call.callee.name == "step" {
            current_step_name = string_argument(call.args.first());
        }
        if matches!(call.callee.name.as_str(), "waitFor" | "suspend") {
            if let Some(signal) = string_argument(call.args.first()) {
                refs.push(FlowSuspension {
                    signal,
                    step_name: current_step_name
                        .clone()
                        .or_else(|| fallback_step_name.map(str::to_string)),
                });
            }
        }
    }
    refs
}

fn args_keys(context: &PrimitiveContext<'_>, config: &StaticSyntaxValue) -> Option<Vec<String>> {
    let value = property_value(config, "args")?;
    let StaticSyntaxValue::Object { properties, .. } =
        resolve_static_value(value, &context.initializers, &mut Default::default())
    else {
        return None;
    };
    let keys = properties
        .iter()
        .filter(|property| property.spread != Some(true))
        .map(|property| property.name.clone())
        .collect::<Vec<_>>();
    (!keys.is_empty()).then_some(keys)
}

fn unique_step_names(steps: &[FlowStep]) -> Vec<String> {
    let mut names = Vec::new();
    for step in steps {
        if !names.contains(&step.name) {
            names.push(step.name.clone());
        }
    }
    names
}

pub(crate) fn function_calls(value: &StaticSyntaxValue) -> &[StaticFunctionCallValue] {
    match value {
        StaticSyntaxValue::Function { calls, .. } => calls,
        _ => &[],
    }
}

fn identifier_name(value: &StaticSyntaxValue) -> Option<&str> {
    match value {
        StaticSyntaxValue::Identifier { name } => Some(name),
        _ => None,
    }
}

fn string_argument(value: Option<&StaticSyntaxValue>) -> Option<String> {
    match value {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
}

fn flow_runtime(parts: &CallParts<'_>) -> &'static str {
    if parts.callee_local_name == Some("cruxFlow")
        || parts
            .callee_module_specifier
            .is_some_and(|module| module.starts_with("@use-crux/convex"))
    {
        "convex"
    } else {
        "node"
    }
}
