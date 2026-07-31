package planner

import "encoding/json"

func DefaultCacheCompilerInputs() []json.RawMessage {
	// Keep isolated: this mirrors TypeScript staticExtractionIdentity for the
	// first-party no-extension Rust/Oxc Static Index plan.
	inputs := []string{
		`{"kind":"compiler-profile","name":"@use-crux/indexer/crux-core-profile","version":"1"}`,
		`{"kind":"compiler-projection","name":"prompt-context-tree-paths","version":"1","phase":"resolve"}`,
		`{"kind":"compiler-projection","name":"runtime-prepare-use-entries","version":"1","phase":"parse"}`,
		`{"kind":"compiler-projection","name":"safety-strategy-facts","version":"2","phase":"extract"}`,
		`{"kind":"compiler-projection","name":"source-ref-projection","version":"1","phase":"parse"}`,
		`{"kind":"extension","name":"@use-crux/indexer/crux-core-media","version":"4"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-media","version":"4","digest":"653652a71ff30dd66aabcf0f616ce075b37344d800a158f5d4356b5968cb94ca"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"ingest.source"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"media.operation"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"b94c4aa281bba20d03448e7e1a3f718d6a27409f53703ac3b78e2a64ce00501a"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"dd4257ce588c6f8af4289cee2826a20563b0fb978d8c6be0bfffe44ba116e641"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"a989564325231546f5ebeaeb3599f733d62ef7a5d271b1e15dfa1dcbd8fb4c10"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.139.0+crux_native_group3.11"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
