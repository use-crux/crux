package model

import "encoding/json"

// ProjectNativeStaticConfig is the executable-config fragment used before
// Go/Rust-owned native static planning.
type ProjectNativeStaticConfig struct {
	Root              string                                  `json:"root"`
	ConfigFile        string                                  `json:"configFile,omitempty"`
	NativeAstEnabled  bool                                    `json:"nativeAstEnabled"`
	NativeAstFrontend string                                  `json:"nativeAstFrontend,omitempty"`
	Extensions        []ProjectNativeStaticExtensionReference `json:"extensions"`
	Lint              json.RawMessage                         `json:"lint,omitempty"`
	Diagnostics       []ProjectNativeStaticConfigDiagnostic   `json:"diagnostics,omitempty"`
}

// ProjectNativeStaticExtensionReference identifies one configured extension.
type ProjectNativeStaticExtensionReference struct {
	Package string `json:"package"`
	Export  string `json:"export,omitempty"`
}

// ProjectNativeStaticConfigDiagnostic is a compact JSON-safe config diagnostic.
type ProjectNativeStaticConfigDiagnostic struct {
	ID       string `json:"id,omitempty"`
	Severity string `json:"severity,omitempty"`
	Code     string `json:"code,omitempty"`
	Message  string `json:"message,omitempty"`
}
