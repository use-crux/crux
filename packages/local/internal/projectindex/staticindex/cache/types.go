package cache

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type SourceInput struct {
	Files                 []protocol.SourceFile
	SemanticSourceProfile *projectindex.SemanticSourceProfile
}
