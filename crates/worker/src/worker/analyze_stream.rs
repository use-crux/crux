use std::io::Write;

use serde_json::json;

use crate::protocol::static_index::StaticIndexAnalyzeRequest;
use crate::worker::io::write_json_line;
use crux_indexer_static_compiler::pipeline;

/// Write the stream-only Static Index analyze protocol.
///
/// Extension evidence jobs are emitted before fact extraction so the Go
/// coordinator can start the JS/TS extension lane while Rust continues native
/// parsing and projection. The final response carries stage telemetry only;
/// facts and jobs are exclusively emitted as stream events.
pub(crate) fn write_analyze_stream<W: Write>(
    stdout: &mut W,
    id: u64,
    request: StaticIndexAnalyzeRequest,
) -> Result<(), String> {
    let output = pipeline::analyze(&request);
    let (extension_evidence_jobs, facts, response) = output.into_wire_parts();
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
