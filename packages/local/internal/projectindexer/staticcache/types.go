package staticcache

import (
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

type SourceInput struct {
	Files                 []staticprotocol.SourceFile
	SemanticSourceProfile *devtools.SemanticSourceProfile
}
