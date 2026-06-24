use serde_json::json;

use crate::protocol::static_compiler::NativeStaticAnalyzeFile;
use crate::static_compiler::analysis::run::analyze_native_static_facts;
use crate::static_compiler::analysis::tests::request_with_root_file_and_call_names;
use crate::static_compiler::finalizer::run::{
    finalize_native_static_values, finalize_native_static_values_with_policies,
};
use crate::static_compiler::relation::model::relation_policy_table_from_value;

#[test]
fn analyze_emits_tree_path_definition_overlays_from_local_creators() {
    let source = [
        "const tone = context({ id: 'tone' })",
        "const answer = prompt({ id: 'answer' })",
        "export const contexts = createContexts({ brand: { voice: tone } })",
        "export const prompts = createPrompts({ qa: { answer } })",
    ]
    .join("\n");
    let facts = analyze_native_static_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/prompts/refund.ts".to_string(),
        vec!["context".to_string(), "prompt".to_string()],
        &source,
    ));
    let output = finalize_native_static_values(&facts, &[]);

    let context = output
        .model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "context:tone")
        .expect("context definition");
    assert_eq!(context.path, vec!["brand".to_string(), "voice".to_string()]);

    let prompt = output
        .model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "prompt:answer")
        .expect("prompt definition");
    assert_eq!(prompt.path, vec!["qa".to_string(), "answer".to_string()]);
}

#[test]
fn analyze_emits_tree_path_definition_overlays_from_imported_leaves() {
    let root = std::env::temp_dir().join(format!(
        "crux-native-static-tree-paths-{}",
        std::process::id()
    ));
    let src_dir = root.join("src");
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&src_dir).expect("test src dir");
    let helper_file = src_dir.join("shared.ts");
    let helper_source = "export const sharedPrompt = prompt({ id: 'shared' })";
    std::fs::write(&helper_file, helper_source).expect("helper source");
    let main_file = src_dir.join("catalog.ts");
    let main_source = "import { sharedPrompt } from './shared'\nexport const prompts = createPrompts({ shared: { answer: sharedPrompt } })";
    std::fs::write(&main_file, main_source).expect("main source");

    let mut request = request_with_root_file_and_call_names(
        root.to_string_lossy().to_string(),
        main_file.to_string_lossy().to_string(),
        vec!["prompt".to_string()],
        main_source,
    );
    request.files.push(NativeStaticAnalyzeFile {
        file: helper_file.to_string_lossy().to_string(),
        source_hash: "sha256:shared".to_string(),
        source_text: Some(helper_source.to_string()),
    });
    let facts = analyze_native_static_facts(&request);
    std::fs::remove_dir_all(&root).ok();
    let output = finalize_native_static_values(&facts, &[]);

    let prompt = output
        .model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "prompt:shared")
        .expect("imported prompt definition");
    assert_eq!(
        prompt.path,
        vec!["shared".to_string(), "answer".to_string()]
    );
}

#[test]
fn analyze_relation_refs_prefer_scoped_definition_aliases() {
    let root = std::env::temp_dir().join(format!(
        "crux-native-static-scoped-alias-{}",
        std::process::id()
    ));
    let src_dir = root.join("src");
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&src_dir).expect("test src dir");
    let helper_file = src_dir.join("quality.ts");
    let helper_source = "export const triagePrompt = prompt({ id: 'support-triage' })";
    std::fs::write(&helper_file, helper_source).expect("helper source");
    let main_file = src_dir.join("agent.ts");
    let main_source = [
        "const triagePrompt = prompt({ id: 'triage' })",
        "export const triage = agent({ id: 'triage', prompt: triagePrompt })",
    ]
    .join("\n");
    std::fs::write(&main_file, &main_source).expect("main source");

    let mut request = request_with_root_file_and_call_names(
        root.to_string_lossy().to_string(),
        main_file.to_string_lossy().to_string(),
        vec!["agent".to_string(), "prompt".to_string()],
        &main_source,
    );
    request.files.push(NativeStaticAnalyzeFile {
        file: helper_file.to_string_lossy().to_string(),
        source_hash: "sha256:quality".to_string(),
        source_text: Some(helper_source.to_string()),
    });
    let facts = analyze_native_static_facts(&request);
    std::fs::remove_dir_all(&root).ok();
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

    let relation_ids = output
        .model
        .facts
        .relations
        .iter()
        .map(|relation| relation.id.as_str())
        .collect::<Vec<_>>();
    assert!(
        relation_ids.contains(&"relation:agent.uses_prompt:agent:triage:prompt:triage"),
        "agent should bind to the same-file prompt, got {relation_ids:?}"
    );
    assert!(
        !relation_ids.contains(&"relation:agent.uses_prompt:agent:triage:prompt:support-triage"),
        "agent should not bind through a global exportName collision"
    );
}

#[test]
fn analyze_relation_refs_use_scoped_memory_definition_kind() {
    let source = [
        "const agentMemory = memory({ id: 'agent-memory', blocks: [] })",
        "export const editPrompt = prompt({ id: 'edit', use: [agentMemory] })",
    ]
    .join("\n");
    let facts = analyze_native_static_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/prompts/edit.ts".to_string(),
        vec!["memory".to_string(), "prompt".to_string()],
        &source,
    ));
    let policies = relation_policy_table_from_value(Some(&json!({
        "relations": [{
            "type": "prompt.uses_context",
            "fromKinds": ["prompt"],
            "toKinds": ["context"],
            "presentation": "both",
            "fidelity": "partial",
            "runtimeJoin": false
        }]
    })))
    .expect("prompt use relation policy");
    let output = finalize_native_static_values_with_policies(&facts, &[], &policies);

    let relation_ids = output
        .model
        .facts
        .relations
        .iter()
        .map(|relation| relation.id.as_str())
        .collect::<Vec<_>>();
    assert!(
        relation_ids.contains(&"relation:prompt.uses_memory:prompt:edit:memory:agent-memory"),
        "prompt should bind memory use through scoped definition kind, got {relation_ids:?}"
    );
}
