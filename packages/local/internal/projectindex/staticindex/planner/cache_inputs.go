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
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core","version":"2","digest":"7db1b1f5a6c8eee57102a8d260d2ce505768ed5557cb641ae4fb7daf84a486f6"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-mcp","version":"1","digest":"823fcfe1464c7ace9ec4276a53f0e4178fa76dd51ecbd229979c60f51c1a21f1"}`,
		`{"kind":"extension-manifest","name":"@use-crux/indexer/crux-core-media","version":"4","digest":"653652a71ff30dd66aabcf0f616ce075b37344d800a158f5d4356b5968cb94ca"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"embedding"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"embedding.call"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"evidence.record"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"knowledge"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"rag.indexer"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"session"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal.provider"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal.transport"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal.transport.polling"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal.transport.stream"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal.transport.sse"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"signal.transportBinding"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core","name":"thread"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-mcp","name":"mcp.server"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"ingest.source"}`,
		`{"kind":"extractor","extension":"@use-crux/indexer/crux-core-media","name":"media.operation"}`,
		`{"kind":"native-primitive-manifest","name":"crux-static-index-host","version":"1","digest":"3eed37f3d3248c65bf73bbb0ebd4a3b21ba0160695134b7835740b87d5bf3e04"}`,
		`{"kind":"relation-policy","name":"runtime-relation-specs","digest":"e99fdb3c02cd55624f53cc32dfa497e4b07c04eb091d736d5b2aee153da18927"}`,
		`{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"b0a6b6c64e5b64d330d8d55adc08b8983947d1a313f020c6bfcc817d74057b48"}`,
		`{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.139.0+crux_native_group3.13"}`,
	}
	out := make([]json.RawMessage, 0, len(inputs))
	for _, input := range inputs {
		out = append(out, json.RawMessage(input))
	}
	return out
}
