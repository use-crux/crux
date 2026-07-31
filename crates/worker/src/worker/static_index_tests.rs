use serde_json::{Value, json};

use crate::protocol::static_index::{
    STATIC_INDEX_FINALIZE_METHOD, STATIC_INDEX_PREPARE_METHOD, STATIC_INDEX_PROTOCOL_VERSION,
    StaticIndexFinalizeResponse, StaticIndexPrepareResponse,
};
use crate::{parse_serve_request, write_serve_response};

#[test]
fn prepare_request_is_accepted_through_worker_path() {
    let response = serve_response_json(json!({
        "id": 101,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_PREPARE_METHOD,
        "root": "/workspace/acme",
        "projectName": "acme",
        "identity": run_identity_json(),
        "files": selected_files_json()
    }));

    assert_eq!(response["id"], 101);
    assert_eq!(response["ok"], true);
    let stage = response["response"].clone();
    let parsed: StaticIndexPrepareResponse =
        serde_json::from_value(stage.clone()).expect("prepare response should deserialize");

    assert_eq!(parsed.plan.files.len(), 2);
    assert_eq!(stage["method"], STATIC_INDEX_PREPARE_METHOD);
    assert_eq!(
        stage["plan"]["cacheHits"][0]["file"],
        "src/agents/support.ts"
    );
    assert_eq!(
        stage["plan"]["cacheMisses"][0]["file"],
        "src/prompts/refund.ts"
    );
    assert_eq!(stage["diagnostics"], json!([]));
    assert_eq!(stage["telemetry"]["files"]["selected"], 2);
    assert_eq!(stage["telemetry"]["files"]["cacheHits"], 1);
    assert_eq!(stage["telemetry"]["files"]["cacheMisses"], 1);
    assert_eq!(stage["telemetry"]["node"]["started"], false);
}

#[test]
fn finalize_request_is_accepted_through_worker_path() {
    let response = serve_response_json(json!({
        "id": 103,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_FINALIZE_METHOD,
        "identity": run_identity_json(),
        "nativeFacts": [
            {
                "root": "/workspace/acme",
                "projectName": "acme",
                "definitions": [
                    {
                        "id": "prompt:refund",
                        "kind": "prompt",
                        "name": "refund",
                        "fidelity": "resolved",
                        "status": "active",
                        "metadata": { "inputSchema": { "type": "object" } },
                        "quality": { "evalIds": ["eval:refund"] }
                    }
                ]
            }
        ],
        "extensionFacts": [],
        "cache": { "writes": [{ "cacheKey": "static:refund" }] }
    }));

    assert_eq!(response["id"], 103);
    assert_eq!(response["ok"], true);
    let stage = response["response"].clone();
    let parsed: StaticIndexFinalizeResponse =
        serde_json::from_value(stage.clone()).expect("finalize response should deserialize");

    assert_eq!(parsed.events.len(), 3);
    assert_eq!(parsed.events[0]["type"], "phase:start");
    assert_eq!(parsed.events[0]["root"], "/workspace/acme");
    assert_eq!(parsed.events[1]["type"], "fact:batch");
    assert_eq!(parsed.events[1]["facts"][0]["kind"], "definitions");
    assert_eq!(
        parsed.events[1]["facts"][0]["projectRoot"],
        "/workspace/acme"
    );
    assert_eq!(
        parsed.events[1]["facts"][0]["producer"]["name"],
        "@use-crux/indexer/project-indexer"
    );
    assert_eq!(parsed.events[2]["type"], "phase:done");
    assert_eq!(
        parsed.events[2]["patch"]["project"]["root"],
        "/workspace/acme"
    );
    assert_eq!(parsed.events[2]["summary"]["factCount"], 58);
    assert_eq!(stage["method"], STATIC_INDEX_FINALIZE_METHOD);
    assert_eq!(stage["telemetry"]["facts"]["definitions"], 1);
    assert_eq!(stage["telemetry"]["facts"]["ruleDescriptors"], 56);
    assert_eq!(stage["telemetry"]["cache"]["writes"], 1);
}

#[test]
fn malformed_and_unknown_requests_remain_strict_without_breaking_syntax_requests() {
    assert!(parse_serve_request("{").is_err());

    let unknown = parse_serve_request(r#"{"id":404,"method":"staticIndexUnknown"}"#);
    assert!(
        unknown
            .expect_err("unknown method should be rejected")
            .contains("unknown Static Index worker method staticIndexUnknown")
    );

    let response = serve_response_json(json!({
        "id": 405,
        "method": "not-static-index",
        "root": "/repo",
        "file": "/repo/src/a.ts",
        "source": "export const a = 1"
    }));

    assert_eq!(response["id"], 405);
    assert_eq!(response["ok"], true);
    assert!(response["record"].is_object());
}

pub(crate) fn serve_response_json(request: Value) -> Value {
    let line = serde_json::to_string(&request).expect("request should serialize");
    let request = parse_serve_request(&line).expect("request should parse through serve path");
    let mut output = Vec::new();
    write_serve_response(&mut output, request).expect("serve response should write");
    let text = String::from_utf8(output).expect("serve response should be utf8");
    let lines = text.lines().collect::<Vec<_>>();
    assert_eq!(lines.len(), 1);
    serde_json::from_str(lines[0]).expect("serve response should be json")
}

pub(crate) fn serve_response_lines_json(request: Value) -> Vec<Value> {
    let line = serde_json::to_string(&request).expect("request should serialize");
    let request = parse_serve_request(&line).expect("request should parse through serve path");
    let mut output = Vec::new();
    write_serve_response(&mut output, request).expect("serve response should write");
    let text = String::from_utf8(output).expect("serve response should be utf8");
    text.lines()
        .map(|line| serde_json::from_str(line).expect("serve response line should be json"))
        .collect()
}

pub(crate) fn run_identity_json() -> Value {
    json!({
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "compiler": version_identity_json("crux-static-index", "0.1.0"),
        "oxc": version_identity_json("oxc-rust", "oxc_parser@0.139.0+crux_native_group3.9"),
        "primitiveManifest": digest_identity_json("crux-first-party-primitives"),
        "relationPolicy": digest_identity_json("crux-relation-policy"),
        "extensionManifests": [digest_identity_json("@acme/crux-extra")],
        "ruleDescriptors": digest_identity_json("crux-indexer-rule-descriptors"),
        "compilerProjection": digest_identity_json("crux-static-projection")
    })
}

fn version_identity_json(name: &str, version: &str) -> Value {
    json!({ "name": name, "version": version })
}

fn digest_identity_json(name: &str) -> Value {
    json!({ "name": name, "version": "phase-3", "digest": format!("sha256:{name}") })
}

pub(crate) fn skeleton_plan_json() -> Value {
    json!({
        "root": "/workspace/acme",
        "projectName": "acme",
        "files": selected_files_json(),
        "cacheHits": [support_file_json()],
        "cacheMisses": [refund_file_json()],
        "callNames": ["prompt"]
    })
}

fn selected_files_json() -> Value {
    json!([support_file_json(), refund_file_json()])
}

fn support_file_json() -> Value {
    json!({
        "file": "src/agents/support.ts",
        "sourceHash": "sha256:source-support",
        "cacheKey": "static:src/agents/support.ts:source-support"
    })
}

fn refund_file_json() -> Value {
    json!({
        "file": "src/prompts/refund.ts",
        "sourceHash": "sha256:source-refund"
    })
}
