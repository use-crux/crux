use std::io::Write;

use serde_json::json;

use crate::protocol::static_compiler::{
    NativeStaticAnalyzeRequest, NativeStaticCompileRequest, NativeStaticFinalizeRequest,
    NativeStaticMethod,
};
use crate::static_compiler::analysis::run::analyze_native_static_facts;
use crate::worker::io::write_json_line;
use crate::worker::static_compiler::handle_finalize;

/// Write a native-only compile as streamed Project Index patch events.
///
/// This path keeps analyze facts in the Rust worker for native-only projects
/// and streams final patch events directly to Go. Extension evidence still uses
/// the separate analyze path because it must execute JavaScript/TypeScript.
pub(crate) fn write_compile_stream<W: Write>(
    stdout: &mut W,
    id: u64,
    request: NativeStaticCompileRequest,
) -> Result<(), String> {
    let analyze_request = NativeStaticAnalyzeRequest {
        protocol_version: request.protocol_version,
        method: NativeStaticMethod::Analyze,
        stream: true,
        identity: request.identity.clone(),
        plan: request.plan,
        files: request.files,
        extension_evidence_interests: None,
    };
    let mut native_facts = request.native_facts;
    native_facts.extend(analyze_native_static_facts(&analyze_request));
    let finalize_request = NativeStaticFinalizeRequest {
        protocol_version: request.protocol_version,
        method: NativeStaticMethod::Finalize,
        stream: true,
        identity: request.identity,
        native_facts,
        extension_facts: request.extension_facts,
        lint_facts: Vec::new(),
        relation_specs: request.relation_specs,
        rule_results: None,
        lint_config: request.lint_config,
        lint_files: request.lint_files,
        emit_builtin_lints: request.emit_builtin_lints,
        patch_phase: None,
        patch_invalidates: None,
        cache: None,
    };
    let mut response = handle_finalize(finalize_request);
    response.method = NativeStaticMethod::Compile;
    for event in response.events.drain(..) {
        write_json_line(
            stdout,
            &json!({
                "id": id,
                "ok": true,
                "type": "event",
                "event": event,
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
