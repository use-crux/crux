use serde_json::json;

use crate::parse_serve_request;
use crate::protocol::native_static::{
    NativeStaticAnalyzeResponse, NativeStaticFinalizeResponse, STATIC_INDEX_ANALYZE_METHOD,
    STATIC_INDEX_COMPILE_METHOD, STATIC_INDEX_FINALIZE_METHOD, STATIC_INDEX_PROTOCOL_VERSION,
};
use crate::worker::native_static_tests::{
    run_identity_json, serve_response_lines_json, skeleton_plan_json,
};

#[test]
fn analyze_request_is_accepted_through_stream_worker_path() {
    let events = serve_response_lines_json(json!({
        "id": 102,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_ANALYZE_METHOD,
        "stream": true,
        "identity": run_identity_json(),
        "plan": skeleton_plan_json(),
        "files": [
            {
                "file": "src/prompts/refund.ts",
                "sourceHash": "sha256:source-refund",
                "sourceText": "export const refundPrompt = prompt({ id: 'refund' })"
            }
        ],
        "extensionEvidenceInterests": { "calls": ["prompt"] }
    }));

    assert_eq!(events[0]["id"], 102);
    assert_eq!(events[0]["ok"], true);
    assert_eq!(events[0]["type"], "fact");
    assert_eq!(events[0]["fact"]["definitions"][0]["id"], "prompt:refund");

    let done = events.last().expect("done event");
    let stage = done["response"].clone();
    let parsed: NativeStaticAnalyzeResponse =
        serde_json::from_value(stage.clone()).expect("analyze response should deserialize");

    assert!(parsed.facts.is_empty());
    assert!(parsed.diagnostics.is_empty());
    assert!(parsed.extension_evidence_jobs.is_empty());
    assert_eq!(stage["method"], STATIC_INDEX_ANALYZE_METHOD);
    assert_eq!(stage["telemetry"]["files"]["selected"], 2);
    assert_eq!(stage["telemetry"]["files"]["analyzed"], 1);
    assert_eq!(stage["telemetry"]["files"]["skipped"], 1);
}

#[test]
fn analyze_stream_request_emits_jobs_facts_and_done_events() {
    let events = serve_response_lines_json(json!({
        "id": 112,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_ANALYZE_METHOD,
        "stream": true,
        "identity": run_identity_json(),
        "plan": skeleton_plan_json(),
        "files": [
            {
                "file": "src/prompts/refund.ts",
                "sourceHash": "sha256:source-refund",
                "sourceText": "export const refundPrompt = prompt({ id: 'refund' })"
            }
        ],
        "extensionEvidenceInterests": {
            "extractors": [
                {
                    "extension": { "name": "@acme/prompts", "version": "1" },
                    "name": "prompt.static",
                    "calls": [{ "name": "prompt", "configArg": 0 }]
                }
            ]
        }
    }));

    assert_eq!(events[0]["id"], 112);
    assert_eq!(events[0]["type"], "extensionEvidenceJobs");
    assert_eq!(
        events[0]["extensionEvidenceJobs"][0]["extractor"]["name"],
        "prompt.static"
    );
    assert_eq!(events[1]["type"], "fact");
    assert_eq!(events[1]["fact"]["definitions"][0]["id"], "prompt:refund");
    let done = events.last().expect("done event");
    assert_eq!(done["type"], "done");
    assert_eq!(done["response"]["method"], STATIC_INDEX_ANALYZE_METHOD);
    assert_eq!(done["response"]["facts"], json!([]));
    assert_eq!(done["response"]["extensionEvidenceJobs"], json!([]));
}

