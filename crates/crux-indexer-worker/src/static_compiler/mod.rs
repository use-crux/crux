pub(crate) mod analysis {
    pub(crate) mod parse;
    pub(crate) mod run;
    #[cfg(test)]
    pub(crate) mod source_ref_tests;
    #[cfg(test)]
    pub(crate) mod tests;
    #[cfg(test)]
    pub(crate) mod tree_tests;
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
    #[cfg(test)]
    pub(crate) mod events_tests;
    pub(crate) mod lint_model;
    #[cfg(test)]
    pub(crate) mod lint_tests;
    pub(crate) mod run;
    #[cfg(test)]
    pub(crate) mod tests;
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
    #[cfg(test)]
    pub(crate) mod alias_tests;
    pub(crate) mod fallback;
    #[cfg(test)]
    pub(crate) mod fallback_tests;
    #[cfg(test)]
    pub(crate) mod gap_tests;
    pub(crate) mod gaps;
    pub(crate) mod model;
    pub(crate) mod policy;
    #[cfg(test)]
    pub(crate) mod policy_tests;
    #[cfg(test)]
    pub(crate) mod ref_tests;
    pub(crate) mod report;
    #[cfg(test)]
    pub(crate) mod tests;
}

pub(crate) mod source {
    pub(crate) mod groups;
    pub(crate) mod model;
    #[cfg(test)]
    pub(crate) mod tests;
    pub(crate) mod tree_paths;
}
