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
		`{"kind":"extension","name":"@use-crux/indexer/crux-core-media","version":"1"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-media","version":"1","digest":"75d691347ead0e54768cf76ac52b510733db5bb02c5efb70ba2758a538fe83f5"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"ingest.source"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"media.operation"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"457ae166c958a1063ceb6fe2632a8a8497eb59a4dd2298a2df11dba2f1ba5681"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"4a42c1822b901c3c1de519b7c4bc589fd4323e1ce6570304717f0670371a06a9"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"4cba00d493051c155dc47bb8fe65e6946771484b30b1edf18cf181e573515001"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.139.0+crux_native_group3.8"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
