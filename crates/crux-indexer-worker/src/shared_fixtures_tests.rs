use serde::Deserialize;
use serde_json::Value;

use crate::index_compiler::core::facts::NativeStaticRuleDescriptor;
use crate::index_compiler::pipeline;
use crate::index_compiler::relation::policy::{
    NativeStaticRelationPolicy, NativeStaticRelationPolicyTable,
};
use crate::protocol::StaticSyntaxFileRecord;
use crate::protocol::native_static::{
    NativeStaticAnalyzeRequest, NativeStaticAnalyzeResponse, NativeStaticCompileRequest,
    NativeStaticFinalizeRequest, NativeStaticFinalizeResponse, NativeStaticMethod,
    NativeStaticPrepareRequest, NativeStaticPrepareResponse,
};

#[derive(Deserialize)]
struct NativeStaticProtocolFixture {
    requests: Vec<Value>,
    responses: Vec<Value>,
}

#[derive(Deserialize)]
struct StaticSyntaxRecordsFixture {
    records: Vec<StaticSyntaxFileRecord>,
}

#[derive(Deserialize)]
struct RelationSpecsFixture {
    policies: Vec<NativeStaticRelationPolicy>,
}

#[derive(Deserialize)]
struct RuleDescriptorsFixture {
    descriptors: Vec<NativeStaticRuleDescriptor>,
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
    fixture_classes: std::collections::BTreeMap<String, String>,
}

#[test]
fn shared_native_static_protocol_fixture_decodes_and_finalizes() {
    let fixture: NativeStaticProtocolFixture = fixture_json("native-static-protocol.json");
    let methods = fixture
        .requests
        .iter()
        .map(fixture_method)
        .collect::<Vec<_>>();
    assert_eq!(
        methods,
        vec![
            "nativeStaticPrepare",
            "nativeStaticAnalyze",
            "nativeStaticFinalize",
            "nativeStaticCompile"
        ]
    );

    let prepare: NativeStaticPrepareRequest = serde_json::from_value(fixture.requests[0].clone())
        .expect("shared prepare request should decode");
    assert_eq!(prepare.root, "/repo");

    let analyze: NativeStaticAnalyzeRequest = serde_json::from_value(fixture.requests[1].clone())
        .expect("shared analyze request should decode");
    assert_eq!(analyze.files.len(), 1);

    let finalize: NativeStaticFinalizeRequest = serde_json::from_value(fixture.requests[2].clone())
        .expect("shared finalize request should decode");
    let finalize_response = pipeline::finalize(finalize);
    assert_eq!(finalize_response.method, NativeStaticMethod::Finalize);
    assert_eq!(finalize_response.telemetry.facts.definitions, 1);
    assert_eq!(finalize_response.telemetry.facts.source_refs, 0);
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

    let compile: NativeStaticCompileRequest = serde_json::from_value(fixture.requests[3].clone())
        .expect("shared compile request should decode");
    let compile_response = pipeline::compile(compile);
    assert_eq!(compile_response.method, NativeStaticMethod::Compile);
    assert!(
        compile_response.telemetry.facts.definitions >= 1,
        "compile should emit at least one native static definition"
    );
    assert!(
        compile_response
            .events
            .iter()
            .any(|event| event["type"] == "fact:batch"),
        "compile should stream Project Index fact batches"
    );

    let _: NativeStaticPrepareResponse = serde_json::from_value(fixture.responses[0].clone())
        .expect("shared prepare response should decode");
    let _: NativeStaticAnalyzeResponse = serde_json::from_value(fixture.responses[1].clone())
        .expect("shared analyze response should decode");
    let _: NativeStaticFinalizeResponse = serde_json::from_value(fixture.responses[2].clone())
        .expect("shared finalize response should decode");
    let _: NativeStaticFinalizeResponse = serde_json::from_value(fixture.responses[3].clone())
        .expect("shared compile response should decode");
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
fn shared_relation_rule_and_coverage_fixtures_decode() {
    let relations: RelationSpecsFixture = fixture_json("relation-specs.json");
    let table = NativeStaticRelationPolicyTable::new(vec![relations.policies]);
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
            "prompt.missing_input_schema",
            "routing.router_missing_default"
        ]
    );

    let coverage: PrimitiveCoverageIdentitiesFixture =
        fixture_json("primitive-coverage-identities.json");
    assert_eq!(coverage.required_fixture_classes.len(), 9);
    assert_eq!(coverage.identities.len(), 17);
    for identity in coverage.identities {
        assert_eq!(identity.extension, "@crux/indexer/crux-core");
        assert_eq!(identity.family, identity.extractor);
        assert!(identity.native_covered);
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
        "native-static-protocol.json" => include_str!(
            "../../../packages/indexer/indexer/contracts/fixtures/native-static-protocol.json"
        ),
        "static-syntax-records.json" => include_str!(
            "../../../packages/indexer/indexer/contracts/fixtures/static-syntax-records.json"
        ),
        "relation-specs.json" => {
            include_str!("../../../packages/indexer/indexer/contracts/fixtures/relation-specs.json")
        }
        "rule-descriptors.json" => include_str!(
            "../../../packages/indexer/indexer/contracts/fixtures/rule-descriptors.json"
        ),
        "primitive-coverage-identities.json" => include_str!(
            "../../../packages/indexer/indexer/contracts/fixtures/primitive-coverage-identities.json"
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