#[test]
fn analyze_request_emits_declared_extension_evidence_jobs_before_facts() {
    let events = serve_response_lines_json(json!({
        "id": 104,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_ANALYZE_METHOD,
        "stream": true,
        "identity": run_identity_json(),
        "plan": skeleton_plan_json(),
        "files": [
            {
                "file": "src/workflows/publish.ts",
                "sourceHash": "sha256:source-workflow",
                "sourceText": "import { defineWorkflow } from '@acme/workflows';\nexport const workflow = defineWorkflow({ id: 'publish', target: writerTool })"
            }
        ],
        "extensionEvidenceInterests": {
            "extractors": [
                {
                    "extension": { "name": "@acme/workflows", "version": "1" },
                    "name": "workflow.define",
                    "calls": [
                        {
                            "name": "defineWorkflow",
                            "importFrom": ["@acme/workflows"],
                            "configArg": 0,
                            "properties": ["id", "target"],
                            "source": "manifest"
                        }
                    ]
                }
            ]
        }
    }));

    assert_eq!(events[0]["id"], 104);
    assert_eq!(events[0]["ok"], true);
    assert_eq!(events[0]["type"], "extensionEvidenceJobs");
    let job = &events[0]["extensionEvidenceJobs"][0];
    assert_eq!(job["extractor"]["extension"]["name"], "@acme/workflows");
    assert_eq!(job["extractor"]["name"], "workflow.define");
    assert_eq!(job["file"], "src/workflows/publish.ts");
    assert_eq!(job["sourceHash"], "sha256:source-workflow");
    assert_eq!(job["evidence"]["kind"], "call");
    assert_eq!(
        job["evidence"]["callee"]["moduleSpecifier"],
        "@acme/workflows"
    );
    assert_eq!(job["evidence"]["objectArg"]["properties"][0]["name"], "id");
    assert_eq!(job["imports"][0]["moduleSpecifier"], "@acme/workflows");
    assert_eq!(job["frontend"]["name"], "oxc-rust");
}

#[test]
fn analyze_request_without_stream_is_rejected() {
    let line = serde_json::to_string(&json!({
        "id": 105,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_ANALYZE_METHOD,
        "identity": run_identity_json(),
        "plan": skeleton_plan_json(),
        "files": []
    }))
    .expect("request should serialize");

    let error = parse_serve_request(&line).expect_err("analyze without stream should fail");
    assert!(error.contains("staticIndexAnalyze requires stream: true"));
}

#[test]
fn finalize_stream_emits_patch_events_and_done_response() {
    let events = serve_response_lines_json(json!({
        "id": 121,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_FINALIZE_METHOD,
        "stream": true,
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
                        "status": "active"
                    }
                ]
            }
        ],
        "extensionFacts": []
    }));

    assert_eq!(events[0]["id"], 121);
    assert_eq!(events[0]["ok"], true);
    assert_eq!(events[0]["type"], "event");
    assert_eq!(events[0]["event"]["type"], "phase:start");
    assert_eq!(events[1]["type"], "event");
    assert_eq!(events[1]["event"]["type"], "fact:batch");

    let done = events.last().expect("done event");
    assert_eq!(done["type"], "done");
    let parsed: NativeStaticFinalizeResponse = serde_json::from_value(done["response"].clone())
        .expect("finalize response should deserialize");
    assert!(parsed.events.is_empty());
    assert_eq!(done["response"]["method"], STATIC_INDEX_FINALIZE_METHOD);
    assert_eq!(done["response"]["telemetry"]["facts"]["definitions"], 1);
}

#[test]
fn compile_stream_analyzes_and_streams_patch_events() {
    let events = serve_response_lines_json(json!({
        "id": 122,
        "protocolVersion": STATIC_INDEX_PROTOCOL_VERSION,
        "method": STATIC_INDEX_COMPILE_METHOD,
        "stream": true,
        "identity": run_identity_json(),
        "plan": skeleton_plan_json(),
        "files": [
            {
                "file": "src/prompts/refund.ts",
                "sourceHash": "sha256:source-refund",
                "sourceText": "export const refundPrompt = prompt({ id: 'refund' })"
            }
        ],
        "nativeFacts": [],
        "extensionFacts": []
    }));

    assert_eq!(events[0]["id"], 122);
    assert_eq!(events[0]["type"], "event");
    assert_eq!(events[0]["event"]["type"], "phase:start");
    assert_eq!(events[1]["event"]["type"], "fact:batch");
    assert_eq!(
        events[1]["event"]["facts"][0]["fact"]["id"],
        "prompt:refund"
    );
    let done = events.last().expect("done event");
    assert_eq!(done["type"], "done");
    assert_eq!(done["response"]["method"], STATIC_INDEX_COMPILE_METHOD);
    assert_eq!(done["response"]["events"], json!([]));
}
