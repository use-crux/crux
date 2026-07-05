use serde_json::json;

use crate::analysis::run::analyze_static_index_facts;
use crate::finalizer::run::{
    finalize_static_index_values, finalize_static_index_values_with_policies,
};
use crate::protocol::static_index::{
    STATIC_INDEX_PROTOCOL_VERSION, StaticIndexAnalyzeFile, StaticIndexAnalyzeRequest,
    StaticIndexDigestIdentity, StaticIndexMethod, StaticIndexPlan, StaticIndexRunIdentity,
    StaticIndexSourceFile, StaticIndexVersionIdentity,
};
use crate::relation::model::relation_policy_table_from_value;

#[test]
fn analyze_uses_plan_call_names_instead_of_prompt_hardcode() {
    let source = "export const refundPrompt = prompt({ id: 'refund' })";

    assert!(
        analyze_static_index_facts(&request_with_call_names(
            vec!["defineWorkflow".to_string()],
            source,
        ))
        .is_empty()
    );

    let facts =
        analyze_static_index_facts(&request_with_call_names(vec!["prompt".to_string()], source));
    let facts = facts.into_wire_values();
    assert_eq!(facts[0]["definitions"][0]["id"], "prompt:refund");
}

#[test]
fn analyze_emits_source_rows_from_syntax_record_dependencies() {
    let root =
        std::env::temp_dir().join(format!("crux-static-index-analyze-{}", std::process::id()));
    let src_dir = root.join("src");
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&src_dir).expect("test src dir");
    let dependency = src_dir.join("context.ts");
    std::fs::write(&dependency, "export const brand = context({ id: 'brand' })")
        .expect("dependency source");
    let file = src_dir.join("prompt.ts");
    let source = "import { brand } from './context'\nexport const refundPrompt = prompt({ id: 'refund', use: [brand] })";

    let facts = analyze_static_index_facts(&request_with_root_file_and_call_names(
        root.to_string_lossy().to_string(),
        file.to_string_lossy().to_string(),
        vec!["prompt".to_string()],
        source,
    ));
    let facts = facts.into_wire_values();
    std::fs::remove_dir_all(&root).ok();

    let source_group = facts
        .iter()
        .find(|fact| fact["sources"].is_array())
        .expect("source facts should be emitted");
    assert_eq!(
        source_group["sources"][0]["file"].as_str(),
        Some(file.to_string_lossy().as_ref())
    );
    assert_eq!(
        source_group["sources"][0]["dependencies"],
        json!([dependency.to_string_lossy().to_string()])
    );
}

#[test]
fn analyze_uses_support_files_for_records_without_emitting_owner_rows() {
    let root =
        std::env::temp_dir().join(format!("crux-static-index-support-{}", std::process::id()));
    let src_dir = root.join("src");
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&src_dir).expect("test src dir");
    let helper_file = src_dir.join("helper.ts");
    let helper_source = "export const helper = context({ id: 'helper' })";
    std::fs::write(&helper_file, helper_source).expect("helper source");
    let prompt_file = src_dir.join("prompt.ts");
    let prompt_source = "import { helper } from './helper'\nexport const writer = prompt({ id: 'writer', use: [helper] })";

    let mut request = request_with_root_file_and_call_names(
        root.to_string_lossy().to_string(),
        prompt_file.to_string_lossy().to_string(),
        vec!["context".to_string(), "prompt".to_string()],
        prompt_source,
    );
    request.plan.primary_files = Some(request.plan.files.clone());
    request.files.push(StaticIndexAnalyzeFile {
        file: helper_file.to_string_lossy().to_string(),
        source_hash: "sha256:helper".to_string(),
        source_text: Some(helper_source.to_string()),
    });

    let facts = analyze_static_index_facts(&request);
    let facts = facts.into_wire_values();
    std::fs::remove_dir_all(&root).ok();

    assert!(
        facts
            .iter()
            .any(|fact| fact["definitions"][0]["id"] == "prompt:writer"),
        "primary file should still emit facts"
    );
    assert!(
        facts
            .iter()
            .all(|fact| fact["definitions"][0]["id"] != "context:helper"),
        "support file should not emit owner facts"
    );
    assert!(
        facts.iter().all(|fact| {
            fact["sources"]
                .as_array()
                .is_none_or(|sources| sources[0]["file"] != helper_file.to_string_lossy().as_ref())
        }),
        "support file should not emit an owned source row"
    );
}

