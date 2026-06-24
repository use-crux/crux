use serde_json::json;

use crate::protocol::native_static::NativeStaticAnalyzeFile;
use crate::static_compiler::analysis::run::analyze_native_static_facts;
use crate::static_compiler::analysis::tests::request_with_root_file_and_call_names;

#[test]
fn analyze_resolves_imported_helper_source_refs_from_selected_files() {
    let root = std::env::temp_dir().join(format!(
        "crux-native-static-imported-helper-{}",
        std::process::id()
    ));
    let src_dir = root.join("src");
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&src_dir).expect("test src dir");
    let helper_file = src_dir.join("plans.ts");
    let helper_source = [
        "export interface Plan { title: string }",
        "export async function getPlan(planId: string): Promise<Plan | null> {",
        "  const store = resolveStore()",
        "  return await store.get(planId)",
        "}",
        "function resolveStore() {",
        "  return { get: async (key: string) => ({ title: key }) }",
        "}",
    ]
    .join("\n");
    std::fs::write(&helper_file, &helper_source).expect("helper source");
    let context_file = src_dir.join("agent.ts");
    let context_source = [
        "import { context } from '@crux/core'",
        "import { getPlan } from './plans'",
        "export function planAgent(planId: string) {",
        "  return context({",
        "    id: `plan:${planId}`,",
        "    system: async () => {",
        "      const plan = await getPlan(planId)",
        "      return plan?.title ?? ''",
        "    },",
        "  })",
        "}",
    ]
    .join("\n");
    std::fs::write(&context_file, &context_source).expect("context source");

    let mut request = request_with_root_file_and_call_names(
        root.to_string_lossy().to_string(),
        context_file.to_string_lossy().to_string(),
        vec!["context".to_string()],
        &context_source,
    );
    request.files.push(NativeStaticAnalyzeFile {
        file: helper_file.to_string_lossy().to_string(),
        source_hash: "sha256:plans".to_string(),
        source_text: Some(helper_source),
    });
    let facts = analyze_native_static_facts(&request);
    let facts = facts.into_wire_values();
    std::fs::remove_dir_all(&root).ok();

    let context_group = facts
        .iter()
        .find(|fact| fact["definitions"][0]["kind"] == "context")
        .expect("context fact group");
    assert_eq!(
        context_group["definitions"][0]["id"],
        json!("context:src-agent.ts:context-4")
    );
    assert!(
        context_group["sourceRefs"].as_array().is_some_and(|refs| {
            refs.iter().any(|fact| {
                fact["ref"]["role"] == "helper"
                    && fact["ref"]["symbol"] == "getPlan"
                    && fact["ref"]["source"]["file"] == helper_file.to_string_lossy().as_ref()
            })
        }),
        "imported helper source ref should be attached"
    );
    assert!(
        context_group["definitions"][0]["metadata"]["intelligence"]
            .get("data")
            .is_none(),
        "imported helper internals should not become context data intelligence"
    );
    assert!(
        context_group["relationRefs"].as_array().is_none_or(|refs| {
            refs.iter()
                .all(|reference| reference["type"] != "context.reads_memory")
        }),
        "imported helper internals should not become context memory relations"
    );
}

#[test]
fn analyze_keeps_local_helper_data_accesses() {
    let source = [
        "import { context } from '@crux/core'",
        "const store = { get: (key: string) => key }",
        "const loadPlan = () => store.get('plan:1')",
        "export const planContext = context({",
        "  id: 'plan-context',",
        "  system: () => loadPlan(),",
        "})",
    ]
    .join("\n");
    let facts = analyze_native_static_facts(&request_with_root_file_and_call_names(
        "/workspace/acme".to_string(),
        "src/contexts/plan.ts".to_string(),
        vec!["context".to_string()],
        &source,
    ));
    let facts = facts.into_wire_values();
    let context_group = facts
        .iter()
        .find(|fact| fact["definitions"][0]["id"] == "context:plan-context")
        .expect("context fact group");

    assert!(
        context_group["definitions"][0]["metadata"]["intelligence"]
            .get("data")
            .is_some(),
        "local helper internals should remain context data intelligence"
    );
    assert!(
        context_group["relationRefs"]
            .as_array()
            .is_some_and(|refs| {
                refs.iter()
                    .any(|reference| reference["type"] == "context.reads_memory")
            }),
        "local helper internals should remain context memory relations"
    );
}
