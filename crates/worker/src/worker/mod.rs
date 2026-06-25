use std::io::{BufRead, Write, stdin, stdout};

use serde_json::Value;

use crate::protocol::WorkerRequest;

mod analyze_stream;
mod compile_stream;
mod finalize_stream;
mod io;
mod parse;
mod static_index;
mod static_syntax;

#[cfg(test)]
pub(crate) mod static_index_tests;

#[cfg(test)]
mod stream_tests;

pub fn run_from_args() -> Result<(), String> {
    let mode = std::env::args().nth(1);
    match mode.as_deref() {
        Some("serve") => serve(),
        _ => Err("usage: crux-indexer-worker serve".to_string()),
    }
}

fn serve() -> Result<(), String> {
    let stdin = stdin();
    let mut stdout = stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let request = parse_serve_request(&line)?;
        write_serve_response(&mut stdout, request)?;
    }
    Ok(())
}

#[derive(Debug)]
pub(crate) enum ServeRequest {
    Syntax(WorkerRequest),
    StaticIndex(static_index::StaticIndexWorkerRequest),
}

pub(crate) fn parse_serve_request(line: &str) -> Result<ServeRequest, String> {
    let value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
    if parse::has_worker_method(&value) {
        return parse::parse_static_index_worker_request(value).map(ServeRequest::StaticIndex);
    }
    serde_json::from_value::<WorkerRequest>(value)
        .map(ServeRequest::Syntax)
        .map_err(|error| error.to_string())
}

pub(crate) fn write_serve_response<W: Write>(
    stdout: &mut W,
    request: ServeRequest,
) -> Result<(), String> {
    match request {
        ServeRequest::Syntax(request) => static_syntax::write_response(stdout, request),
        ServeRequest::StaticIndex(request) => {
            static_index::write_static_index_worker_response(stdout, request)
        }
    }
}
