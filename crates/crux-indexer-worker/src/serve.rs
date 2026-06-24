use std::io::{self, BufRead, Write};

use serde_json::Value;

use crate::protocol::WorkerRequest;
use crate::worker;

pub fn run_from_args() -> Result<(), String> {
    let mode = std::env::args().nth(1);
    match mode.as_deref() {
        Some("serve") => serve(),
        _ => Err("usage: crux-indexer-worker serve".to_string()),
    }
}

fn serve() -> Result<(), String> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
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
    NativeStatic(worker::static_compiler::NativeStaticWorkerRequest),
}

pub(crate) fn parse_serve_request(line: &str) -> Result<ServeRequest, String> {
    let value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
    if worker::parse::has_worker_method(&value) {
        return worker::parse::parse_native_static_worker_request(value)
            .map(ServeRequest::NativeStatic);
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
        ServeRequest::Syntax(request) => worker::syntax::write_response(stdout, request),
        ServeRequest::NativeStatic(request) => {
            worker::static_compiler::write_native_static_worker_response(stdout, request)
        }
    }
}
