use std::io::Write;

use serde_json::json;

use crate::native_static::pipeline;
use crate::protocol::native_static::NativeStaticFinalizeRequest;
use crate::server::io::write_json_line;

/// Write native static finalization as Project Index patch-event stream chunks.
///
/// The final response carries stage telemetry only. Patch events are emitted as
/// individual stream events so the Go collector can validate and apply
/// backpressure without waiting for one large response array.
pub(crate) fn write_finalize_stream<W: Write>(
    stdout: &mut W,
    id: u64,
    request: NativeStaticFinalizeRequest,
) -> Result<(), String> {
    let mut response = pipeline::finalize(request);
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
