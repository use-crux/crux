pub(crate) mod protocol {
    pub(crate) mod static_compile;
    pub(crate) mod static_compiler;
    pub(crate) mod syntax_record;
    pub(crate) mod syntax_worker;

    pub(crate) use syntax_record::*;
}

pub(crate) mod syntax {
    pub(crate) mod argument_values;
    pub(crate) mod extract;
    pub(crate) mod function_calls;
    pub(crate) mod function_values;
    pub(crate) mod imports;
    pub(crate) mod initializers;
    pub(crate) mod match_arguments;
    pub(crate) mod match_build;
    pub(crate) mod match_expressions;
    pub(crate) mod match_interests;
    pub(crate) mod match_statements;
    pub(crate) mod object_values;
    pub(crate) mod resolve;
    pub(crate) mod source;
    pub(crate) mod values;
}

pub(crate) mod primitives {
    pub(crate) mod agent_convex_facts;
    pub(crate) mod agent_facts;
    pub(crate) mod agent_metadata;
    pub(crate) mod blackboard_facts;
    pub(crate) mod composition_facts;
    pub(crate) mod composition_output;
    pub(crate) mod composition_relations;
    pub(crate) mod composition_values;
    pub(crate) mod context_facts;
    pub(crate) mod data_access;
    pub(crate) mod data_access_output;
    pub(crate) mod definition;
    pub(crate) mod eval_assertions;
    pub(crate) mod eval_facts;
    pub(crate) mod facts;
    pub(crate) mod flow_facts;
    pub(crate) mod flow_output;
    pub(crate) mod injectable_facts;
    pub(crate) mod injection;
    pub(crate) mod injection_tools;
    pub(crate) mod memory_blocks;
    pub(crate) mod memory_facts;
    pub(crate) mod memory_id;
    pub(crate) mod memory_store;
    pub(crate) mod prompt_facts;
    pub(crate) mod rag_facts;
    pub(crate) mod rag_metadata;
    pub(crate) mod record_values;
    pub(crate) mod registry_facts;
    pub(crate) mod routing_cascade;
    pub(crate) mod routing_facts;
    pub(crate) mod routing_fallback;
    pub(crate) mod routing_model;
    pub(crate) mod routing_output;
    pub(crate) mod routing_router;
    pub(crate) mod routing_source_refs;
    pub(crate) mod runtime_join;
    pub(crate) mod runtime_join_flow;
    pub(crate) mod runtime_join_memory;
    pub(crate) mod safety_facts;
    pub(crate) mod schema;
    pub(crate) mod schema_common;
    pub(crate) mod schema_convex;
    pub(crate) mod schema_zod;
    pub(crate) mod scorer_facts;
    pub(crate) mod source_refs;
    pub(crate) mod tool_facts;
    pub(crate) mod workspace_facts;
}

