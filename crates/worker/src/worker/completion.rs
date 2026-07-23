//! Persistent-worker adapter for transient completion queries.

use std::io::Write;

use crate::protocol::{completion::CompletionWorkerRequest, process::WorkerResponseEnvelope};
use crate::worker::io::write_json_line;

pub(crate) fn write_response<W: Write>(
    stdout: &mut W,
    request: CompletionWorkerRequest,
) -> Result<(), String> {
    let response = crux_indexer_static_compiler::completion::complete(request.query);
    write_json_line(stdout, &WorkerResponseEnvelope::ok(request.id, response))
}
