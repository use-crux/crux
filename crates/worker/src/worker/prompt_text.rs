//! Persistent-worker adapter for transient PromptText queries.

use std::io::Write;

use crate::protocol::{process::WorkerResponseEnvelope, prompt_text::PromptTextWorkerRequest};
use crate::worker::io::write_json_line;

pub(crate) fn write_response<W: Write>(
    stdout: &mut W,
    request: PromptTextWorkerRequest,
) -> Result<(), String> {
    let response = crux_indexer_static_compiler::prompt_text::analyze(request.query);
    write_json_line(stdout, &WorkerResponseEnvelope::ok(request.id, response))
}
