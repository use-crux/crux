package devtools

// ProjectSemanticExecutionMode controls how a Project Index refresh runs
// semantic enrichment after the AST/source patch is available.
type ProjectSemanticExecutionMode string

const (
	// ProjectSemanticInline applies semantic enrichment before ReindexProject returns.
	ProjectSemanticInline ProjectSemanticExecutionMode = "inline"
	// ProjectSemanticBackground schedules semantic enrichment after publishing AST facts.
	ProjectSemanticBackground ProjectSemanticExecutionMode = "background"
	// ProjectSemanticDisabled skips semantic enrichment for this refresh.
	ProjectSemanticDisabled ProjectSemanticExecutionMode = "disabled"
)

// ProjectReindexOptions configures a Project Index refresh.
type ProjectReindexOptions struct {
	Semantic ProjectSemanticExecutionMode
}

func (o ProjectReindexOptions) semanticMode() ProjectSemanticExecutionMode {
	switch o.Semantic {
	case ProjectSemanticBackground, ProjectSemanticDisabled:
		return o.Semantic
	default:
		return ProjectSemanticInline
	}
}