pub(crate) mod static_compiler {
    pub(crate) mod analyze;
    pub(crate) mod analyze_parse;
    #[cfg(test)]
    pub(crate) mod analyze_source_ref_tests;
    #[cfg(test)]
    pub(crate) mod analyze_tests;
    #[cfg(test)]
    pub(crate) mod analyze_tree_tests;
    pub(crate) mod definition_merge;
    pub(crate) mod evidence;
    pub(crate) mod facts;
    pub(crate) mod finalize;
    pub(crate) mod finalize_events;
    #[cfg(test)]
    pub(crate) mod finalize_events_tests;
    pub(crate) mod finalize_lint_model;
    #[cfg(test)]
    pub(crate) mod finalize_lint_tests;
    #[cfg(test)]
    pub(crate) mod finalize_tests;
    pub(crate) mod input_contract_schema;
    pub(crate) mod input_contracts;
    #[cfg(test)]
    pub(crate) mod input_contracts_tests;
    pub(crate) mod lint_builder;
    pub(crate) mod lint_contracts;
    pub(crate) mod lint_core_rules;
    pub(crate) mod lint_definition_tail;
    pub(crate) mod lint_emit;
    pub(crate) mod lint_filter;
    pub(crate) mod lint_filter_rules;
    pub(crate) mod lint_helpers;
    pub(crate) mod lint_injection_entries;
    pub(crate) mod lint_injection_evidence;
    pub(crate) mod lint_injection_evidence_data;
    pub(crate) mod lint_injection_inputs;
    pub(crate) mod lint_injection_model;
    pub(crate) mod lint_injection_model_helpers;
    pub(crate) mod lint_injection_rules;
    pub(crate) mod lint_propagation;
    pub(crate) mod lint_relation_rules;
    pub(crate) mod lint_routing;
    pub(crate) mod lints;
    #[cfg(test)]
    pub(crate) mod protocol_tests;
    pub(crate) mod read_model;
    pub(crate) mod read_model_helpers;
    pub(crate) mod read_model_injection;
    pub(crate) mod read_model_routing;
    #[cfg(test)]
    pub(crate) mod relation_alias_tests;
    pub(crate) mod relation_fallback;
    #[cfg(test)]
    pub(crate) mod relation_fallback_tests;
    #[cfg(test)]
    pub(crate) mod relation_gap_tests;
    pub(crate) mod relation_gaps;
    pub(crate) mod relation_policy;
    #[cfg(test)]
    pub(crate) mod relation_policy_tests;
    #[cfg(test)]
    pub(crate) mod relation_ref_tests;
    pub(crate) mod relation_report;
    pub(crate) mod relations;
    #[cfg(test)]
    pub(crate) mod relations_tests;
    pub(crate) mod scoped_definitions;
    pub(crate) mod source_groups;
    pub(crate) mod source_model;
    #[cfg(test)]
    pub(crate) mod source_model_tests;
    pub(crate) mod tree_paths;
}

pub(crate) mod worker {
    pub(crate) mod analyze_stream;
    pub(crate) mod compile_stream;
    pub(crate) mod finalize_stream;
    pub(crate) mod io;
    pub(crate) mod parse;
    pub(crate) mod static_compiler;
    #[cfg(test)]
    pub(crate) mod static_compiler_tests;
    #[cfg(test)]
    pub(crate) mod stream_tests;
    pub(crate) mod telemetry;
}

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use rayon::prelude::*;
use serde_json::Value;

use protocol::syntax_worker::BatchWorkerFileRequest;
use protocol::{
    BatchWorkerRequest, ParseRequest, SingleWorkerRequest, WorkerRequest, WorkerResponse,
    WorkerStreamEvent,
};

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
        ServeRequest::Syntax(request) => write_worker_response(stdout, request),
        ServeRequest::NativeStatic(request) => {
            worker::static_compiler::write_native_static_worker_response(stdout, request)
        }
    }
}

fn write_worker_response<W: Write>(stdout: &mut W, request: WorkerRequest) -> Result<(), String> {
    match request {
        WorkerRequest::Batch(request) if request.stream => {
            write_streaming_batch_response(stdout, request)
        }
        request => write_json_line(stdout, &handle_request(request)),
    }
}

