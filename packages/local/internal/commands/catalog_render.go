package commands

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func printCatalogList(io *output.IO, catalog api.CatalogListV1) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "catalog"))
	if len(catalog.Definitions) == 0 {
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No Catalog definitions found. Run `crux check` or start `crux dev` to compile the project."))
		return
	}
	table := &output.Table{Headers: []string{"ID", "KIND", "FIDELITY", "STATUS", "SOURCE"}}
	for _, definition := range catalog.Definitions {
		table.Rows = append(table.Rows, []string{
			io.Sprint(output.Cyan, definition.ID),
			definition.Kind,
			valueOrUnknown(definition.Fidelity),
			valueOrUnknown(definition.Status),
			io.Sprint(output.Dim, sourceLabel(definition.Source)),
		})
	}
	for _, line := range strings.Split(strings.TrimSuffix(io.RenderTable(table), "\n"), "\n") {
		fmt.Fprintln(io.Out, strings.TrimRight(line, " "))
	}
}

func printCatalogDefinition(io *output.IO, catalog api.CatalogDefinitionV1) {
	definition := catalog.Definition
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "catalog show"))
	fmt.Fprintf(io.Out, "  ID: %s\n", io.Sprint(output.BoldCyan, definition.ID))
	fmt.Fprintf(io.Out, "  Kind: %s\n", valueOrUnknown(definition.Kind))
	fmt.Fprintf(io.Out, "  Fidelity: %s\n", valueOrUnknown(definition.Fidelity))
	fmt.Fprintf(io.Out, "  Status: %s\n", valueOrUnknown(definition.Status))
	fmt.Fprintf(io.Out, "  Source: %s\n", sourceLabel(definition.Source))
	if definition.Description != "" {
		fmt.Fprintf(io.Out, "  Description: %s\n", definition.Description)
	}
	printCatalogSourceRefs(io, definition.SourceRefs)
	printCatalogRelations(io, catalog.Relations)
	printCatalogHealth(io, catalog.Diagnostics, catalog.Lints)
	if catalog.Quality != nil {
		fmt.Fprintf(io.Out, "\n  Eval runs: %d\n", catalog.Quality.RunCount)
	}
	if catalog.RuntimeActivity != nil {
		fmt.Fprintf(io.Out, "\n  Runtime: %d runs", catalog.RuntimeActivity.RunCount)
		if catalog.RuntimeActivity.LastRunID != "" {
			fmt.Fprintf(io.Out, ", latest %s", catalog.RuntimeActivity.LastRunID)
		}
		fmt.Fprintln(io.Out)
	}
}

func printCatalogSourceRefs(io *output.IO, refs []api.ProjectSourceRef) {
	if len(refs) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Source references"))
	for _, ref := range refs {
		fmt.Fprintf(io.Out, "    %s  %s  %s\n", ref.Role, ref.ID, sourceLabel(&ref.Source))
	}
}

func printCatalogRelations(io *output.IO, relations api.CatalogRelationsV1) {
	if len(relations.Incoming)+len(relations.Outgoing) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Relations"))
	for _, relation := range relations.Incoming {
		fmt.Fprintf(io.Out, "    ← %s  %s\n", relation.Type, relation.From)
	}
	for _, relation := range relations.Outgoing {
		fmt.Fprintf(io.Out, "    → %s  %s\n", relation.Type, relation.To)
	}
}

func printCatalogHealth(io *output.IO, diagnostics []api.IndexDiagnostic, lints []api.IndexLintFinding) {
	if len(diagnostics)+len(lints) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Health"))
	for _, diagnostic := range diagnostics {
		fmt.Fprintf(io.Out, "    %s  %s  %s\n", diagnostic.Severity, diagnostic.Code, diagnostic.Message)
	}
	for _, lint := range lints {
		fmt.Fprintf(io.Out, "    %s  %s  %s\n", lint.Severity, lint.RuleID, lint.Title)
	}
}

