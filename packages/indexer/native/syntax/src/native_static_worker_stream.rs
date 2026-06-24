use std::io::Write;

use serde_json::json;

use crate::native_static_analyze::analyze_native_static_facts;
use crate::native_static_evidence::extension_evidence_jobs;
use crate::native_static_protocol::{
    NATIVE_STATIC_PROTOCOL_VERSION, NativeStaticAnalyzeRequest, NativeStaticAnalyzeResponse,
    NativeStaticFactTelemetry, NativeStaticMethod,
};
use crate::native_static_worker_io::write_json_line;
use crate::native_static_worker_telemetry::{cache_telemetry, file_telemetry, telemetry};

/// Write the stream-only native static analyze protocol.
///
/// Extension evidence jobs are emitted before fact extraction so the Go
/// coordinator can start the JS/TS extension lane while Rust continues native
/// parsing and projection. The final response carries stage telemetry only;
/// facts and jobs are exclusively emitted as stream events.
pub(crate) fn write_analyze_stream<W: Write>(
    stdout: &mut W,
    id: u64,
    request: NativeStaticAnalyzeRequest,
) -> Result<(), String> {
    let extension_evidence_jobs = extension_evidence_jobs(&request);
    if !extension_evidence_jobs.is_empty() {
        write_json_line(
            stdout,
            &json!({
                "id": id,
                "ok": true,
                "type": "extensionEvidenceJobs",
                "extensionEvidenceJobs": extension_evidence_jobs,
            }),
        )?;
    }

    let facts = analyze_native_static_facts(&request);
    for fact in facts {
        write_json_line(
            stdout,
            &json!({
                "id": id,
                "ok": true,
                "type": "fact",
                "fact": fact,
            }),
        )?;
    }

    let selected = request.plan.files.len() as u64;
    let cache_hits = request.plan.cache_hits.len() as u64;
    let cache_misses = request.plan.cache_misses.len() as u64;
    let analyzed = request.files.len() as u64;
    let skipped = selected.saturating_sub(analyzed);
    let response = NativeStaticAnalyzeResponse {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        method: NativeStaticMethod::Analyze,
        facts: Vec::new(),
        diagnostics: Vec::new(),
        extension_evidence_jobs: Vec::new(),
        telemetry: telemetry(
            "analyze",
            analyzed,
            file_telemetry(selected, cache_hits, cache_misses, analyzed, skipped),
            cache_telemetry(cache_hits, cache_misses, 0),
            NativeStaticFactTelemetry::default(),
        ),
    };
    write_json_line(
        stdout,
        &json!({
            "id": id,
            "ok": true,
            "type": "done",
            "response": response,
        }),
    )
}
