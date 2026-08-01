package planner

import "encoding/json"

func DefaultCacheCompilerInputs() []json.RawMessage {
	// Keep isolated: this mirrors TypeScript staticExtractionIdentity for the
	// first-party no-extension Rust/Oxc Static Index plan.
	inputs := []string{
		`{"kind":"compiler-profile","name":"@use-crux/indexer/crux-core-profile","version":"4"}`,
		`{"kind":"compiler-projection","name":"deferred-work-containment","version":"2","phase":"resolve"}`,
		`{"kind":"compiler-projection","name":"effect-definition-facts","version":"2","phase":"extract"}`,
		`{"kind":"compiler-projection","name":"prompt-context-tree-paths","version":"1","phase":"resolve"}`,
		`{"kind":"compiler-projection","name":"runtime-prepare-use-entries","version":"1","phase":"parse"}`,
		`{"kind":"compiler-projection","name":"safety-strategy-facts","version":"3","phase":"extract"}`,
		`{"kind":"compiler-projection","name":"source-ref-projection","version":"1","phase":"parse"}`,
		`{"kind":"extension","name":"@use-crux/indexer/crux-core","version":"2"}`,
		`{"kind":"extension","name":"@use-crux/indexer/crux-core-mcp","version":"1"}`,
		`{"kind":"extension","name":"@use-crux/indexer/crux-core-media","version":"4"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core","version":"2","digest":"0c58a9ceec966f4bab0980d03580c617756ec593eb112084f056be186487a499"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-mcp","version":"1","digest":"823fcfe1464c7ace9ec4276a53f0e4178fa76dd51ecbd229979c60f51c1a21f1"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-media","version":"4","digest":"653652a71ff30dd66aabcf0f616ce075b37344d800a158f5d4356b5968cb94ca"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"embedding"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"embedding.call"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"evidence.record"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"knowledge"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"rag.indexer"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"thread"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-mcp","name":"mcp.server"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"ingest.source"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"media.operation"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"3062bd166bf511056850b5cdd2c8cb306c424d73700ac881f614562ffc363d79"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"dd4257ce588c6f8af4289cee2826a20563b0fb978d8c6be0bfffe44ba116e641"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"181dfdd324ba7b20442ab5c8ac8cbdb47065a3f1ee9d86bdb7872c11cffa3f93"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.139.0+crux_native_group3.12"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
