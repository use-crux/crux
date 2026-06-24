//! JSON-lines transport adapter for native static compiler requests.
//!
//! The adapter owns method dispatch and response streaming only. Compiler
//! behavior lives behind `native_static::pipeline`, and serializable response
//! envelopes live in `protocol::worker`.

use std::io::Write;

use crate::native_static::pipeline;
use crate::protocol::native_static::{
    NativeStaticAnalyzeRequest, NativeStaticCompileRequest, NativeStaticFinalizeRequest,
    NativeStaticPrepareRequest,
};
use crate::protocol::worker::WorkerResponseEnvelope;
use crate::server::analyze_stream::write_analyze_stream;
use crate::server::compile_stream::write_compile_stream;
use crate::server::finalize_stream::write_finalize_stream;
use crate::server::io::write_json_line;

/// A native static request wrapped in the JSON-lines worker envelope.
#[derive(Debug)]
pub(crate) enum NativeStaticWorkerRequest {
    Prepare(u64, NativeStaticPrepareRequest),
    Analyze(u64, NativeStaticAnalyzeRequest),
    Finalize(u64, NativeStaticFinalizeRequest),
    Compile(u64, NativeStaticCompileRequest),
}

fn handle_native_static_worker_request(
    request: NativeStaticWorkerRequest,
) -> WorkerResponseEnvelope {
    match request {
        NativeStaticWorkerRequest::Prepare(id, request) => {
            WorkerResponseEnvelope::ok(id, pipeline::prepare(request))
        }
        NativeStaticWorkerRequest::Analyze(_, _) => {
            unreachable!("nativeStaticAnalyze is stream-only")
        }
        NativeStaticWorkerRequest::Finalize(id, request) => {
            WorkerResponseEnvelope::ok(id, pipeline::finalize(request))
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
            write_compile_stream(stdout, id, request)
        }
        request => write_json_line(stdout, &handle_native_static_worker_request(request)),
    }
}
