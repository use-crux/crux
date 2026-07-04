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
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core","version":"2","digest":"adb43ff085acd533f2eac3f9a024a6268592392b9814a6105af9701a531da70a"}`,
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
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"runtime.task"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"safety"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"scorer"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"skill-registry"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"storage"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"tool"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"workspace"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"593bce811915c4645c37c794421dce255bd56de018931630c0eac68509e0d28c"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"6fa514144e5dfe0beb426e5fc063671c7158947aacdadb7a3ba797ce34148d1c"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"cde671893260dc8c0abb26b6afceb6f6a92f64a0d193319a5207e154dc4a6b06"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.133.0+crux_native_group3.6"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
