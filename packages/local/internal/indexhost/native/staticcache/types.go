package staticcache

import (
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type SourceInput struct {
	Files                 []protocol.SourceFile
	SemanticSourceProfile *projectindex.SemanticSourceProfile
}
