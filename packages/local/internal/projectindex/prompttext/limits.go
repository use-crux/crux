package prompttext

import staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"

const (
	// MaxDocumentBytes bounds one unsaved source document.
	MaxDocumentBytes = 2 << 20
	// MaxRequestBytes preserves MaxDocumentBytes across ATTACHED JSON encoding.
	// encoding/json may expand one source byte to a six-byte Unicode escape.
	MaxRequestBytes = (6 * MaxDocumentBytes) + (64 << 10)
)

// DefaultLimits returns the centralized v1 transient-analysis bounds.
func DefaultLimits() staticprotocol.PromptTextLimits {
	return staticprotocol.PromptTextLimits{
		MaxSourceBytes:    MaxDocumentBytes,
		MaxTemplates:      256,
		MaxTemplateBytes:  256 << 10,
		MaxTraversalNodes: 100_000,
		MaxOutputBytes:    1 << 20,
		MaxFragments:      256,
		MaxFragmentBytes:  64 << 10,
		MaxFragmentDepth:  16,
		MaxPreviewBytes:   1 << 20,
	}
}
