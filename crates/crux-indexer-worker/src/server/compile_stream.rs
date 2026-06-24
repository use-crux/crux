use std::io::Write;

use serde_json::json;

use crate::native_static::pipeline;
use crate::protocol::native_static::NativeStaticCompileRequest;
use crate::server::io::write_json_line;

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
    let mut response = pipeline::compile(request);
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