func printCatalogStatus(io *output.IO, status api.CatalogStatusV1) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "catalog status"))
	fmt.Fprintf(io.Out, "  Catalog: %d definitions, %d relations, %d diagnostics, %d lints\n",
		status.Catalog.Definitions, status.Catalog.Relations, status.Catalog.Diagnostics, status.Catalog.Lints)
	if status.Indexing == nil {
		fmt.Fprintln(io.Out, "  Indexing: unknown")
	} else {
		fmt.Fprintf(io.Out, "  Indexing: %s\n", valueOrUnknown(status.Indexing.Status))
		fmt.Fprintf(io.Out, "  AST: %s\n", valueOrUnknown(status.Indexing.AST.Status))
		fmt.Fprintf(io.Out, "  Semantic: %s\n", valueOrUnknown(status.Indexing.Semantic.Status))
		if status.Indexing.Cache != nil {
			fmt.Fprintf(io.Out, "  Cache: %s", valueOrUnknown(status.Indexing.Cache.Status))
			if status.Indexing.Cache.SnapshotAgeMs > 0 {
				fmt.Fprintf(io.Out, " (%dms old)", status.Indexing.Cache.SnapshotAgeMs)
			}
			fmt.Fprintln(io.Out)
		} else {
			fmt.Fprintln(io.Out, "  Cache: unknown")
		}
		if status.Indexing.Error != "" {
			fmt.Fprintf(io.Out, "  Last error: %s\n", status.Indexing.Error)
		}
	}
	if status.Semantic == nil {
		fmt.Fprintln(io.Out, "  Semantic mode: unknown")
		fmt.Fprintln(io.Out, "  Semantic backend: unknown")
	} else {
		fmt.Fprintf(io.Out, "  Semantic mode: %s\n", valueOrUnknown(status.Semantic.Mode))
		fmt.Fprintf(io.Out, "  Semantic backend: %s\n", valueOrUnknown(status.Semantic.Backend))
	}
	printCatalogWatchStatus(io, status.Watch)
	if status.Manifests.Count == nil {
		fmt.Fprintln(io.Out, "  Manifests: unknown")
	} else {
		fmt.Fprintf(io.Out, "  Manifests: %d\n", *status.Manifests.Count)
	}
	if status.Manifests.Current == nil {
		fmt.Fprintln(io.Out, "  Current manifest: unknown")
	} else {
		fmt.Fprintf(io.Out, "  Current manifest: %s / %s\n", status.Manifests.Current.ProjectID, status.Manifests.Current.ManifestID)
	}
}

func printCatalogWatchStatus(io *output.IO, watch *api.ProjectIndexWatchStatus) {
	if watch == nil {
		fmt.Fprintln(io.Out, "  Watch: unknown")
		return
	}
	fmt.Fprintf(io.Out, "  Watch: %s", valueOrUnknown(watch.State))
	if watch.LastRun != nil && watch.LastRun.PlanKind != "" {
		fmt.Fprintf(io.Out, " (%s", watch.LastRun.PlanKind)
		if watch.LastRun.FallbackUsed {
			fmt.Fprintf(io.Out, ", fallback: %s", valueOrUnknown(watch.LastRun.FallbackReason))
		}
		fmt.Fprint(io.Out, ")")
	}
	fmt.Fprintln(io.Out)
	if watch.LastRun != nil {
		fmt.Fprintf(io.Out, "  Changed / affected: %d / %d files\n", watch.LastRun.ChangedFileCount, watch.LastRun.AffectedFileCount)
	}
}

func sourceLabel(source *api.SourceLoc) string {
	if source == nil || source.File == "" {
		return "unknown"
	}
	if source.Line > 0 {
		return fmt.Sprintf("%s:%d", source.File, source.Line)
	}
	return source.File
}

func valueOrUnknown(value string) string {
	if value == "" {
		return "unknown"
	}
	return value
}
