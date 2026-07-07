use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use rayon::prelude::*;

use crux_indexer_static_compiler::compat::parse_static_syntax_record;

use crate::protocol::process::BatchWorkerFileRequest;
use crate::protocol::{
    self, BatchWorkerRequest, ParseRequest, SingleWorkerRequest, WorkerRequest, WorkerResponse,
    WorkerStreamEvent,
};
use crate::worker::io::write_json_line;

pub(crate) fn write_response<W: Write>(
    stdout: &mut W,
    request: WorkerRequest,
) -> Result<(), String> {
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
    parse_static_syntax_record(input)
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
    parse_static_syntax_record(ParseRequest {
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

    use crate::protocol::WorkerRequest;

    use super::{request_source, write_response};

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
        write_response(&mut output, request).expect("streaming response should write");
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
        write_response(&mut output, request).expect("streaming error should be protocol-level");
        let text = String::from_utf8(output).expect("response should be utf8");
        let lines: Vec<&str> = text.lines().collect();

        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""type":"error""#));
        assert!(lines[0].contains("did not include source text"));
    }

    #[test]
    fn disk_source_reads_must_stay_under_root() {
        let base = env::temp_dir().join(format!(
            "crux-static-index-worker-{}-{}",
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
        write_response(&mut output, request).expect("streaming response should write");
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
    fn streaming_batch_marks_type_only_import_records() {
        let source = [
            "import type { TypeOnly } from './types';",
            "import { value, type MixedType } from './value';",
            "export const writer = value({ id: 'writer' });",
        ]
        .join("\n");
        let request: WorkerRequest = serde_json::from_value(serde_json::json!({
            "id": 12,
            "files": [{ "root": "/repo", "file": "/repo/src/writer.ts", "source": source }],
            "callNames": ["value"],
            "stream": true
        }))
        .expect("streaming request should deserialize");

        let mut output = Vec::new();
        write_response(&mut output, request).expect("streaming response should write");
        let text = String::from_utf8(output).expect("response should be utf8");
        let first_line = text.lines().next().expect("record event should exist");
        let event: serde_json::Value =
            serde_json::from_str(first_line).expect("record event should parse");
        let imports = event["record"]["imports"]
            .as_array()
            .expect("record should contain imports");

        assert_eq!(imports.len(), 3);
        assert_eq!(imports[0]["localName"], "TypeOnly");
        assert_eq!(imports[0]["importKind"], "type");
        assert_eq!(imports[1]["localName"], "value");
        assert_eq!(imports[1]["importKind"], "value");
        assert_eq!(imports[1]["moduleSpecifier"], "./value");
        assert_eq!(imports[2]["localName"], "MixedType");
        assert_eq!(imports[2]["importKind"], "type");
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
        write_response(&mut output, request).expect("streaming response should write");
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
