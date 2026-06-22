use serde::Deserialize;

use crate::protocol::{
    StaticSyntaxCallInterest, StaticSyntaxConstructorInterest, StaticSyntaxFileRecord,
};

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum WorkerRequest {
    Batch(BatchWorkerRequest),
    Single(SingleWorkerRequest),
}

impl WorkerRequest {
    pub fn id(&self) -> u64 {
        match self {
            WorkerRequest::Batch(request) => request.id,
            WorkerRequest::Single(request) => request.id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleWorkerRequest {
    pub id: u64,
    pub root: String,
    pub file: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub read_source_from_disk: bool,
    #[serde(default)]
    pub call_names: Vec<String>,
    #[serde(default)]
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    #[serde(default)]
    pub constructor_names: Vec<String>,
    #[serde(default)]
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    #[serde(default)]
    pub prune_native_fact_call_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchWorkerRequest {
    pub id: u64,
    pub files: Vec<BatchWorkerFileRequest>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub call_names: Vec<String>,
    #[serde(default)]
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    #[serde(default)]
    pub constructor_names: Vec<String>,
    #[serde(default)]
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    #[serde(default)]
    pub prune_native_fact_call_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchWorkerFileRequest {
    pub root: String,
    pub file: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub read_source_from_disk: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<StaticSyntaxFileRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub records: Option<Vec<StaticSyntaxFileRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl WorkerResponse {
    pub fn ok(id: u64, record: StaticSyntaxFileRecord) -> Self {
        Self {
            id,
            ok: true,
            record: Some(record),
            records: None,
            error: None,
        }
    }

    pub fn ok_batch(id: u64, records: Vec<StaticSyntaxFileRecord>) -> Self {
        Self {
            id,
            ok: true,
            record: None,
            records: Some(records),
            error: None,
        }
    }

    pub fn error(id: u64, error: String) -> Self {
        Self {
            id,
            ok: false,
            record: None,
            records: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStreamEvent<'a> {
    pub id: u64,
    #[serde(rename = "type")]
    pub event_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<&'a StaticSyntaxFileRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<'a> WorkerStreamEvent<'a> {
    pub fn record(id: u64, index: usize, record: &'a StaticSyntaxFileRecord) -> Self {
        Self {
            id,
            event_type: "record",
            index: Some(index),
            count: None,
            record: Some(record),
            error: None,
        }
    }

    pub fn done(id: u64, count: usize) -> Self {
        Self {
            id,
            event_type: "done",
            index: None,
            count: Some(count),
            record: None,
            error: None,
        }
    }

    pub fn error(id: u64, error: String) -> Self {
        Self {
            id,
            event_type: "error",
            index: None,
            count: None,
            record: None,
            error: Some(error),
        }
    }
}
