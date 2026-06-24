//! Injection-specific built-in lint orchestration.

use std::collections::BTreeMap;

use crate::index_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticIndexPatchFacts, NativeStaticLintFinding,
};
use crate::lints::builder::{NativeStaticLintBuilder, definition_evidence};
use crate::lints::emit::push_definition_finding;
use crate::lints::injection::entries::{indirect_tool_surface_findings, injection_entry_findings};
use crate::lints::injection::evidence::injection_consumed_definition_ids;
use crate::lints::injection::inputs::prompt_input_injection_findings;
use crate::lints::injection::model::build_all_injection_models;

pub(crate) fn injection_lint_findings<'a>(
    builder: &NativeStaticLintBuilder,
    facts: &'a NativeStaticIndexPatchFacts,
    by_id: &BTreeMap<&'a str, &'a NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let models = build_all_injection_models(&facts.definitions, &facts.relations, by_id);
    let consumers = injection_consumed_definition_ids(&facts.relations);
    let mut findings = Vec::new();
    for definition in &facts.definitions {
        if let Some(model) = models.get(definition.id.as_str()) {
            if definition.kind == "prompt" {
                findings.extend(prompt_input_injection_findings(
                    builder, definition, model, by_id,
                ));
                findings.extend(indirect_tool_surface_findings(
                    builder, definition, model, by_id,
                ));
            }
            findings.extend(injection_entry_findings(builder, definition, model, by_id));
        }
        if definition.kind == "injectable" && !consumers.contains(&definition.id) {
            push_definition_finding(
                builder,
                &mut findings,
                "injectable.unused",
                definition,
                format!(
                    "Injectable \"{}\" is not reached by any static injection relation.",
                    definition.name
                ),
                vec![definition_evidence(
                    definition,
                    "Injectable has no static consumers",
                )],
            );
        }
        if definition.kind == "context" && !consumers.contains(&definition.id) {
            push_definition_finding(
                builder,
                &mut findings,
                "context.unused",
                definition,
                format!(
                    "Context \"{}\" is not reached by any static injection relation.",
                    definition.name
                ),
                vec![definition_evidence(
                    definition,
                    "Context has no static consumers",
                )],
            );
        }
    }
    findings
}
