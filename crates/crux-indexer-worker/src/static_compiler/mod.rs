pub(crate) mod analysis {
    pub(crate) mod parse;
    pub(crate) mod run;
    #[cfg(test)]
    pub(crate) mod tests {
        pub(crate) mod model;
        pub(crate) mod source_refs;
        pub(crate) mod tree;

        pub(crate) use self::model::request_with_root_file_and_call_names;
    }
}

pub(crate) mod contracts {
    pub(crate) mod input;
    pub(crate) mod schema;
    #[cfg(test)]
    pub(crate) mod tests;
}

pub(crate) mod core {
    pub(crate) mod definition_merge;
    pub(crate) mod evidence;
    pub(crate) mod facts;
    pub(crate) mod scoped_definitions;
}

pub(crate) mod finalizer {
    pub(crate) mod events;
    pub(crate) mod lint_model;
    pub(crate) mod run;
    #[cfg(test)]
    pub(crate) mod tests {
        pub(crate) mod events;
        pub(crate) mod lint;
        pub(crate) mod model;
    }
}

pub(crate) mod lint {
    pub(crate) mod builder;
    pub(crate) mod contracts;
    pub(crate) mod emit;
    pub(crate) mod filter;
    pub(crate) mod findings;
    pub(crate) mod helpers;
    pub(crate) mod injection {
        pub(crate) mod entries;
        pub(crate) mod evidence;
        pub(crate) mod evidence_data;
        pub(crate) mod inputs;
        pub(crate) mod model;
        pub(crate) mod model_helpers;
        pub(crate) mod rules;
    }
    pub(crate) mod propagation;
    pub(crate) mod rules {
        pub(crate) mod core;
        pub(crate) mod definition_tail;
        pub(crate) mod filter;
        pub(crate) mod relation;
        pub(crate) mod routing;
    }
}

pub(crate) mod protocol {
    #[cfg(test)]
    pub(crate) mod tests;
}

pub(crate) mod read {
    pub(crate) mod helpers;
    pub(crate) mod injection;
    pub(crate) mod model;
    pub(crate) mod routing;
}

pub(crate) mod relation {
    pub(crate) mod fallback;
    pub(crate) mod gaps;
    pub(crate) mod model;
    pub(crate) mod policy;
    pub(crate) mod report;
    #[cfg(test)]
    pub(crate) mod tests {
        pub(crate) mod alias;
        pub(crate) mod fallback;
        pub(crate) mod gaps;
        pub(crate) mod model;
        pub(crate) mod policy;
        pub(crate) mod refs;

        pub(crate) use self::model::{definition, relation_ref};
    }
}

pub(crate) mod source {
    pub(crate) mod groups;
    pub(crate) mod model;
    #[cfg(test)]
    pub(crate) mod tests;
    pub(crate) mod tree_paths;
}
