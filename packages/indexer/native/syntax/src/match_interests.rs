use std::collections::{HashMap, HashSet};

use crate::protocol::{
    StaticCalleeRecord, StaticSyntaxCallInterest, StaticSyntaxConstructorInterest,
};

#[derive(Debug, Clone)]
pub(crate) struct CalleeMatcher {
    names: HashSet<String>,
    broad_names: HashSet<String>,
    imported_names: HashMap<String, HashSet<String>>,
    interests: Vec<NormalizedInterest>,
    allow_all: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct EvidenceSlice {
    pub(crate) config_arg: Option<usize>,
    pub(crate) properties: HashSet<String>,
}

impl CalleeMatcher {
    pub(crate) fn for_calls(
        names: Vec<String>,
        interests: Vec<StaticSyntaxCallInterest>,
    ) -> Self {
        Self::new(
            names,
            interests
                .into_iter()
                .map(|interest| NormalizedInterest {
                    name: interest.name,
                    import_from: interest.import_from,
                    config_arg: interest.config_arg,
                    properties: interest.properties,
                    callbacks: interest
                        .callbacks
                        .into_iter()
                        .map(|callback| {
                            let _max_depth = callback.max_depth;
                            callback.property
                        })
                        .collect(),
                    source: interest.source,
                })
                .collect(),
            Vec::new(),
        )
    }

    pub(crate) fn for_constructors(
        names: Vec<String>,
        interests: Vec<StaticSyntaxConstructorInterest>,
        default_names: Vec<String>,
    ) -> Self {
        Self::new(
            names,
            interests
                .into_iter()
                .map(|interest| NormalizedInterest {
                    name: interest.name,
                    import_from: interest.import_from,
                    config_arg: interest.config_arg,
                    properties: interest.properties,
                    callbacks: interest
                        .callbacks
                        .into_iter()
                        .map(|callback| {
                            let _max_depth = callback.max_depth;
                            callback.property
                        })
                        .collect(),
                    source: interest.source,
                })
                .collect(),
            default_names,
        )
    }

    pub(crate) fn names(&self) -> &HashSet<String> {
        &self.names
    }

    pub(crate) fn allows(&self, callee: &StaticCalleeRecord) -> bool {
        if self.allow_all {
            return true;
        }
        if self.broad_names.contains(&callee.name)
            || callee
                .local_name
                .as_ref()
                .is_some_and(|local_name| self.broad_names.contains(local_name))
        {
            return true;
        }
        let import_name = callee.imported_name.as_ref().unwrap_or(&callee.name);
        callee
            .module_specifier
            .as_ref()
            .and_then(|module_specifier| {
                self.imported_names
                    .get(import_name)
                    .map(|sources| sources.contains(module_specifier))
            })
            .unwrap_or(false)
    }

    pub(crate) fn evidence_for(&self, callee: &StaticCalleeRecord) -> Option<EvidenceSlice> {
        if self.allow_all {
            return None;
        }
        let matching = self
            .interests
            .iter()
            .filter(|interest| interest.matches_callee(callee))
            .collect::<Vec<_>>();
        if matching.is_empty()
            || matching
                .iter()
                .any(|interest| interest.source.as_deref() != Some("manifest"))
        {
            return None;
        }
        let mut properties = HashSet::new();
        let mut config_arg = None;
        for interest in matching {
            if let Some(index) = interest.config_arg {
                config_arg = Some(config_arg.map_or(index, |previous: usize| previous.min(index)));
            }
            properties.extend(interest.properties.iter().cloned());
            properties.extend(interest.callbacks.iter().cloned());
        }
        Some(EvidenceSlice {
            config_arg,
            properties,
        })
    }

    fn new(
        names: Vec<String>,
        interests: Vec<NormalizedInterest>,
        default_names: Vec<String>,
    ) -> Self {
        let interest_names = interests
            .iter()
            .map(|interest| interest.name.clone())
            .collect::<HashSet<_>>();
        let mut broad_names = HashSet::new();
        let mut imported_names: HashMap<String, HashSet<String>> = HashMap::new();

        for interest in interests.iter() {
            if interest.import_from.is_empty() {
                broad_names.insert(interest.name.clone());
            } else {
                imported_names
                    .entry(interest.name.clone())
                    .or_default()
                    .extend(interest.import_from.iter().cloned());
            }
        }

        for name in names.iter().chain(default_names.iter()) {
            if !interest_names.contains(name) {
                broad_names.insert(name.clone());
            }
        }

        let mut all_names = broad_names.clone();
        all_names.extend(imported_names.keys().cloned());
        let allow_all = all_names.is_empty() && interests.is_empty() && names.is_empty();

        Self {
            names: all_names,
            broad_names,
            imported_names,
            interests,
            allow_all,
        }
    }
}

#[derive(Debug, Clone)]
struct NormalizedInterest {
    name: String,
    import_from: Vec<String>,
    config_arg: Option<usize>,
    properties: Vec<String>,
    callbacks: Vec<String>,
    source: Option<String>,
}

impl NormalizedInterest {
    fn matches_callee(&self, callee: &StaticCalleeRecord) -> bool {
        let authored_name = if self.import_from.is_empty() {
            &callee.name
        } else {
            callee.imported_name.as_ref().unwrap_or(&callee.name)
        };
        if self.name != *authored_name
            && callee
                .local_name
                .as_ref()
                .is_none_or(|local_name| self.name != *local_name)
        {
            return false;
        }
        if self.import_from.is_empty() {
            return true;
        }
        callee
            .module_specifier
            .as_ref()
            .is_some_and(|module_specifier| self.import_from.contains(module_specifier))
    }
}
