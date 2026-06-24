use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::extractors::static_syntax::parse_static_syntax_record;
use crate::protocol::native_static::NativeStaticAnalyzeRequest;
use crate::protocol::{
    ParseRequest, StaticCalleeRecord, StaticSourceMatch, StaticSyntaxCallInterest,
    StaticSyntaxConstructorInterest,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionEvidenceInterests {
    #[serde(default)]
    extractors: Vec<ExtensionEvidenceExtractorInterest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionEvidenceExtractorInterest {
    extension: ExtensionIdentity,
    name: String,
    #[serde(default)]
    calls: Vec<StaticSyntaxCallInterest>,
    #[serde(default)]
    constructors: Vec<StaticSyntaxConstructorInterest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionIdentity {
    name: String,
    version: String,
}

pub(crate) fn extension_evidence_jobs(request: &NativeStaticAnalyzeRequest) -> Vec<Value> {
    let Some(raw_interests) = request.extension_evidence_interests.as_ref() else {
        return Vec::new();
    };
    let Ok(interests) = serde_json::from_value::<ExtensionEvidenceInterests>(raw_interests.clone())
    else {
        return Vec::new();
    };
    if interests.extractors.is_empty() {
        return Vec::new();
    }

    let call_interests = interests
        .extractors
        .iter()
        .flat_map(|extractor| extractor.calls.iter().cloned())
        .collect::<Vec<_>>();
    let constructor_interests = interests
        .extractors
        .iter()
        .flat_map(|extractor| extractor.constructors.iter().cloned())
        .collect::<Vec<_>>();
    let mut jobs_by_file = request
        .files
        .par_iter()
        .enumerate()
        .filter_map(|file| {
            let (index, file) = file;
            let source = file.source_text.clone()?;
            let record = parse_static_syntax_record(ParseRequest {
                root: request.plan.root.clone(),
                file: file.file.clone(),
                source,
                call_names: Vec::new(),
                call_interests: call_interests.clone(),
                constructor_names: Vec::new(),
                constructor_interests: constructor_interests.clone(),
                prune_native_fact_call_names: Vec::new(),
            })
            .ok()?;
            Some((
                index,
                record
                    .matches
                    .iter()
                    .enumerate()
                    .flat_map(|(index, source_match)| {
                        jobs_for_match(
                            &interests.extractors,
                            &file.source_hash,
                            index,
                            source_match,
                        )
                        .into_iter()
                        .map(|job| {
                            json!({
                                "id": job.id,
                                "extractor": {
                                    "extension": {
                                        "name": job.extractor.extension.name,
                                        "version": job.extractor.extension.version
                                    },
                                    "name": job.extractor.name
                                },
                                "file": file.file,
                                "sourceHash": file.source_hash,
                                "evidence": source_match,
                                "imports": &record.imports,
                                "localInitializers": &record.local_initializers,
                                "frontend": &record.frontend
                            })
                        })
                        .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>(),
            ))
        })
        .collect::<Vec<_>>();
    jobs_by_file.sort_by_key(|(index, _)| *index);
    jobs_by_file
        .into_iter()
        .flat_map(|(_, jobs)| jobs)
        .collect()
}

struct EvidenceJob {
    id: String,
    extractor: ExtensionEvidenceExtractorInterest,
}

fn jobs_for_match(
    extractors: &[ExtensionEvidenceExtractorInterest],
    source_hash: &str,
    match_index: usize,
    source_match: &StaticSourceMatch,
) -> Vec<EvidenceJob> {
    extractors
        .iter()
        .filter(|extractor| extractor_matches_source(extractor, source_match))
        .map(|extractor| EvidenceJob {
            id: format!(
                "extension-evidence:{source_hash}:{match_index}:{}:{}",
                extractor.extension.name, extractor.name
            ),
            extractor: extractor.clone(),
        })
        .collect::<Vec<_>>()
}

fn extractor_matches_source(
    extractor: &ExtensionEvidenceExtractorInterest,
    source_match: &StaticSourceMatch,
) -> bool {
    match source_match {
        StaticSourceMatch::Call { callee, .. } => extractor
            .calls
            .iter()
            .any(|interest| call_interest_matches(interest, callee)),
        StaticSourceMatch::New { callee, .. } => extractor
            .constructors
            .iter()
            .any(|interest| constructor_interest_matches(interest, callee)),
        StaticSourceMatch::Object { .. } => false,
    }
}

fn call_interest_matches(interest: &StaticSyntaxCallInterest, callee: &StaticCalleeRecord) -> bool {
    callee_name_matches(&interest.name, &interest.import_from, callee)
}

fn constructor_interest_matches(
    interest: &StaticSyntaxConstructorInterest,
    callee: &StaticCalleeRecord,
) -> bool {
    callee_name_matches(&interest.name, &interest.import_from, callee)
}

fn callee_name_matches(name: &str, import_from: &[String], callee: &StaticCalleeRecord) -> bool {
    let authored_name = if import_from.is_empty() {
        &callee.name
    } else {
        callee.imported_name.as_ref().unwrap_or(&callee.name)
    };
    if name != authored_name
        && callee
            .local_name
            .as_ref()
            .is_none_or(|local_name| name != local_name)
    {
        return false;
    }
    import_from.is_empty()
        || callee
            .module_specifier
            .as_ref()
            .is_some_and(|module_specifier| import_from.contains(module_specifier))
}
