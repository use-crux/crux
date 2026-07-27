package prompttext

import staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"

const (
	// MaxDocumentBytes bounds one unsaved source document.
	MaxDocumentBytes        = 2 << 20
	defaultMaxFragmentBytes = 64 << 10
	// MaxRequestBytes preserves both decoded V1 byte budgets across ATTACHED
	// JSON encoding. encoding/json may expand each byte to a six-byte escape.
	MaxRequestBytes = (6 * MaxDocumentBytes) +
		(6 * defaultMaxFragmentBytes) +
		(64 << 10)
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
		MaxFragmentBytes:  defaultMaxFragmentBytes,
		MaxFragmentDepth:  16,
		MaxPreviewBytes:   1 << 20,
	}
}