fn write_streaming_batch_response<W: Write>(
    stdout: &mut W,
    request: BatchWorkerRequest,
) -> Result<(), String> {
    let id = request.id;
    let total = request.files.len();
    let call_names = request.call_names;
    let call_interests = request.call_interests;
    let constructor_names = request.constructor_names;
    let constructor_interests = request.constructor_interests;
    let prune_native_fact_call_names = request.prune_native_fact_call_names;
    let (sender, receiver) = mpsc::channel::<ParsedStreamMessage>();

    let mut failed = false;
    let mut write_error: Option<String> = None;

    rayon::spawn(move || {
        request
            .files
            .into_par_iter()
            .enumerate()
            .for_each_with(sender, |sender, (index, file)| {
                let result = parse_batch_file_record(
                    file,
                    call_names.clone(),
                    call_interests.clone(),
                    constructor_names.clone(),
                    constructor_interests.clone(),
                    prune_native_fact_call_names.clone(),
                );
                let _ = sender.send(ParsedStreamMessage { index, result });
            });
    });

    for message in receiver {
        if failed {
            continue;
        }
        match message.result {
            Ok(record) => {
                if let Err(error) = write_json_line(
                    stdout,
                    &WorkerStreamEvent::record(id, message.index, &record),
                ) {
                    write_error = Some(error);
                    failed = true;
                }
            }
            Err(error) => {
                if let Err(error) = write_json_line(stdout, &WorkerStreamEvent::error(id, error)) {
                    write_error = Some(error);
                }
                failed = true;
            }
        }
    }

    if let Some(error) = write_error {
        return Err(error);
    }
    if failed {
        return Ok(());
    }
    write_json_line(stdout, &WorkerStreamEvent::done(id, total))
}

fn write_json_line<W: Write, T: serde::Serialize>(stdout: &mut W, value: &T) -> Result<(), String> {
    serde_json::to_writer(&mut *stdout, value).map_err(|error| error.to_string())?;
    stdout.write_all(b"\n").map_err(|error| error.to_string())?;
    stdout.flush().map_err(|error| error.to_string())
}

fn handle_request(request: WorkerRequest) -> WorkerResponse {
    let id = request.id();
    match parse_worker_request(request) {
        Ok(ParsedWorkerResponse::Single(record)) => WorkerResponse::ok(id, record),
        Ok(ParsedWorkerResponse::Batch(records)) => WorkerResponse::ok_batch(id, records),
        Err(error) => WorkerResponse::error(id, error),
    }
}

enum ParsedWorkerResponse {
    Single(protocol::StaticSyntaxFileRecord),
    Batch(Vec<protocol::StaticSyntaxFileRecord>),
}

fn parse_worker_request(request: WorkerRequest) -> Result<ParsedWorkerResponse, String> {
    match request {
        WorkerRequest::Single(request) => parse_record(request).map(ParsedWorkerResponse::Single),
        WorkerRequest::Batch(request) => parse_records(request).map(ParsedWorkerResponse::Batch),
    }
}

fn parse_record(request: SingleWorkerRequest) -> Result<protocol::StaticSyntaxFileRecord, String> {
    let source = request_source(
        &request.root,
        &request.file,
        request.source,
        request.read_source_from_disk,
    )?;
    let input = ParseRequest {
        root: request.root,
        file: request.file,
        source,
        call_names: request.call_names,
        call_interests: request.call_interests,
        constructor_names: request.constructor_names,
        constructor_interests: request.constructor_interests,
        prune_native_fact_call_names: request.prune_native_fact_call_names,
    };
    syntax::extract::parse_static_syntax_record(input)
}

fn parse_records(
    request: BatchWorkerRequest,
) -> Result<Vec<protocol::StaticSyntaxFileRecord>, String> {
    let call_names = request.call_names;
    let call_interests = request.call_interests;
    let constructor_names = request.constructor_names;
    let constructor_interests = request.constructor_interests;
    let prune_native_fact_call_names = request.prune_native_fact_call_names;
    request
        .files
        .into_par_iter()
        .map(|file| {
            parse_batch_file_record(
                file,
                call_names.clone(),
                call_interests.clone(),
                constructor_names.clone(),
                constructor_interests.clone(),
                prune_native_fact_call_names.clone(),
            )
        })
        .collect()
}

struct ParsedStreamMessage {
    index: usize,
    result: Result<protocol::StaticSyntaxFileRecord, String>,
}

