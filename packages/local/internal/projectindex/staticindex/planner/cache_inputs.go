package planner

import "encoding/json"

func DefaultCacheCompilerInputs() []json.RawMessage {
	// Keep isolated: this mirrors TypeScript staticExtractionIdentity for the
	// first-party no-extension Rust/Oxc Static Index plan.
	inputs := []string{
		`{"kind":"compiler-profile","name":"@use-crux/indexer/crux-core-profile","version":"1"}`,
		`{"kind":"compiler-projection","name":"prompt-context-tree-paths","version":"1","phase":"resolve"}`,
		`{"kind":"compiler-projection","name":"runtime-prepare-use-entries","version":"1","phase":"parse"}`,
		`{"kind":"compiler-projection","name":"source-ref-projection","version":"1","phase":"parse"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core","version":"2","digest":"9c3b36a0826e4861a68247126a241017715048d9fef28b6649808f17ace3ba71"}`,
		`{"kind":"extension","name":"@use-crux/indexer/crux-core","version":"2"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"agent"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"blackboard"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"composition"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"context"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"eval"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"flow"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"injectable"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"memory"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"prompt"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"rag.retriever"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"registry-skill"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"routing"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"safety"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"scorer"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"skill-registry"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"tool"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"workspace"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"03e0df54ff51a42158cd99f2c8a38e14b82f57f779b4e7c79710e6a86254bff5"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"0aa11aad16e45c4064273c1e406633efed30801f98f1e2f609c4191ecf21f7ed"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"56da88dcef8a7fd7805bacf329632f17cd43d46d792216fe5522e2550f60b2a2"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.133.0+crux_native_group3.5"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
