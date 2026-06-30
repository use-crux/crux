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
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core","version":"2","digest":"c7c2234898b2e15be8055b214140a4f6e77a7087c11e15a272e224403eaaef63"}`,
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
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"storage"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"tool"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"workspace"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"559c42ef7b97804846278cb42b84eff15dfda9784f4be1cd172ec44dad0f9dfb"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"a6c6f3eb75269d7ee071eec64f069d4882a4dea07200477b65360bcc2ae8ddc6"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"2469222bba7da6017ff090ab5a434511ff0d5adbb14970f5b420713304a0677c"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.133.0+crux_native_group3.6"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
