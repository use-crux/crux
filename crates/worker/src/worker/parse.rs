use serde_json::Value;

use crate::protocol::native_static::{
    NativeStaticAnalyzeRequest, NativeStaticCompileRequest, NativeStaticFinalizeRequest,
    NativeStaticPrepareRequest, STATIC_INDEX_ANALYZE_METHOD, STATIC_INDEX_COMPILE_METHOD,
    STATIC_INDEX_FINALIZE_METHOD, STATIC_INDEX_PREPARE_METHOD, STATIC_INDEX_PROTOCOL_VERSION,
};
use crate::worker::native_static::NativeStaticWorkerRequest;

/// Return whether a JSON value looks like an internal Static Index request.
pub(crate) fn has_worker_method(value: &Value) -> bool {
    value
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method.starts_with("staticIndex"))
}

/// Parse the method-based native static branch after syntax-record parsing fails.
pub(crate) fn parse_native_static_worker_request(
    value: Value,
) -> Result<NativeStaticWorkerRequest, String> {
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "native static worker request is missing method".to_string())?;
    let id = value.get("id").and_then(Value::as_u64).ok_or_else(|| {
        format!("native static worker request for {method} is missing numeric id")
    })?;
    let request = match method {
        STATIC_INDEX_PREPARE_METHOD => {
            let request: NativeStaticPrepareRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexPrepare",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            NativeStaticWorkerRequest::Prepare(id, request)
        }
        STATIC_INDEX_ANALYZE_METHOD => {
            let request: NativeStaticAnalyzeRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexAnalyze",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            if !request.stream {
                return Err("staticIndexAnalyze requires stream: true".to_string());
            }
            NativeStaticWorkerRequest::Analyze(id, request)
        }
        STATIC_INDEX_FINALIZE_METHOD => {
            let request: NativeStaticFinalizeRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexFinalize",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            NativeStaticWorkerRequest::Finalize(id, request)
        }
        STATIC_INDEX_COMPILE_METHOD => {
            let request: NativeStaticCompileRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexCompile",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            if !request.stream {
                return Err("staticIndexCompile requires stream: true".to_string());
            }
            NativeStaticWorkerRequest::Compile(id, request)
        }
        _ => return Err(format!("unknown native static worker method {method}")),
    };
    Ok(request)
}

fn parse_stage_value<T>(value: Value) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn validate_protocol_versions(
    stage: &str,
    protocol_version: u8,
    identity_protocol_version: u8,
) -> Result<(), String> {
    if protocol_version != STATIC_INDEX_PROTOCOL_VERSION {
        return Err(format!(
            "native static {stage} request uses unsupported protocol version {protocol_version}"
        ));
    }
    if identity_protocol_version != STATIC_INDEX_PROTOCOL_VERSION {
        return Err(format!(
            "native static {stage} identity uses unsupported protocol version {identity_protocol_version}"
        ));
    }
    Ok(())
}
