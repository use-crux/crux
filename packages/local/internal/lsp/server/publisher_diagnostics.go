package server

import (
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func (p *Publisher) flushDiagnosticSubmissions() {
	p.submissionMu.Lock()
	defer p.submissionMu.Unlock()

	p.mu.Lock()
	submissions := p.submissions
	p.submissions = nil
	onPublish := p.onPublishPending
	p.onPublishPending = false
	p.mu.Unlock()
	for _, submission := range submissions {
		diagnostics := cloneDiagnostics(submission.diagnostics)
		if diagnostics == nil {
			diagnostics = []protocol.Diagnostic{}
		}
		p.options.SubmitDiagnostics(
			submission.uri,
			diagnostics,
		)
	}
	if onPublish {
		p.options.OnPublish()
	}
}

func (p *Publisher) currentDiagnostics(publication readmodel.Publication) (
	map[protocol.DocumentURI][]protocol.Diagnostic,
	map[string]api.IndexLintFinding,
) {
	findings := make([]api.IndexLintFinding, 0)
	for _, values := range publication.Findings {
		findings = append(findings, values...)
	}
	filtered := mapping.FilterFindings(findings, p.filter)
	byID := make(map[string]api.IndexLintFinding, len(filtered))
	for _, finding := range filtered {
		byID[finding.ID] = finding
	}
	mapper := mapping.New(mapping.Options{
		Root:       p.options.Root,
		ConfigFile: p.options.ConfigFile,
		Lines:      p.options.Lines,
		Definition: func(id string) (api.ProjectDefinition, bool) {
			definition, ok := publication.DefinitionsByID[id]
			return definition, ok
		},
	})
	return mapper.MapFindings(filtered), byID
}
