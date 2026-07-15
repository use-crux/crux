use serde::Deserialize;
use serde_json::Value;

use crate::core::facts::StaticIndexRuleDescriptor;
use crate::pipeline;
use crate::protocol::static_index::{
    StaticIndexAnalyzeRequest, StaticIndexAnalyzeResponse, StaticIndexCompileRequest,
    StaticIndexFinalizeRequest, StaticIndexFinalizeResponse, StaticIndexIdentityManifest,
    StaticIndexMethod, StaticIndexPrepareRequest, StaticIndexPrepareResponse,
};
use crate::protocol::{StaticSourceMatch, StaticSyntaxFileRecord, StaticSyntaxValue};
use crate::relation::policy::{StaticIndexRelationPolicy, StaticIndexRelationPolicyTable};

#[derive(Deserialize)]
struct StaticIndexProtocolFixture {
    requests: Vec<Value>,
    responses: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticIndexProtocolCasesFixture {
    worker_error: StaticIndexWorkerErrorFixture,
    invalid_requests: Vec<Value>,
    analyze_stream_error: Value,
    finalize_stream_error: Value,
    invalid_analyze_stream_event: Value,
    invalid_finalize_stream_event: Value,
}

#[derive(Deserialize)]
struct StaticIndexWorkerErrorFixture {
    id: u64,
    ok: bool,
    error: String,
}

#[derive(Deserialize)]
struct StaticSyntaxRecordsFixture {
    records: Vec<StaticSyntaxFileRecord>,
}

#[derive(Deserialize)]
struct WorkerEventsFixture {
    events: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerEventCasesFixture {
    artifact_done: Value,
    artifact_error: Value,
    phase_error: Value,
    out_of_order_events: Vec<Value>,
}

#[derive(Deserialize)]
struct RelationSpecsFixture {
    policies: Vec<StaticIndexRelationPolicy>,
}

#[derive(Deserialize)]
struct RuleDescriptorsFixture {
    descriptors: Vec<StaticIndexRuleDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrimitiveCoverageIdentitiesFixture {
    required_fixture_classes: Vec<String>,
    identities: Vec<PrimitiveCoverageIdentity>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrimitiveCoverageIdentity {
    extension: String,
    extractor: String,
    family: String,
    native_covered: bool,
    parity_fixtures: PrimitiveCoverageParityFixtures,
    fixture_classes: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrimitiveCoverageParityFixtures {
    positive: String,
    negative: String,
}

#[test]
fn shared_static_index_protocol_fixture_decodes_and_finalizes() {
    let fixture: StaticIndexProtocolFixture = fixture_json("static-index-protocol.json");
    let manifest: StaticIndexIdentityManifest = fixture_json("static-index-identity.json");
    let methods = fixture
        .requests
        .iter()
        .map(fixture_method)
        .collect::<Vec<_>>();
    assert_eq!(
        methods,
        vec![
            "staticIndexPrepare",
            "staticIndexAnalyze",
            "staticIndexFinalize",
            "staticIndexCompile"
        ]
    );

    let prepare: StaticIndexPrepareRequest = serde_json::from_value(fixture.requests[0].clone())
        .expect("shared prepare request should decode");
    assert_eq!(prepare.root, "/repo");
    assert_eq!(prepare.identity.oxc, manifest.oxc_frontend);
    assert_eq!(
        prepare.identity.primitive_manifest,
        manifest.primitive_manifest
    );
    assert_eq!(prepare.identity.relation_policy, manifest.relation_policy);
    assert_eq!(prepare.identity.rule_descriptors, manifest.rule_descriptors);
    assert_eq!(
        prepare.identity.compiler_projection,
        manifest.compiler_projection
    );

    let analyze: StaticIndexAnalyzeRequest = serde_json::from_value(fixture.requests[1].clone())
        .expect("shared analyze request should decode");
    assert_eq!(analyze.files.len(), 1);

    let finalize: StaticIndexFinalizeRequest = serde_json::from_value(fixture.requests[2].clone())
        .expect("shared finalize request should decode");
    let finalize_response = pipeline::finalize(finalize);
    assert_eq!(finalize_response.method, StaticIndexMethod::Finalize);
    assert_eq!(finalize_response.telemetry.facts.definitions, 1);
    assert_eq!(finalize_response.telemetry.facts.source_refs, 1);
    assert_eq!(finalize_response.telemetry.facts.diagnostics, 1);
    assert_eq!(finalize_response.telemetry.facts.lint_findings, 1);
    assert_eq!(finalize_response.telemetry.facts.sources, 1);
    assert_eq!(finalize_response.telemetry.facts.source_graph, 1);
    assert_eq!(definition_source_ref_count(&finalize_response.events), 1);
    assert!(
        finalize_response
            .events
            .iter()
            .any(|event| event["type"] == "fact:batch"),
        "finalize should stream Project Index fact batches"
    );

    let compile: StaticIndexCompileRequest = serde_json::from_value(fixture.requests[3].clone())
        .expect("shared compile request should decode");
    let compile_response = pipeline::compile(compile);
    assert_eq!(compile_response.method, StaticIndexMethod::Compile);
    assert!(
        compile_response.telemetry.facts.definitions >= 1,
        "compile should emit at least one Static Index definition"
    );
    assert!(
        compile_response
            .events
            .iter()
            .any(|event| event["type"] == "fact:batch"),
        "compile should stream Project Index fact batches"
    );

    let _: StaticIndexPrepareResponse = serde_json::from_value(fixture.responses[0].clone())
        .expect("shared prepare response should decode");
    let _: StaticIndexAnalyzeResponse = serde_json::from_value(fixture.responses[1].clone())
        .expect("shared analyze response should decode");
    let _: StaticIndexFinalizeResponse = serde_json::from_value(fixture.responses[2].clone())
        .expect("shared finalize response should decode");
    let _: StaticIndexFinalizeResponse = serde_json::from_value(fixture.responses[3].clone())
        .expect("shared compile response should decode");
}

#[test]
fn shared_static_index_identity_fixture_matches_rust_syntax_frontend() {
    let manifest: StaticIndexIdentityManifest = fixture_json("static-index-identity.json");

    assert_eq!(
        manifest.oxc_frontend.name,
        crux_indexer_syntax_oxc::FRONTEND_NAME
    );
    assert_eq!(
        manifest.oxc_frontend.version,
        crux_indexer_syntax_oxc::FRONTEND_VERSION
    );
}

#[test]
fn shared_static_index_protocol_case_fixture_decodes() {
    let fixture: StaticIndexProtocolCasesFixture = fixture_json("static-index-protocol-cases.json");

    assert_eq!(fixture.worker_error.id, 11);
    assert!(!fixture.worker_error.ok);
    assert_eq!(fixture.worker_error.error, "static compiler failed");
    assert_eq!(fixture.invalid_requests.len(), 2);
    for request in fixture.invalid_requests {
        assert!(
            serde_json::from_value::<StaticIndexPrepareRequest>(request).is_err(),
            "invalid request fixture should not decode as a prepare request"
        );
    }

    assert!(!fixture.analyze_stream_error["ok"].as_bool().unwrap_or(true));
    assert_eq!(fixture.analyze_stream_error["type"], "error");
    assert_eq!(fixture.analyze_stream_error["error"], "analyze failed");
    assert!(
        !fixture.finalize_stream_error["ok"]
            .as_bool()
            .unwrap_or(true)
    );
    assert_eq!(fixture.finalize_stream_error["type"], "error");
    assert_eq!(fixture.finalize_stream_error["error"], "finalize failed");
    assert_eq!(fixture.invalid_analyze_stream_event["type"], "unknown");
    assert_eq!(fixture.invalid_finalize_stream_event["type"], "event");
    assert!(fixture.invalid_finalize_stream_event.get("event").is_none());
}

#[test]
fn shared_static_syntax_record_fixture_decodes() {
    let fixture: StaticSyntaxRecordsFixture = fixture_json("static-syntax-records.json");
    assert_eq!(fixture.records.len(), 1);
    let record = &fixture.records[0];
    assert_eq!(record.schema_version, 1);
    assert_eq!(record.frontend.name, "oxc-rust");
    assert_eq!(record.file, "/repo/src/contract.ts");
    assert_eq!(record.matches.len(), 1);
    assert_eq!(record.native_facts.len(), 1);
}

#[test]
fn shared_static_syntax_record_case_fixture_decodes() {
    let fixture: StaticSyntaxRecordsFixture = fixture_json("static-syntax-record-cases.json");
    assert_eq!(fixture.records.len(), 1);
    let record = &fixture.records[0];
    assert_eq!(record.file, "/repo/src/agent.ts");
    assert_eq!(record.diagnostics.len(), 1);
    assert_eq!(record.diagnostics[0].code, "syntax.recovered");

    let StaticSourceMatch::New {
        variable_name,
        callee,
        object_arg,
        ..
    } = &record.matches[0]
    else {
        panic!("expected constructor match fixture");
    };
    assert_eq!(variable_name, "agent");
    assert_eq!(callee.name, "Agent");
    assert_eq!(callee.module_specifier.as_deref(), Some("@use-crux/core"));

    let Some(StaticSyntaxValue::Object { properties, .. }) = object_arg else {
        panic!("expected constructor object argument");
    };
    let instructions = properties
        .iter()
        .find(|property| property.name == "instructions")
        .expect("expected instructions callback property");
    let StaticSyntaxValue::Function { calls, .. } = &instructions.value else {
        panic!("expected function-valued callback property");
    };
    assert_eq!(calls[0].callee.name, "writeFile");
}

#[test]
fn shared_worker_event_fixtures_cover_success_and_edge_cases() {
    let success: WorkerEventsFixture = fixture_json("worker-events.json");
    let event_types = success.events.iter().map(event_type).collect::<Vec<_>>();
    assert_eq!(
        event_types,
        vec![
            "phase:start",
            "fact:batch",
            "sourceProfile:batch",
            "phase:done"
        ]
    );

    let cases: WorkerEventCasesFixture = fixture_json("worker-event-cases.json");
    assert_eq!(event_type(&cases.artifact_done), "artifact:done");
    assert_eq!(event_type(&cases.artifact_error), "artifact:error");
    assert_eq!(event_type(&cases.phase_error), "phase:error");
    assert_eq!(cases.out_of_order_events.len(), 2);
    assert_eq!(event_type(&cases.out_of_order_events[0]), "phase:start");
    assert_eq!(event_type(&cases.out_of_order_events[1]), "fact:batch");
    assert_eq!(cases.out_of_order_events[1]["sequence"], 1);
}

#[test]
fn shared_relation_rule_and_coverage_fixtures_decode() {
    let relations: RelationSpecsFixture = fixture_json("relation-specs.json");
    let table = StaticIndexRelationPolicyTable::new(vec![relations.policies]);
    assert!(table.policy_for("agent.uses_prompt").is_some());
    assert!(table.policy_for("router.route.uses_prompt").is_some());

    let rules: RuleDescriptorsFixture = fixture_json("rule-descriptors.json");
    let rule_ids = rules
        .descriptors
        .iter()
        .map(|descriptor| descriptor.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        rule_ids,
        vec![
            "definition.missing_eval_coverage",
            "quality.missing_baseline",
            "agent.unobservable_handoff",
            "prompt.missing_input_schema",
            "prompt.missing_output_schema",
            "prompt.hidden_required_input",
            "prompt.conflicting_injected_input",
            "prompt.conditional_required_input",
            "context.missing_input_schema",
            "injection.dynamic_dependency",
            "injection.dynamic_tools",
            "prompt.indirect_tool_surface",
            "injectable.unused",
            "context.unused",
            "injection.unresolved_target",
            "injection.deep_schema_chain",
            "flow.untyped_args",
            "tool.missing_input_schema",
            "tool.output_not_inspectable",
            "flow.suspension_without_coverage",
            "flow.duplicate_step_label",
            "flow.duplicate_suspend_name",
            "flow.undeclared_suspend_signal",
            "workspace.write_without_guardrail",
            "safety.duplicate_policy_id",
            "memory.long_lived_without_retention",
            "resource.write_without_read",
            "consensus.missing_judge",
            "shared_blackboard_without_policy",
            "routing.missing_stable_id",
            "routing.router_missing_default",
            "routing.unresolved_target",
            "routing.cascade_unreachable_tier",
            "rag.recipe_step_unresolved_target",
            "runtime.duplicate_target_name",
            "runtime.non_literal_target_name",
            "runtime.target_not_exported",
            "runtime.closure_defer",
            "defer.replay_unsafe",
            "defer.floating_named_promise",
            "defer.missing_scope",
            "runtime.missing_runtime_config",
            "flow.nondeterministic_code",
            "runtime.non_serializable_payload",
            "media.unsupported-capability",
            "media.invalid-provider-file",
            "media.asset-ref-not-hydrated",
            "media.missing-derivation",
            "media.missing-attribution",
            "media.output-discarded",
            "media.raw-retention"
        ]
    );

    let coverage: PrimitiveCoverageIdentitiesFixture =
        fixture_json("primitive-coverage-identities.json");
    assert_eq!(coverage.required_fixture_classes.len(), 10);
    assert!(
        coverage
            .required_fixture_classes
            .iter()
            .any(|class| class == "dependencies")
    );
    assert_eq!(coverage.identities.len(), 23);

    // The Rust first-party projection manifest must cover exactly these
    // identities, with the same stable replacement identity it stamps when it
    // replaces TypeScript extractor output.
    let manifest_identities = crate::primitives::manifest::first_party_primitive_identities();
    let manifest_extractors = manifest_identities
        .iter()
        .map(|identity| identity.extractor)
        .collect::<std::collections::BTreeSet<_>>();
    let fixture_extractors = coverage
        .identities
        .iter()
        .map(|identity| identity.extractor.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        manifest_extractors, fixture_extractors,
        "first-party manifest must project exactly the covered extractor identities"
    );
    for identity in &manifest_identities {
        let expected_extension = match identity.extractor {
            "mcp.server" => "@use-crux/indexer/crux-core-mcp",
            "media.operation" | "ingest.source" => "@use-crux/indexer/crux-core-media",
            _ => "@use-crux/indexer/crux-core",
        };
        assert_eq!(identity.extension, expected_extension);
        assert_eq!(
            identity.family, identity.extractor,
            "{} family",
            identity.extractor
        );
    }

    for identity in coverage.identities {
        let expected_extension = match identity.extractor.as_str() {
            "mcp.server" => "@use-crux/indexer/crux-core-mcp",
            "media.operation" | "ingest.source" => "@use-crux/indexer/crux-core-media",
            _ => "@use-crux/indexer/crux-core",
        };
        assert_eq!(identity.extension, expected_extension);
        assert_eq!(identity.family, identity.extractor);
        assert!(identity.native_covered);
        assert_eq!(
            identity.parity_fixtures.negative,
            match identity.extractor.as_str() {
                "mcp.server" => "mcp-native-static.test.ts",
                "media.operation" | "ingest.source" => "media-native-static.test.ts",
                _ => "first-party-native-negative-fixtures.test.ts",
            }
        );
        assert_eq!(
            identity.parity_fixtures.positive,
            *identity
                .fixture_classes
                .get("definitions")
                .expect("definitions fixture class")
        );
        for class in &coverage.required_fixture_classes {
            assert!(
                identity.fixture_classes.contains_key(class),
                "{} missing {class}",
                identity.extractor
            );
        }
    }
}

fn fixture_json<T>(name: &str) -> T
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_str(fixture_text(name)).expect("shared fixture should decode")
}

fn fixture_text(name: &str) -> &'static str {
    match name {
        "static-index-protocol.json" => {
            include_str!(
                "../../../packages/indexer/src/contracts/fixtures/static-index-protocol.json"
            )
        }
        "static-index-protocol-cases.json" => include_str!(
            "../../../packages/indexer/src/contracts/fixtures/static-index-protocol-cases.json"
        ),
        "static-index-identity.json" => {
            include_str!(
                "../../../packages/indexer/src/contracts/fixtures/static-index-identity.json"
            )
        }
        "static-syntax-records.json" => {
            include_str!(
                "../../../packages/indexer/src/contracts/fixtures/static-syntax-records.json"
            )
        }
        "static-syntax-record-cases.json" => include_str!(
            "../../../packages/indexer/src/contracts/fixtures/static-syntax-record-cases.json"
        ),
        "worker-events.json" => {
            include_str!("../../../packages/indexer/src/contracts/fixtures/worker-events.json")
        }
        "worker-event-cases.json" => {
            include_str!("../../../packages/indexer/src/contracts/fixtures/worker-event-cases.json")
        }
        "relation-specs.json" => {
            include_str!("../../../packages/indexer/src/contracts/fixtures/relation-specs.json")
        }
        "rule-descriptors.json" => {
            include_str!("../../../packages/indexer/src/contracts/fixtures/rule-descriptors.json")
        }
        "primitive-coverage-identities.json" => include_str!(
            "../../../packages/indexer/src/contracts/fixtures/primitive-coverage-identities.json"
        ),
        _ => panic!("unknown shared fixture {name}"),
    }
}

fn fixture_method(value: &Value) -> String {
    value
        .get("method")
        .and_then(Value::as_str)
        .expect("fixture payload should have method")
        .to_string()
}

fn event_type(value: &Value) -> String {
    value
        .get("type")
        .and_then(Value::as_str)
        .expect("fixture payload should have type")
        .to_string()
}

fn definition_source_ref_count(events: &[Value]) -> usize {
    events
        .iter()
        .filter_map(|event| event.get("facts").and_then(Value::as_array))
        .flatten()
        .find(|envelope| envelope.get("kind").and_then(Value::as_str) == Some("definitions"))
        .and_then(|envelope| envelope.get("fact"))
        .and_then(|fact| fact.get("sourceRefs"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}
