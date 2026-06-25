use serde_json::json;

use crate::analysis::run::analyze_native_static_facts;
use crate::finalizer::run::finalize_native_static_values_with_policies;
use crate::protocol::native_static::{
    NATIVE_STATIC_PROTOCOL_VERSION, NativeStaticAnalyzeFile, NativeStaticAnalyzeRequest,
    NativeStaticDigestIdentity, NativeStaticMethod, NativeStaticPlan, NativeStaticRunIdentity,
    NativeStaticSourceFile, NativeStaticVersionIdentity,
};
use crate::relation::model::relation_policy_table_from_value;

#[test]
fn analyze_uses_plan_call_names_instead_of_prompt_hardcode() {
    let source = "export const refundPrompt = prompt({ id: 'refund' })";

    assert!(
        analyze_native_static_facts(&request_with_call_names(
            vec!["defineWorkflow".to_string()],
            source,
        ))
        .is_empty()
    );

    let facts =
        analyze_native_static_facts(&request_with_call_names(vec!["prompt".to_string()], source));
    let facts = facts.into_wire_values();
    assert_eq!(facts[0]["definitions"][0]["id"], "prompt:refund");
}

#[test]
fn analyze_emits_source_rows_from_syntax_record_dependencies() {
    let root =
        std::env::temp_dir().join(format!("crux-native-static-analyze-{}", std::process::id()));
    let src_dir = root.join("src");
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&src_dir).expect("test src dir");
    let dependency = src_dir.join("context.ts");
    std::fs::write(&dependency, "export const brand = context({ id: 'brand' })")
        .expect("dependency source");
    let file = src_dir.join("prompt.ts");
    let source = "import { brand } from './context'\nexport const refundPrompt = prompt({ id: 'refund', use: [brand] })";

    let facts = analyze_native_static_facts(&request_with_root_file_and_call_names(
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
        std::env::temp_dir().join(format!("crux-native-static-support-{}", std::process::id()));
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
    request.files.push(NativeStaticAnalyzeFile {
        file: helper_file.to_string_lossy().to_string(),
        source_hash: "sha256:helper".to_string(),
        source_text: Some(helper_source.to_string()),
    });

    let facts = analyze_native_static_facts(&request);
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
    let facts = analyze_native_static_facts(&request_with_root_file_and_call_names(
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
    let facts = analyze_native_static_facts(&request_with_call_names(
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
    let output = finalize_native_static_values_with_policies(&facts, &[], &policies);
    assert!(
        output
            .model
            .facts
            .definitions
            .iter()
            .any(|definition| definition.id == "agent:support-agent")
    );
}

fn request_with_call_names(call_names: Vec<String>, source: &str) -> NativeStaticAnalyzeRequest {
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
) -> NativeStaticAnalyzeRequest {
    NativeStaticAnalyzeRequest {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        method: NativeStaticMethod::Analyze,
        stream: true,
        identity: run_identity(),
        plan: NativeStaticPlan {
            root,
            project_name: Some("acme".to_string()),
            files: vec![NativeStaticSourceFile {
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
        files: vec![NativeStaticAnalyzeFile {
            file,
            source_hash: "sha256:source-refund".to_string(),
            source_text: Some(source.to_string()),
        }],
        extension_evidence_interests: None,
    }
}

fn run_identity() -> NativeStaticRunIdentity {
    NativeStaticRunIdentity {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        compiler: version_identity("crux-native-static"),
        oxc: version_identity("oxc-rust"),
        primitive_manifest: digest_identity("crux-first-party-primitives"),
        relation_policy: digest_identity("crux-relation-policy"),
        extension_manifests: Vec::new(),
        first_party_graph_rules: digest_identity("crux-first-party-graph-rules"),
        compiler_projection: digest_identity("crux-static-projection"),
    }
}

fn version_identity(name: &str) -> NativeStaticVersionIdentity {
    NativeStaticVersionIdentity {
        name: name.to_string(),
        version: "test".to_string(),
    }
}

fn digest_identity(name: &str) -> NativeStaticDigestIdentity {
    NativeStaticDigestIdentity {
        name: name.to_string(),
        version: "test".to_string(),
        digest: None,
    }
}
