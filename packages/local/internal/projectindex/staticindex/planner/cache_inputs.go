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
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core","version":"2","digest":"ab5dfe19d84ef61ce01474dff6d463bc5b8846ecca8bf4e9d1d3a580f458f606"}`,
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
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"cd296cc9b333195f6c74f7e9cda75549c35b667800328f9f9300bdef03edaf82"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"764c8eebf305ce14723625984af56fd631077c2bca89c34233586e416434f517"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.133.0+crux_native_group3.6"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
