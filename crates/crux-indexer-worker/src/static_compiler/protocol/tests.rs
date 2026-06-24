use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::protocol::static_compiler::{
    NATIVE_STATIC_ANALYZE_METHOD, NATIVE_STATIC_FINALIZE_METHOD, NATIVE_STATIC_PREPARE_METHOD,
    NATIVE_STATIC_PROTOCOL_VERSION, NativeStaticAnalyzeRequest, NativeStaticAnalyzeResponse,
    NativeStaticFinalizeRequest, NativeStaticFinalizeResponse, NativeStaticPrepareRequest,
    NativeStaticPrepareResponse,
};

#[test]
fn prepare_protocol_round_trips_realistic_json() {
    let request = json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "method": NATIVE_STATIC_PREPARE_METHOD,
        "root": "/workspace/acme",
        "projectName": "acme",
        "configPath": "/workspace/acme/crux.config.ts",
        "identity": run_identity_json(),
        "files": selected_files_json(),
        "callNames": ["agent", "prompt"],
        "callInterests": [
            {
                "name": "tool",
                "importFrom": ["@crux/core"],
                "configArg": 0,
                "properties": ["id", "handler"],
                "callbacks": [{ "property": "handler", "maxDepth": 2 }],
                "source": "first-party"
            }
        ],
        "constructorNames": ["Agent"],
        "constructorInterests": [
            {
                "name": "Agent",
                "importFrom": ["@crux/core"],
                "configArg": 0,
                "properties": ["name", "instructions"]
            }
        ],
        "pruneNativeFactCallNames": ["router"],
        "cacheInputs": [
            {
                "kind": "config",
                "path": "crux.config.ts",
                "hash": "sha256:config"
            }
        ],
        "extensionHost": {
            "required": true,
            "reasons": ["third-party-extension"]
        }
    });

    assert_round_trip::<NativeStaticPrepareRequest>(&request);

    let response = json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "method": NATIVE_STATIC_PREPARE_METHOD,
        "plan": prepared_plan_json(),
        "diagnostics": [
            {
                "id": "native-static-config-warning",
                "severity": "warning",
                "message": "Extension host required for @acme/crux-extra."
            }
        ],
        "telemetry": telemetry_json()
    });

    assert_round_trip::<NativeStaticPrepareResponse>(&response);
}

#[test]
fn analyze_protocol_round_trips_realistic_json() {
    let request = json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "method": NATIVE_STATIC_ANALYZE_METHOD,
        "identity": run_identity_json(),
        "plan": prepared_plan_json(),
        "files": [
            {
                "file": "src/agents/support.ts",
                "sourceHash": "sha256:source-support",
                "sourceText": "export const supportAgent = agent({ prompt: refundPrompt })"
            }
        ],
        "extensionEvidenceInterests": {
            "mode": "declared",
            "calls": [{ "name": "tool", "importFrom": ["@crux/core"] }]
        }
    });

    assert_round_trip::<NativeStaticAnalyzeRequest>(&request);

    let response = json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "method": NATIVE_STATIC_ANALYZE_METHOD,
        "facts": [
            {
                "kind": "definition",
                "id": "definition:agent:supportAgent",
                "type": "agent",
                "name": "supportAgent"
            }
        ],
        "diagnostics": [],
        "extensionEvidenceJobs": [
            {
                "extension": "@acme/crux-extra",
                "extractor": "auditToolExtractor",
                "file": "src/agents/support.ts",
                "evidence": [{ "kind": "call", "name": "tool" }]
            }
        ],
        "telemetry": telemetry_json()
    });

    assert_round_trip::<NativeStaticAnalyzeResponse>(&response);
}

