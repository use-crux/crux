//! JSON-lines worker adapter for the native static compiler skeleton.
//!
//! Phase 3 keeps syntax records intact while adding an internal branch for the
//! Phase 2 native static structs.

use std::io::Write;

use serde::Serialize;
use serde_json::Value;

use crate::native_static_finalize::finalize_native_static_values_with_lint_facts;
use crate::native_static_finalize_events::{
    NativeStaticFinalizeEventOptions, project_from_fact_values, project_patch_events,
};
use crate::native_static_lint_filter::NativeStaticLintOptions;
use crate::native_static_protocol::{
    NATIVE_STATIC_PROTOCOL_VERSION, NativeStaticAnalyzeRequest, NativeStaticCompileRequest,
    NativeStaticFactTelemetry, NativeStaticFinalizeRequest, NativeStaticFinalizeResponse,
    NativeStaticMethod, NativeStaticPlan, NativeStaticPrepareRequest, NativeStaticPrepareResponse,
};
use crate::native_static_relations::relation_policy_table_from_value_with_builtins;
use crate::native_static_worker_finalize_stream::write_finalize_stream;
use crate::native_static_worker_io::write_json_line;
use crate::native_static_worker_stream::write_analyze_stream;
use crate::native_static_worker_telemetry::{
    cache_telemetry, count_fact_telemetry, fact_telemetry_from_counts, file_telemetry, telemetry,
};

/// A native static request wrapped in the existing JSON-lines worker envelope.
#[derive(Debug)]
pub(crate) enum NativeStaticWorkerRequest {
    Prepare(u64, NativeStaticPrepareRequest),
    Analyze(u64, NativeStaticAnalyzeRequest),
    Finalize(u64, NativeStaticFinalizeRequest),
    Compile(u64, NativeStaticCompileRequest),
}

/// JSON-lines response envelope for native static compiler requests.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticWorkerResponse {
    id: u64,
    ok: bool,
    response: Value,
}

impl NativeStaticWorkerResponse {
    fn ok<T: Serialize>(id: u64, response: T) -> Self {
        Self {
            id,
            ok: true,
            response: serde_json::to_value(response)
                .expect("native static response should serialize"),
        }
    }
}

/// Produce a normalized placeholder response for the requested native stage.
pub(crate) fn handle_native_static_worker_request(
    request: NativeStaticWorkerRequest,
) -> NativeStaticWorkerResponse {
    match request {
        NativeStaticWorkerRequest::Prepare(id, request) => {
            NativeStaticWorkerResponse::ok(id, handle_prepare(request))
        }
        NativeStaticWorkerRequest::Analyze(_, _) => {
            unreachable!("nativeStaticAnalyze is stream-only")
        }
        NativeStaticWorkerRequest::Finalize(id, request) => {
            NativeStaticWorkerResponse::ok(id, handle_finalize(request))
        }
        NativeStaticWorkerRequest::Compile(_, _) => {
            unreachable!("nativeStaticCompile is stream-only")
        }
    }
}

pub(crate) fn write_native_static_worker_response<W: Write>(
    stdout: &mut W,
    request: NativeStaticWorkerRequest,
) -> Result<(), String> {
    match request {
        NativeStaticWorkerRequest::Analyze(id, request) if request.stream => {
            write_analyze_stream(stdout, id, request)
        }
        NativeStaticWorkerRequest::Finalize(id, request) if request.stream => {
            write_finalize_stream(stdout, id, request)
        }
        NativeStaticWorkerRequest::Compile(id, request) if request.stream => {
            crate::native_static_worker_compile_stream::write_compile_stream(stdout, id, request)
        }
        request => write_json_line(stdout, &handle_native_static_worker_request(request)),
    }
}

fn handle_prepare(request: NativeStaticPrepareRequest) -> NativeStaticPrepareResponse {
    let files = request.files;
    let primary_files = request.primary_files.unwrap_or_else(|| files.clone());
    let cache_hits = files
        .iter()
        .filter(|file| file.cache_key.is_some())
        .cloned()
        .collect::<Vec<_>>();
    let cache_misses = files
        .iter()
        .filter(|file| file.cache_key.is_none())
        .cloned()
        .collect::<Vec<_>>();
    let selected = files.len() as u64;
    let hit_count = cache_hits.len() as u64;
    let miss_count = cache_misses.len() as u64;

    NativeStaticPrepareResponse {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        method: NativeStaticMethod::Prepare,
        plan: NativeStaticPlan {
            root: request.root,
            project_name: request.project_name,
            files,
            primary_files: Some(primary_files),
            cache_hits,
            cache_misses,
            call_names: request.call_names,
            call_interests: request.call_interests,
            constructor_names: request.constructor_names,
            constructor_interests: request.constructor_interests,
            prune_native_fact_call_names: request.prune_native_fact_call_names,
        },
        diagnostics: Vec::new(),
        telemetry: telemetry(
            "prepare",
            selected,
            file_telemetry(selected, hit_count, miss_count, 0, selected),
            cache_telemetry(hit_count, miss_count, 0),
            NativeStaticFactTelemetry::default(),
        ),
    }
}

pub(crate) fn handle_finalize(
    request: NativeStaticFinalizeRequest,
) -> NativeStaticFinalizeResponse {
    let policies = relation_policy_table_from_value_with_builtins(request.relation_specs.as_ref());
    let lint_options = NativeStaticLintOptions {
        emit_builtin_lints: request.emit_builtin_lints.unwrap_or(true),
        config: request.lint_config.clone(),
        files: request.lint_files.clone(),
    };
    let finalized = finalize_native_static_values_with_lint_facts(
        &request.native_facts,
        &request.extension_facts,
        &request.lint_facts,
        &policies,
        &lint_options,
    );
    let fact_count = finalized
        .counts
        .total()
        .max(request.native_facts.len() + request.extension_facts.len() + request.lint_facts.len());
    let facts = if finalized.counts.is_empty() {
        count_fact_telemetry(
            request
                .native_facts
                .iter()
                .chain(request.extension_facts.iter())
                .chain(request.lint_facts.iter()),
        )
    } else {
        fact_telemetry_from_counts(finalized.counts)
    };
    let writes = request
        .cache
        .as_ref()
        .and_then(|cache| cache.get("writes"))
        .and_then(Value::as_array)
        .map(|writes| writes.len() as u64)
        .unwrap_or(0);

    let patch_phase = request.patch_phase.as_deref().unwrap_or("ast");
    let default_invalidates = (patch_phase == "ast").then(|| serde_json::json!({ "all": true }));
    let patch_invalidates = request
        .patch_invalidates
        .as_ref()
        .or(default_invalidates.as_ref());

    let project = project_from_fact_values(&request.native_facts)
        .or_else(|| project_from_fact_values(&request.extension_facts))
        .or_else(|| project_from_fact_values(&request.lint_facts));
    let events = project
        .as_ref()
        .map(|project| {
            project_patch_events(
                &finalized,
                project,
                &request.identity.compiler.version,
                NativeStaticFinalizeEventOptions {
                    phase: patch_phase,
                    invalidates: patch_invalidates,
                },
            )
        })
        .unwrap_or_default();

    NativeStaticFinalizeResponse {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        method: NativeStaticMethod::Finalize,
        events,
        telemetry: telemetry(
            "finalize",
            fact_count as u64,
            file_telemetry(0, 0, 0, 0, 0),
            cache_telemetry(0, 0, writes),
            facts,
        ),
    }
}
