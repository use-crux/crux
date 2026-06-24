use std::io::Write;

use serde_json::json;

use crate::native_static::pipeline;
use crate::protocol::native_static::NativeStaticAnalyzeRequest;
use crate::server::io::write_json_line;

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
    let output = pipeline::analyze(&request);
    if !output.extension_evidence_jobs.is_empty() {
        write_json_line(
            stdout,
            &json!({
                "id": id,
                "ok": true,
                "type": "extensionEvidenceJobs",
                "extensionEvidenceJobs": output.extension_evidence_jobs,
            }),
        )?;
    }

    for fact in output.facts {
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
            "response": output.response,
        }),
    )
}