#[test]
fn finalize_protocol_round_trips_realistic_json() {
    let request = json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "method": NATIVE_STATIC_FINALIZE_METHOD,
        "identity": run_identity_json(),
        "nativeFacts": [
            {
                "kind": "definition",
                "id": "definition:prompt:refundPrompt",
                "type": "prompt",
                "name": "refundPrompt"
            }
        ],
        "extensionFacts": [
            {
                "kind": "source-ref",
                "id": "source-ref:auditTool:handler",
                "role": "handler"
            }
        ],
        "lintFacts": [
            {
                "definitions": [
                    {
                        "id": "quality-target:writer",
                        "kind": "quality.target",
                        "name": "writer",
                        "fidelity": "resolved",
                        "quality": {
                            "experimentIds": ["experiment:writer"],
                            "experimentCount": 1
                        }
                    }
                ]
            }
        ],
        "relationSpecs": {
            "policies": [{ "type": "uses", "from": "agent", "to": "prompt" }]
        },
        "ruleResults": {
            "lintFindings": [{ "id": "lint:missing-description", "severity": "info" }]
        },
        "lintConfig": {
            "profile": "recommended"
        },
        "lintFiles": ["src/agents/support.ts"],
        "emitBuiltinLints": false,
        "patchPhase": "quality",
        "patchInvalidates": {},
        "cache": {
            "writes": [
                {
                    "file": "src/agents/support.ts",
                    "cacheKey": "static:src/agents/support.ts:source-support"
                }
            ]
        }
    });

    assert_round_trip::<NativeStaticFinalizeRequest>(&request);

    let response = json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "method": NATIVE_STATIC_FINALIZE_METHOD,
        "events": [
            {
                "type": "fact",
                "fact": {
                    "kind": "relation",
                    "id": "relation:uses:definition:agent:supportAgent:definition:prompt:refundPrompt"
                }
            },
            {
                "type": "patch-metadata",
                "status": "complete"
            }
        ],
        "telemetry": telemetry_json()
    });

    assert_round_trip::<NativeStaticFinalizeResponse>(&response);
}

fn assert_round_trip<T>(value: &Value)
where
    T: DeserializeOwned + Serialize,
{
    let parsed: T = serde_json::from_value(value.clone()).expect("deserialize protocol value");
    let serialized = serde_json::to_value(parsed).expect("serialize protocol value");
    assert_eq!(&serialized, value);
}

fn run_identity_json() -> Value {
    json!({
        "protocolVersion": NATIVE_STATIC_PROTOCOL_VERSION,
        "compiler": version_identity_json("crux-native-static", "0.1.0"),
        "oxc": version_identity_json("oxc-rust", "oxc_parser@0.133.0+crux_native_group3.5"),
        "primitiveManifest": digest_identity_json(
            "crux-first-party-primitives",
            "2026-06-22",
            "sha256:primitive-manifest"
        ),
        "relationPolicy": digest_identity_json(
            "crux-relation-policy",
            "v1",
            "sha256:relation-policy"
        ),
        "extensionManifests": [
            digest_identity_json("@acme/crux-extra", "1.4.2", "sha256:extension-manifest"),
            version_identity_json("@crux/core", "workspace")
        ],
        "firstPartyGraphRules": digest_identity_json(
            "crux-first-party-graph-rules",
            "v1",
            "sha256:first-party-rules"
        ),
        "compilerProjection": digest_identity_json(
            "crux-static-projection",
            "projection-v1",
            "sha256:compiler-projection"
        )
    })
}

fn prepared_plan_json() -> Value {
    json!({
        "root": "/workspace/acme",
        "projectName": "acme",
        "files": selected_files_json(),
        "cacheHits": [refund_file_json()],
        "cacheMisses": [support_file_json()],
        "callNames": ["agent", "prompt"],
        "callInterests": [
            {
                "name": "tool",
                "importFrom": ["@crux/core"],
                "configArg": 0,
                "properties": ["id", "handler"],
                "callbacks": [{ "property": "handler", "maxDepth": 2 }],
                "source": "first-party"
            }
        ],
        "constructorNames": ["Agent"],
        "constructorInterests": [
            {
                "name": "Agent",
                "importFrom": ["@crux/core"],
                "configArg": 0,
                "properties": ["name", "instructions"]
            }
        ],
        "pruneNativeFactCallNames": ["router"]
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

fn version_identity_json(name: &str, version: &str) -> Value {
    json!({ "name": name, "version": version })
}

fn digest_identity_json(name: &str, version: &str, digest: &str) -> Value {
    json!({ "name": name, "version": version, "digest": digest })
}

fn telemetry_json() -> Value {
    json!({
        "node": {
            "started": true,
            "reasons": ["third-party-extension"]
        },
        "nativeOnly": {
            "eligible": false,
            "reasons": ["third-party-extension"]
        },
        "timings": [
            {
                "name": "prepare",
                "durationMs": 4.25,
                "count": 2
            },
            {
                "name": "parse",
                "durationMs": 12.5
            }
        ],
        "files": {
            "selected": 2,
            "cacheHits": 1,
            "cacheMisses": 1,
            "analyzed": 1,
            "skipped": 1
        },
        "cache": {
            "readHits": 1,
            "readMisses": 1,
            "writes": 1,
            "writeErrors": 0
        },
        "facts": {
            "definitions": 3,
            "relations": 2,
            "sourceRefs": 4,
            "diagnostics": 1,
            "lintFindings": 1,
            "ruleDescriptors": 1,
            "sources": 2,
            "sourceGraph": 2
        }
    })
}