#[test]
fn analyze_suppresses_duplicate_definition_packets_by_first_source_order() {
    let source = [
        "const first = llmJudge({ id: 'judge', detailSchema: schema })",
        "const second = llmJudge({ id: 'judge', criteria: 'later' })",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/scorers.ts".to_string(),
        vec!["llmJudge".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let scorer_groups = facts
        .iter()
        .filter(|fact| fact["definitions"][0]["id"] == "scorer:judge")
        .collect::<Vec<_>>();

    assert_eq!(
        scorer_groups.len(),
        1,
        "duplicate scorer definition packets should be suppressed"
    );
    assert_eq!(scorer_groups[0]["definitions"][0]["source"]["line"], 1);
    assert_eq!(
        scorer_groups[0]["definitions"][0]["metadata"]["configuration"]["detailSchema"],
        true
    );
}

#[test]
fn analyze_relation_refs_are_finalize_compatible() {
    let source = [
        "const supportPrompt = prompt({ id: 'support' })",
        "export const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_call_names(
        vec!["agent".to_string(), "prompt".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();

    let agent_group = facts
        .iter()
        .find(|fact| fact["definitions"][0]["id"] == "agent:support-agent")
        .expect("agent fact group");
    assert!(
        agent_group["relationRefs"][0]
            .get("typeByTargetKind")
            .is_none()
    );
    assert_eq!(
        agent_group["relationRefs"][0].get("source"),
        agent_group["definitions"][0].get("source")
    );

    let policies = relation_policy_table_from_value(Some(&json!({
        "relations": [{
            "type": "agent.uses_prompt",
            "fromKinds": ["agent"],
            "toKinds": ["prompt"],
            "presentation": "both",
            "fidelity": "partial",
            "runtimeJoin": false
        }]
    })))
    .expect("agent prompt relation policy");
    let output = finalize_static_index_values_with_policies(&facts, &[], &policies);
    assert!(
        output
            .model
            .facts
            .definitions
            .iter()
            .any(|definition| definition.id == "agent:support-agent")
    );
}

#[test]
fn analyze_rust_workspace_watch_as_read_and_transaction_as_write_access() {
    let source = [
        "const scratch = workspace({ id: 'scratch' })",
        "export const writer = tool({",
        "  name: 'writer',",
        "  execute: async () => {",
        "    scratch.watch('/workspace').stop()",
        "    await scratch.transaction(async (tx) => {",
        "      await tx.write('/draft.md', 'draft')",
        "    })",
        "  },",
        "})",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/tools/writer.ts".to_string(),
        vec!["tool".to_string(), "workspace".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let tool_group = facts
        .iter()
        .find(|fact| fact["definitions"][0]["id"] == "tool:writer")
        .expect("tool fact group");

    assert!(
        tool_group["definitions"][0]["metadata"]["intelligence"]["data"]["reads"]
            .as_array()
            .is_some_and(|reads| {
                reads
                    .iter()
                    .any(|read| read["targetVariable"] == "scratch" && read["operation"] == "watch")
            }),
        "Rust extraction should classify workspace.watch() as a read operation"
    );
    assert!(
        tool_group["definitions"][0]["metadata"]["intelligence"]["data"]["writes"]
            .as_array()
            .is_some_and(|writes| {
                writes.iter().any(|write| {
                    write["targetVariable"] == "scratch" && write["operation"] == "transaction"
                })
            }),
        "Rust extraction should classify workspace.transaction() as a write operation"
    );
    assert!(
        tool_group["relationRefs"].as_array().is_some_and(|refs| {
            refs.iter().any(|reference| {
                reference["toVariable"] == "scratch"
                    && reference["typeByTargetKind"]["workspace"] == "tool.writes_workspace"
            })
        }),
        "Rust extraction should emit a workspace-capable write relation ref"
    );

    let output = finalize_static_index_values(&facts, &[]);
    assert!(
        output.model.facts.relations.iter().any(|relation| {
            relation.r#type == "tool.writes_workspace"
                && relation.from == "tool:writer"
                && relation.to == "workspace:scratch"
        }),
        "Rust finalization should resolve transaction writes to the workspace definition"
    );
}

fn request_with_call_names(call_names: Vec<String>, source: &str) -> StaticIndexAnalyzeRequest {
    request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/prompts/refund.ts".to_string(),
        call_names,
        source,
    )
}

pub(crate) fn request_with_root_file_and_call_names(
    root: String,
    file: String,
    call_names: Vec<String>,
    source: &str,
) -> StaticIndexAnalyzeRequest {
    StaticIndexAnalyzeRequest {
        protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
        method: StaticIndexMethod::Analyze,
        stream: true,
        identity: run_identity(),
        plan: StaticIndexPlan {
            root,
            project_name: Some("acme".to_string()),
            files: vec![StaticIndexSourceFile {
                file: file.clone(),
                source_hash: "sha256:source-refund".to_string(),
                cache_key: None,
            }],
            primary_files: None,
            cache_hits: Vec::new(),
            cache_misses: Vec::new(),
            call_names,
            call_interests: Vec::new(),
            constructor_names: Vec::new(),
            constructor_interests: Vec::new(),
            prune_native_fact_call_names: Vec::new(),
        },
        files: vec![StaticIndexAnalyzeFile {
            file,
            source_hash: "sha256:source-refund".to_string(),
            source_text: Some(source.to_string()),
        }],
        extension_evidence_interests: None,
    }
}

fn run_identity() -> StaticIndexRunIdentity {
    StaticIndexRunIdentity {
        protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
        compiler: version_identity("crux-static-index"),
        oxc: version_identity("oxc-rust"),
        primitive_manifest: digest_identity("crux-first-party-primitives"),
        relation_policy: digest_identity("crux-relation-policy"),
        extension_manifests: Vec::new(),
        rule_descriptors: digest_identity("crux-indexer-rule-descriptors"),
        compiler_projection: digest_identity("crux-static-projection"),
    }
}

fn version_identity(name: &str) -> StaticIndexVersionIdentity {
    StaticIndexVersionIdentity {
        name: name.to_string(),
        version: "test".to_string(),
    }
}

fn digest_identity(name: &str) -> StaticIndexDigestIdentity {
    StaticIndexDigestIdentity {
        name: name.to_string(),
        version: "test".to_string(),
        digest: None,
    }
}
