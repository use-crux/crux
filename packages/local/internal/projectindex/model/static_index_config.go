package model

import "encoding/json"

// ProjectStaticIndexConfig is the executable-config fragment used before
// Go/Rust-owned Static Index planning.
type ProjectStaticIndexConfig struct {
	Root       string `json:"root"`
	ConfigFile string `json:"configFile,omitempty"`
	// StaticSyntaxEnabled preserves the historical nativeAstEnabled JSON field
	// while normalizing Go code to Static Syntax vocabulary.
	StaticSyntaxEnabled bool `json:"nativeAstEnabled"`
	// StaticSyntaxFrontend preserves the historical nativeAstFrontend JSON field
	// while normalizing Go code to Static Syntax vocabulary.
	StaticSyntaxFrontend string                                 `json:"nativeAstFrontend,omitempty"`
	Extensions           []ProjectStaticIndexExtensionReference `json:"extensions"`
	Lint                 json.RawMessage                        `json:"lint,omitempty"`
	Diagnostics          []ProjectStaticIndexConfigDiagnostic   `json:"diagnostics,omitempty"`
}

// ProjectStaticIndexExtensionReference identifies one configured extension.
type ProjectStaticIndexExtensionReference struct {
	Package string `json:"package"`
	Export  string `json:"export,omitempty"`
}

// ProjectStaticIndexConfigDiagnostic is a compact JSON-safe config diagnostic.
type ProjectStaticIndexConfigDiagnostic struct {
	ID       string `json:"id,omitempty"`
	Severity string `json:"severity,omitempty"`
	Code     string `json:"code,omitempty"`
	Message  string `json:"message,omitempty"`
}