fn parse_batch_file_record(
    file: BatchWorkerFileRequest,
    call_names: Vec<String>,
    call_interests: Vec<protocol::StaticSyntaxCallInterest>,
    constructor_names: Vec<String>,
    constructor_interests: Vec<protocol::StaticSyntaxConstructorInterest>,
    prune_native_fact_call_names: Vec<String>,
) -> Result<protocol::StaticSyntaxFileRecord, String> {
    let source = request_source(
        &file.root,
        &file.file,
        file.source,
        file.read_source_from_disk,
    )?;
    syntax::extract::parse_static_syntax_record(ParseRequest {
        root: file.root,
        file: file.file,
        source,
        call_names,
        call_interests,
        constructor_names,
        constructor_interests,
        prune_native_fact_call_names,
    })
}

fn request_source(
    root: &str,
    file: &str,
    source: Option<String>,
    read_source_from_disk: bool,
) -> Result<String, String> {
    if read_source_from_disk {
        let source_path = validate_source_path(root, file)?;
        return fs::read_to_string(&source_path)
            .map_err(|error| format!("read source for native syntax record {file}: {error}"));
    }
    source.ok_or_else(|| format!("native syntax request for {file} did not include source text"))
}

fn validate_source_path(root: &str, file: &str) -> Result<PathBuf, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|error| format!("resolve native syntax root {root}: {error}"))?;
    let requested = Path::new(file);
    let requested = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root_path.join(requested)
    };
    let source_path = requested
        .canonicalize()
        .map_err(|error| format!("resolve native syntax source {file}: {error}"))?;
    if !source_path.starts_with(&root_path) {
        return Err(format!(
            "native syntax request for {file} escapes project root {root}"
        ));
    }
    Ok(source_path)
}

#[cfg(test)]
mod tests {
    use std::{env, fs, process, time::SystemTime};

    use crate::{protocol::WorkerRequest, request_source, write_worker_response};

    #[test]
    fn deserializes_batch_worker_request() {
        let request: WorkerRequest = serde_json::from_str(
            r#"{"id":7,"files":[{"root":"/repo","file":"/repo/a.ts","source":"export const a = 1"}],"callNames":["prompt"],"constructorNames":["Agent"]}"#,
        )
        .expect("batch request should deserialize");

        match request {
            WorkerRequest::Batch(batch) => {
                assert_eq!(batch.id, 7);
                assert_eq!(batch.files.len(), 1);
                assert_eq!(batch.call_names, vec!["prompt"]);
            }
            WorkerRequest::Single(_) => panic!("expected batch request"),
        }
    }

    #[test]
    fn deserializes_disk_source_batch_worker_request() {
        let request: WorkerRequest = serde_json::from_str(
            r#"{"id":8,"files":[{"root":"/repo","file":"/repo/a.ts","readSourceFromDisk":true}],"callNames":["prompt"],"stream":true}"#,
        )
        .expect("disk-source batch request should deserialize");

        match request {
            WorkerRequest::Batch(batch) => {
                assert_eq!(batch.id, 8);
                assert!(batch.stream);
                assert!(batch.files[0].read_source_from_disk);
                assert!(batch.files[0].source.is_none());
            }
            WorkerRequest::Single(_) => panic!("expected batch request"),
        }
    }

