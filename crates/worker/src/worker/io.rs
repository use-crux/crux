use std::io::Write;

use serde::Serialize;

pub(crate) fn write_json_line<W: Write, T: Serialize>(
    stdout: &mut W,
    value: &T,
) -> Result<(), String> {
    serde_json::to_writer(&mut *stdout, value).map_err(|error| error.to_string())?;
    stdout.write_all(b"\n").map_err(|error| error.to_string())?;
    stdout.flush().map_err(|error| error.to_string())
}
