//! JSON-lines transport adapter for Static Index compiler requests.
//!
//! The adapter owns method dispatch and response streaming only. Compiler
//! behavior lives behind `crux_indexer_static_compiler::pipeline`, and
//! serializable response envelopes live in `protocol::worker`.

use std::io::Write;

use crate::protocol::static_index::{
    StaticIndexAnalyzeRequest, StaticIndexCompileRequest, StaticIndexFinalizeRequest,
    StaticIndexPrepareRequest,
};
use crate::protocol::worker::WorkerResponseEnvelope;
use crate::worker::analyze_stream::write_analyze_stream;
use crate::worker::compile_stream::write_compile_stream;
use crate::worker::finalize_stream::write_finalize_stream;
use crate::worker::io::write_json_line;
use crux_indexer_static_compiler::pipeline;

/// A Static Index request wrapped in the JSON-lines worker envelope.
#[derive(Debug)]
pub(crate) enum StaticIndexWorkerRequest {
    Prepare(u64, StaticIndexPrepareRequest),
    Analyze(u64, StaticIndexAnalyzeRequest),
    Finalize(u64, StaticIndexFinalizeRequest),
    Compile(u64, StaticIndexCompileRequest),
}

fn handle_static_index_worker_request(request: StaticIndexWorkerRequest) -> WorkerResponseEnvelope {
    match request {
        StaticIndexWorkerRequest::Prepare(id, request) => {
            WorkerResponseEnvelope::ok(id, pipeline::prepare(request))
        }
        StaticIndexWorkerRequest::Analyze(_, _) => {
            unreachable!("staticIndexAnalyze is stream-only")
        }
        StaticIndexWorkerRequest::Finalize(id, request) => {
            WorkerResponseEnvelope::ok(id, pipeline::finalize(request))
        }
        StaticIndexWorkerRequest::Compile(_, _) => {
            unreachable!("staticIndexCompile is stream-only")
        }
    }
}

pub(crate) fn write_static_index_worker_response<W: Write>(
    stdout: &mut W,
    request: StaticIndexWorkerRequest,
) -> Result<(), String> {
    match request {
        StaticIndexWorkerRequest::Analyze(id, request) if request.stream => {
            write_analyze_stream(stdout, id, request)
        }
        StaticIndexWorkerRequest::Finalize(id, request) if request.stream => {
            write_finalize_stream(stdout, id, request)
        }
        StaticIndexWorkerRequest::Compile(id, request) if request.stream => {
            write_compile_stream(stdout, id, request)
        }
        request => write_json_line(stdout, &handle_static_index_worker_request(request)),
    }
}
