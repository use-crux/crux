use serde_json::json;

use crate::core::facts::StaticIndexFidelity;
use crate::finalizer::run::finalize_static_index_values;

#[test]
fn relation_refs_use_stable_fallback_target_ids() {
    let output = finalize_static_index_values(
        &[json!({
            "definitions": [{
                "id": "prompt:answer",
                "kind": "prompt",
                "name": "answer",
                "fidelity": "resolved",
                "status": "active"
            }],
            "relationRefs": [{
                "ownerDefinitionId": "prompt:answer",
                "type": "prompt.uses_context",
                "toVariable": "groundedDocs"
            }]
        })],
        &[],
    );

    assert_eq!(output.model.report.counts.resolved, 1);
    assert_eq!(output.model.facts.diagnostics, vec![]);
    assert_eq!(
        output.model.facts.relations[0].id,
        "relation:prompt.uses_context:prompt:answer:context:grounded-docs"
    );
    assert_eq!(
        output.model.facts.relations[0].fidelity,
        StaticIndexFidelity::Partial
    );
}