    #[test]
    fn writes_streaming_batch_records() {
        let request: WorkerRequest = serde_json::from_str(
            r#"{"id":9,"files":[{"root":"/repo","file":"/repo/a.ts","source":"export const a = prompt({ id: 'a' })"}],"callNames":["prompt"],"stream":true}"#,
        )
        .expect("streaming batch request should deserialize");

        let mut output = Vec::new();
        write_worker_response(&mut output, request).expect("streaming response should write");
        let text = String::from_utf8(output).expect("response should be utf8");
        let lines: Vec<&str> = text.lines().collect();

        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains(r#""type":"record""#));
        assert!(lines[0].contains(r#""index":0"#));
        assert!(lines[1].contains(r#""type":"done""#));
        assert!(lines[1].contains(r#""count":1"#));
    }

    #[test]
    fn writes_streaming_batch_error_event() {
        let request: WorkerRequest = serde_json::from_str(
            r#"{"id":10,"files":[{"root":"/repo","file":"/repo/missing.ts"}],"callNames":["prompt"],"stream":true}"#,
        )
        .expect("streaming batch request should deserialize");

        let mut output = Vec::new();
        write_worker_response(&mut output, request)
            .expect("streaming error should be protocol-level");
        let text = String::from_utf8(output).expect("response should be utf8");
        let lines: Vec<&str> = text.lines().collect();

        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""type":"error""#));
        assert!(lines[0].contains("did not include source text"));
    }

    #[test]
    fn disk_source_reads_must_stay_under_root() {
        let base = env::temp_dir().join(format!(
            "crux-indexer-worker-{}-{}",
            process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("create root tempdir");
        fs::create_dir_all(&outside).expect("create outside tempdir");
        let outside_file = outside.join("escape.ts");
        fs::write(&outside_file, "export const escape = true").expect("write outside source");

        let error = request_source(
            root.to_str().expect("root path"),
            outside_file.to_str().expect("outside path"),
            None,
            true,
        )
        .expect_err("outside source should be rejected");

        assert!(error.contains("escapes project root"));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn streaming_batch_respects_import_qualified_call_interests() {
        let source = [
            "import { defineWorkflow as workflowFactory } from '@acme/workflows';",
            "import { defineWorkflow as otherWorkflowFactory } from '@other/workflows';",
            "const local = defineWorkflow({ id: 'local' });",
            "const acme = workflowFactory({ id: 'acme' });",
            "const other = otherWorkflowFactory({ id: 'other' });",
        ]
        .join("\n");
        let request: WorkerRequest = serde_json::from_value(serde_json::json!({
            "id": 11,
            "files": [{ "root": "/repo", "file": "/repo/src/workflow.ts", "source": source }],
            "callNames": ["defineWorkflow"],
            "callInterests": [{ "name": "defineWorkflow", "importFrom": ["@acme/workflows"] }],
            "stream": true
        }))
        .expect("streaming request should deserialize");

        let mut output = Vec::new();
        write_worker_response(&mut output, request).expect("streaming response should write");
        let text = String::from_utf8(output).expect("response should be utf8");
        let first_line = text.lines().next().expect("record event should exist");
        let event: serde_json::Value =
            serde_json::from_str(first_line).expect("record event should parse");
        let matches = event["record"]["matches"]
            .as_array()
            .expect("record should contain matches");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["variableName"], "acme");
        assert_eq!(matches[0]["callee"]["moduleSpecifier"], "@acme/workflows");
    }

    #[test]
    fn streaming_batch_prunes_declared_config_properties() {
        let source = [
            "import { definePolicy } from '@acme/policy';",
            "const checkAccess = () => workspace.writeFile('audit.log', 'tenant');",
            "export const policy = definePolicy('tenant', {",
            "  id: 'tenant-policy',",
            "  secret: 'drop-me',",
            "  target: agentOne,",
            "  check: checkAccess,",
            "});",
        ]
        .join("\n");
        let request: WorkerRequest = serde_json::from_value(serde_json::json!({
            "id": 12,
            "files": [{ "root": "/repo", "file": "/repo/src/policy.ts", "source": source }],
            "callInterests": [{
                "name": "definePolicy",
                "importFrom": ["@acme/policy"],
                "configArg": 1,
                "properties": ["id"],
                "callbacks": [{ "property": "check", "maxDepth": 1 }],
                "source": "manifest"
            }],
            "stream": true
        }))
        .expect("streaming request should deserialize");

        let mut output = Vec::new();
        write_worker_response(&mut output, request).expect("streaming response should write");
        let text = String::from_utf8(output).expect("response should be utf8");
        let first_line = text.lines().next().expect("record event should exist");
        let event: serde_json::Value =
            serde_json::from_str(first_line).expect("record event should parse");
        let properties = event["record"]["matches"][0]["objectArg"]["properties"]
            .as_array()
            .expect("record should contain sliced object properties")
            .iter()
            .map(|property| property["name"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();

        assert_eq!(properties, vec!["id", "check"]);
    }
}
