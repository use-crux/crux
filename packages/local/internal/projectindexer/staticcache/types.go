package staticcache

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

type SourceInput struct {
	Files                 []staticprotocol.SourceFile
	SemanticSourceProfile *projectindex.SemanticSourceProfile
}
