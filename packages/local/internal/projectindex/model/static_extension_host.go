package model

import "encoding/json"

// StaticExtensionHostManifestResult is the data-only extension runtime
// fragment loaded by Node for native static planning.
type StaticExtensionHostManifestResult struct {
	Method                        string                                `json:"method"`
	Root                          string                                `json:"root"`
	NativeCompilerProtocolVersion int                                   `json:"nativeCompilerProtocolVersion"`
	Manifest                      StaticExtensionRuntimeManifest        `json:"manifest"`
	Diagnostics                   []ProjectNativeStaticConfigDiagnostic `json:"diagnostics,omitempty"`
	Node                          StaticExtensionHostNodeReport         `json:"node"`
	NativeOnlyEligible            bool                                  `json:"nativeOnlyEligible"`
	NativeOnlyReasons             []string                              `json:"nativeOnlyReasons,omitempty"`
	RuleDescriptors               json.RawMessage                       `json:"ruleDescriptors,omitempty"`
	CacheInputs                   []json.RawMessage                     `json:"cacheInputs,omitempty"`
}

// StaticExtensionRuntimeManifest is the serializable extension runtime manifest
// returned by the TypeScript compatibility host.
type StaticExtensionRuntimeManifest struct {
	CallNames       []string          `json:"callNames,omitempty"`
	StaticInterests json.RawMessage   `json:"staticInterests,omitempty"`
	StaticHost      json.RawMessage   `json:"staticHost,omitempty"`
	RelationSpecs   json.RawMessage   `json:"relationSpecs,omitempty"`
	CacheInputs     []json.RawMessage `json:"cacheInputs,omitempty"`
}

// StaticExtensionHostNodeReport explains why the compatibility host is needed.
type StaticExtensionHostNodeReport struct {
	Started bool     `json:"started"`
	Reasons []string `json:"reasons,omitempty"`
}
