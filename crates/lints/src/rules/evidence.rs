//! Conclusive lint rules for authored `evidence.record()` definitions.

use serde_json::Value;

use crate::{
    builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence},
    facts::{StaticIndexDefinition, StaticIndexLintFinding},
};

pub(crate) fn evidence_record_findings(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
) -> Vec<StaticIndexLintFinding> {
    if definition.kind != "evidence.record" {
        return Vec::new();
    }
    let facts = definition
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("facts"))
        .and_then(Value::as_object);
    let classification = facts
        .and_then(|facts| facts.get("evidenceKind"))
        .and_then(Value::as_object)
        .and_then(|kind| kind.get("classification"))
        .and_then(Value::as_str);
    let source_form = facts
        .and_then(|facts| facts.get("sourceForm"))
        .and_then(Value::as_str);
    let rule = match (classification, source_form) {
        (Some("invalid"), _) => Some((
            "evidence.invalid-custom-kind",
            "Evidence kind must be canonical or a valid bounded custom.* value.",
        )),
        (Some("canonical"), Some("inline")) => Some((
            "evidence.reserved-inline-kind",
            "Canonical evidence kinds are reserved for existing references; inline evidence requires custom.*.",
        )),
        _ => None,
    };
    rule.and_then(|(rule_id, message)| {
        builder.finding(StaticIndexLintFindingInput {
            rule_id,
            key: definition.id.as_str(),
            message: message.to_string(),
            source: definition.source.as_ref(),
            primary_definition_id: Some(definition.id.as_str()),
            related_definition_ids: Vec::new(),
            evidence: vec![definition_evidence(
                definition,
                "Authored execution-evidence call",
            )],
            fixes: Vec::new(),
        })
    })
    .into_iter()
    .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn diagnoses_invalid_and_reserved_kinds_without_speculating_about_dynamic_values() {
        let builder = StaticIndexLintBuilder::new();
        let cases = [
            ("invalid", "inline", Some("evidence.invalid-custom-kind")),
            ("canonical", "inline", Some("evidence.reserved-inline-kind")),
            ("unresolved", "inline", None),
            ("custom", "inline", None),
            ("canonical", "reference", None),
        ];
        for (classification, source_form, expected) in cases {
            let definition: StaticIndexDefinition = serde_json::from_value(json!({
                "id": format!("evidence.record:{classification}:{source_form}"),
                "kind": "evidence.record",
                "name": "record",
                "fidelity": "resolved",
                "metadata": {
                    "facts": {
                        "kind": "evidence.record",
                        "evidenceKind": { "classification": classification },
                        "sourceForm": source_form,
                    }
                }
            }))
            .expect("evidence definition decodes");
            let findings = evidence_record_findings(&builder, &definition);
            assert_eq!(
                findings.first().map(|finding| finding.rule_id.as_str()),
                expected
            );
        }
    }
}
