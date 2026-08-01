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
    assert_eq!(
        facts[0]["definitionExtractors"]["prompt:refund"],
        json!([{ "name": "prompt" }])
    );
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
fn analyze_retains_duplicate_effect_call_site_evidence_for_finalization() {
    let source = [
        "import { effect } from '@use-crux/core/effect'",
        "const execute = async () => undefined",
        "export const first = effect('payments.charge', execute, { version: 1.5 })",
        "const second = effect('payments.charge', execute, { version: 1.5 })",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/effects.ts".to_string(),
        vec!["effect".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let effect_groups = facts
        .iter()
        .filter(|fact| fact["definitions"][0]["id"] == "effect:payments.charge:v1.5")
        .collect::<Vec<_>>();

    assert_eq!(effect_groups.len(), 2);
    assert_ne!(
        effect_groups[0]["sourceRefs"][0]["ref"]["id"],
        effect_groups[1]["sourceRefs"][0]["ref"]["id"]
    );

    let finalized = finalize_static_index_values(&facts, &[]);
    let effect = finalized
        .model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "effect:payments.charge:v1.5")
        .expect("finalized Effect definition");
    assert_eq!(effect.source_refs.len(), 2);
    assert!(
        finalized
            .model
            .facts
            .lint_findings
            .iter()
            .any(|finding| finding.rule_id == "effect.duplicate_identity"),
        "effect={effect:?}, lints={:?}",
        finalized.model.facts.lint_findings
    );
}

#[test]
fn analyze_finds_only_certain_irreversible_effects_in_required_boundaries() {
    let source =
        include_str!("../../../../../packages/indexer/fixtures/effect-static-project/effects.ts");
    let facts = analyze_static_index_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/effects.ts".to_string(),
        vec!["effect".to_string(), "rollbackOnError".to_string()],
        source,
    ));
    let finalized = finalize_static_index_values(&facts.into_wire_values(), &[]);
    let findings = finalized
        .model
        .facts
        .lint_findings
        .iter()
        .filter(|finding| finding.rule_id == "effect.irreversible_in_required_boundary")
        .collect::<Vec<_>>();

    assert_eq!(findings.len(), 1, "findings={findings:?}");
    let finding = findings[0];
    assert!(finding.message.contains("inventory.reserve"));
    assert!(finding.message.contains("src/effects.ts:33"));
    for action in ["Define recovery", "move the Effect outside", "best-effort"] {
        assert!(
            finding.message.contains(action),
            "message={}",
            finding.message
        );
    }
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
    assert_eq!(
        agent_group["relationRefs"][0]["extractors"],
        json!([{ "name": "agent" }])
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
    let relation = output
        .model
        .facts
        .relations
        .iter()
        .find(|relation| relation.r#type == "agent.uses_prompt")
        .expect("agent prompt relation");
    assert_eq!(
        output
            .model
            .facts
            .fact_extractors
            .get(&format!("relations:{}", relation.id)),
        Some(&vec![
            crate::core::facts::StaticIndexFactExtractorProvenance {
                name: "agent".to_string(),
                extension: None,
            }
        ])
    );
}

#[test]
fn analyze_eval_after_scores_assertion_sites_match_eval_authoring_api() {
    let source = [
        "export const supportEval = evaluate({",
        "  id: 'support.answer',",
        "  task: (input: { question: string }) => input.question,",
        "  cases: [{ name: 'refund', input: { question: 'refund?' } }],",
        "  afterScores: (ctx) => {",
        "    ctx.expect(ctx.score.pass).toBeTruthy()",
        "    ctx.assert(ctx.output)",
        "  },",
        "})",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_call_names(
        vec!["evaluate".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let evaluation = facts
        .iter()
        .flat_map(|fact| fact["definitions"].as_array().into_iter().flatten())
        .find(|definition| definition["id"] == "eval:support.answer")
        .expect("Eval definition");
    let assertion_sites = evaluation["metadata"]["facts"]["assertionSites"]
        .as_array()
        .expect("Eval should expose assertion sites");

    assert_eq!(
        assertion_sites.len(),
        1,
        "ctx.assert is not an Eval assertion site"
    );
    assert_eq!(assertion_sites[0]["callbackKind"], "expect");
    assert_eq!(assertion_sites[0]["callbackLevel"], "eval");
}

#[test]
fn analyze_default_exported_authored_eval_emits_registry_corroboration() {
    let source = [
        "export default evaluate({",
        "  id: 'support',",
        "  task: supportTask,",
        "  cases: [{ id: 'refund', input: { question: 'refund?' } }],",
        "})",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_call_names(
        vec!["evaluate".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let evaluation = facts
        .iter()
        .flat_map(|fact| fact["definitions"].as_array().into_iter().flatten())
        .find(|definition| definition["id"] == "eval:support")
        .expect("authored Eval definition");

    assert_eq!(evaluation["metadata"]["exportName"], "default");
    assert_eq!(evaluation["metadata"]["evalContract"], "crux.eval");
    assert_eq!(
        evaluation["metadata"]["requiredHostCapabilities"],
        json!([])
    );
    assert_eq!(evaluation["metadata"]["caseCount"], 1);
}

#[test]
fn analyze_eval_emits_current_definition_facts_from_literal_config() {
    let source = [
        "export const supportEval = evaluate({",
        "  id: 'support.answer',",
        "  task: (input: { question: string }) => input.question,",
        "  covers: ['prompt:support.answer'],",
        "  cases: [{ id: 'refund', input: { question: 'refund?' } }],",
        "})",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_call_names(
        vec!["evaluate".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let evaluation = facts
        .iter()
        .flat_map(|fact| fact["definitions"].as_array().into_iter().flatten())
        .find(|definition| definition["id"] == "eval:support.answer")
        .expect("Eval definition");
    let facts = &evaluation["metadata"]["facts"];

    assert_eq!(facts["caseCount"], json!(1));
    assert_eq!(facts["evalContract"], json!("crux.eval"));
    assert_eq!(facts["covers"], json!(["prompt:support.answer"]));
}

#[test]
fn analyze_resolves_function_return_tools_with_rust_binding_evidence() {
    let source = [
        "const searchTool = tool({ name: 'search', execute: () => null })",
        "const lateTool = tool({ name: 'late', execute: () => null })",
        "function makeTools() {",
        "  const tools = { search: searchTool }",
        "  {",
        "    const tools = { wrong: lateTool }",
        "  }",
        "  return tools",
        "  {",
        "    const tools = { late: lateTool }",
        "  }",
        "}",
        "export const assistant = prompt({ id: 'assistant', tools: makeTools() })",
    ]
    .join("\n");
    let facts = analyze_static_index_facts(&request_with_call_names(
        vec!["prompt".to_string(), "tool".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let prompt_group = facts
        .iter()
        .find(|fact| fact["definitions"][0]["id"] == "prompt:assistant")
        .expect("prompt fact group");
    let tool_variables = prompt_group["definitions"][0]["metadata"]["facts"]["tools"]["variables"]
        .as_array()
        .expect("prompt tool facts should include variables")
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>();

    assert_eq!(tool_variables, vec!["searchTool"]);
    assert!(
        prompt_group["relationRefs"].as_array().is_some_and(|refs| {
            refs.iter().any(|reference| {
                reference["type"] == "prompt.uses_tool" && reference["toVariable"] == "searchTool"
            }) && refs
                .iter()
                .all(|reference| reference["toVariable"] != "lateTool")
        }),
        "prompt relation refs should use the return-site binding, not later or nested shadows"
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
