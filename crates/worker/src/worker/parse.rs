use serde_json::Value;

use crate::protocol::completion::{COMPLETION_QUERY_METHOD, CompletionWorkerRequest};

use crate::protocol::static_index::{
    STATIC_INDEX_ANALYZE_METHOD, STATIC_INDEX_COMPILE_METHOD, STATIC_INDEX_FINALIZE_METHOD,
    STATIC_INDEX_PREPARE_METHOD, STATIC_INDEX_PROTOCOL_VERSION, StaticIndexAnalyzeRequest,
    StaticIndexCompileRequest, StaticIndexFinalizeRequest, StaticIndexPrepareRequest,
};
use crate::worker::static_index::StaticIndexWorkerRequest;

/// Return whether a JSON value is a completion query.
pub(crate) fn has_completion_method(value: &Value) -> bool {
    value.get("method").and_then(Value::as_str) == Some(COMPLETION_QUERY_METHOD)
}

/// Parses the private completion branch of the persistent worker protocol.
pub(crate) fn parse_completion_worker_request(
    value: Value,
) -> Result<CompletionWorkerRequest, String> {
    let request: CompletionWorkerRequest =
        serde_json::from_value(value).map_err(|error| error.to_string())?;
    if request.method != COMPLETION_QUERY_METHOD {
        return Err(format!(
            "unknown completion worker method {}",
            request.method
        ));
    }
    Ok(request)
}

/// Return whether a JSON value looks like an internal Static Index request.
pub(crate) fn has_worker_method(value: &Value) -> bool {
    value
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method.starts_with("staticIndex"))
}

/// Parse the method-based Static Index branch after syntax-record parsing fails.
pub(crate) fn parse_static_index_worker_request(
    value: Value,
) -> Result<StaticIndexWorkerRequest, String> {
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "Static Index worker request is missing method".to_string())?;
    let id = value
        .get("id")
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("Static Index worker request for {method} is missing numeric id"))?;
    let request = match method {
        STATIC_INDEX_PREPARE_METHOD => {
            let request: StaticIndexPrepareRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexPrepare",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            StaticIndexWorkerRequest::Prepare(id, request)
        }
        STATIC_INDEX_ANALYZE_METHOD => {
            let request: StaticIndexAnalyzeRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexAnalyze",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            if !request.stream {
                return Err("staticIndexAnalyze requires stream: true".to_string());
            }
            StaticIndexWorkerRequest::Analyze(id, request)
        }
        STATIC_INDEX_FINALIZE_METHOD => {
            let request: StaticIndexFinalizeRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexFinalize",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            StaticIndexWorkerRequest::Finalize(id, request)
        }
        STATIC_INDEX_COMPILE_METHOD => {
            let request: StaticIndexCompileRequest = parse_stage_value(value)?;
            validate_protocol_versions(
                "staticIndexCompile",
                request.protocol_version,
                request.identity.protocol_version,
            )?;
            if !request.stream {
                return Err("staticIndexCompile requires stream: true".to_string());
            }
            StaticIndexWorkerRequest::Compile(id, request)
        }
        _ => return Err(format!("unknown Static Index worker method {method}")),
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
            "Static Index {stage} request uses unsupported protocol version {protocol_version}"
        ));
    }
    if identity_protocol_version != STATIC_INDEX_PROTOCOL_VERSION {
        return Err(format!(
            "Static Index {stage} identity uses unsupported protocol version {identity_protocol_version}"
        ));
    }
    Ok(())
}
