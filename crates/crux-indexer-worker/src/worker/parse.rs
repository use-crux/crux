use serde_json::Value;

use crate::protocol::static_compiler::{
    NATIVE_STATIC_ANALYZE_METHOD, NATIVE_STATIC_COMPILE_METHOD, NATIVE_STATIC_FINALIZE_METHOD,
    NATIVE_STATIC_PREPARE_METHOD, NATIVE_STATIC_PROTOCOL_VERSION, NativeStaticAnalyzeRequest,
    NativeStaticCompileRequest, NativeStaticFinalizeRequest, NativeStaticPrepareRequest,
};
use crate::worker::static_compiler::NativeStaticWorkerRequest;

/// Return whether a JSON value looks like an internal native static request.
pub(crate) fn has_worker_method(value: &Value) -> bool {
    value
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method.starts_with("nativeStatic"))
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
        NATIVE_STATIC_PREPARE_METHOD => {
            let request: NativeStaticPrepareRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "nativeStaticPrepare",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            NativeStaticWorkerRequest::Prepare(id, request)
        }
        NATIVE_STATIC_ANALYZE_METHOD => {
            let request: NativeStaticAnalyzeRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "nativeStaticAnalyze",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            if !request.stream {
                return Err("nativeStaticAnalyze requires stream: true".to_string());
            }
            NativeStaticWorkerRequest::Analyze(id, request)
        }
        NATIVE_STATIC_FINALIZE_METHOD => {
            let request: NativeStaticFinalizeRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "nativeStaticFinalize",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            NativeStaticWorkerRequest::Finalize(id, request)
        }
        NATIVE_STATIC_COMPILE_METHOD => {
            let request: NativeStaticCompileRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "nativeStaticCompile",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            if !request.stream {
                return Err("nativeStaticCompile requires stream: true".to_string());
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
    if protocol_version != NATIVE_STATIC_PROTOCOL_VERSION {
        return Err(format!(
            "native static {stage} request uses unsupported protocol version {protocol_version}"
        ));
    }
    if identity_protocol_version != NATIVE_STATIC_PROTOCOL_VERSION {
        return Err(format!(
            "native static {stage} identity uses unsupported protocol version {identity_protocol_version}"
        ));
    }
    Ok(())
}
