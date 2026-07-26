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
		`{"kind":"extension","name":"@use-crux/indexer/crux-core-media","version":"1"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-media","version":"1","digest":"a08d4797cd75809ae55532ea453a961e8d3e5a740097a62249d51c38bfd20a9e"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"ingest.source"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"media.operation"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"43f3a919cc2aa07bd82d67bb0252df061198dd962e2badf9170b66a0053acdc2"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"1d926a5829362c8604833d257fc1210f15a3d71f139ebd286e695aa90be6ce5d"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"ae0c9ede28482436294b1293ae7dfc6a1cebab57bde274fedb2b9a31eaa07e09"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.139.0+crux_native_group3.9"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
