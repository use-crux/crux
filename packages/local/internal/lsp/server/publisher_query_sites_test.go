package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherSiteAtChoosesNearestDisplayedSiteWithWholeLineFallback(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	columnThree, columnFive := 3, 5
	store.ApplySnapshot("scope", readmodel.Snapshot{Relations: []api.ProjectRelation{
		{ID: "relation:line-z", To: "prompt:line-z", Source: &api.SourceLoc{File: file, Line: 3}},
		{ID: "relation:line-a", To: "prompt:line-a", Source: &api.SourceLoc{File: file, Line: 3}},
		{ID: "relation:far", To: "prompt:far", Source: &api.SourceLoc{File: file, Line: 3, Column: &columnFive}},
		{ID: "relation:z", To: "prompt:z", Source: &api.SourceLoc{File: file, Line: 3, Column: &columnThree}},
		{ID: "relation:a", To: "prompt:a", Source: &api.SourceLoc{File: file, Line: 3, Column: &columnThree}},
	}})
	publisher.DidOpen(uri, 1)

	lineFallback, ok := publisher.SiteAt(uri, protocol.Position{Line: 2, Character: 1})
	if !ok || lineFallback.Site.ID != "relation:line-a" {
		t.Fatalf("SiteAt before first column = %#v, %v; want whole-line fallback", lineFallback, ok)
	}
	nearest, ok := publisher.SiteAt(uri, protocol.Position{Line: 2, Character: 3})
	if !ok || nearest.Site.ID != "relation:a" {
		t.Fatalf("SiteAt nearest tied column = %#v, %v; want relation:a", nearest, ok)
	}
	if _, ok := publisher.SiteAt(uri, protocol.Position{Line: 1, Character: 20}); ok {
		t.Fatal("SiteAt matched a site on another line")
	}
}

func TestDisplayedNavigationSiteOrderTreatsColumnlessFallbacksAsColumnZero(t *testing.T) {
	left := documentNavigationSite{
		Site:  readmodel.NavigationSite{ID: "relation:a", Source: api.SourceLoc{File: "writer.ts", Line: 3}},
		Range: protocol.Range{Start: protocol.Position{Line: 2, Character: 9}},
	}
	right := documentNavigationSite{
		Site:  readmodel.NavigationSite{ID: "relation:z", Source: api.SourceLoc{File: "writer.ts", Line: 3}},
		Range: protocol.Range{Start: protocol.Position{Line: 2, Character: 1}},
	}
	if !displayedNavigationSiteLess(left, right) {
		t.Fatal("columnless displayed-site order used collapse character before ID")
	}
}

func TestPublisherReferencesToMergesAndSortsRelationAndSourceRefSites(t *testing.T) {
	store, publisher, _, _, writerFile := newViewPublisher(t)
	root := filepath.Dir(writerFile)
	aFile, bFile := filepath.Join(root, "a.ts"), filepath.Join(root, "b.ts")
	if err := os.WriteFile(aFile, []byte("a\na\na\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bFile, []byte("b\nb\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column := 1
	target := viewDefinition("prompt:target", writerFile, 3, &column, nil)
	target.SourceRefs = []api.ProjectSourceRef{{
		ID: "ref:b", Role: "input", Source: api.SourceLoc{File: bFile, Line: 2, Column: &column},
	}}
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{target},
		Relations: []api.ProjectRelation{{
			ID: "relation:a", To: target.ID, Source: &api.SourceLoc{File: aFile, Line: 3, Column: &column},
		}},
	})

	got := publisher.ReferencesTo(target.ID)
	if len(got) != 2 || got[0].Site.ID != "relation:a" || got[1].Site.ID != "ref:b" ||
		got[1].Site.Role != "input" {
		t.Fatalf("ReferencesTo = %#v, want sorted relation then source ref", got)
	}
	*got[0].Site.Source.Column = 99
	again := publisher.ReferencesTo(target.ID)
	if *again[0].Site.Source.Column != 1 {
		t.Fatalf("ReferencesTo result aliases Store state: %#v", again)
	}
}

func TestPublisherReferencesToSubstitutesDirtyDisplayedSitesAcrossOpenAndClosedFiles(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	closedFile := filepath.Join(filepath.Dir(file), "closed.ts")
	if err := os.WriteFile(closedFile, []byte("closed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column := 1
	targetID := "prompt:target"
	closed := api.ProjectRelation{
		ID: "relation:closed", To: targetID,
		Source: &api.SourceLoc{File: closedFile, Line: 1, Column: &column},
	}
	store.ApplySnapshot("scope", readmodel.Snapshot{Relations: []api.ProjectRelation{
		closed,
		{ID: "relation:old", To: targetID, Source: &api.SourceLoc{File: file, Line: 3, Column: &column}},
	}})
	publisher.DidOpen(uri, 1)
	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	store.ApplySnapshot("scope", readmodel.Snapshot{Relations: []api.ProjectRelation{
		closed,
		{ID: "relation:new", To: targetID, Source: &api.SourceLoc{File: file, Line: 1, Column: &column}},
	}})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})

	dirty := publisher.ReferencesTo(targetID)
	old, ok := querySiteByID(dirty, "relation:old")
	if !ok || old.Range.Start.Line != 3 {
		t.Fatalf("dirty ReferencesTo = %#v, want shifted old site", dirty)
	}
	if _, ok := querySiteByID(dirty, "relation:new"); ok {
		t.Fatalf("dirty ReferencesTo leaked held Store site: %#v", dirty)
	}
	if _, ok := querySiteByID(dirty, "relation:closed"); !ok {
		t.Fatalf("dirty ReferencesTo dropped closed-file site: %#v", dirty)
	}

	publisher.DidSave(uri)
	saved := publisher.ReferencesTo(targetID)
	newSite, ok := querySiteByID(saved, "relation:new")
	if !ok || newSite.Range.Start.Line != 0 {
		t.Fatalf("saved ReferencesTo = %#v, want held new site", saved)
	}
	publisher.DidClose(uri)
	closedView := publisher.ReferencesTo(targetID)
	if _, ok := querySiteByID(closedView, "relation:new"); !ok {
		t.Fatalf("closed ReferencesTo = %#v, want Store site", closedView)
	}
}

func querySiteByID(sites []documentNavigationSite, id string) (documentNavigationSite, bool) {
	for _, site := range sites {
		if site.Site.ID == id {
			return site, true
		}
	}
	return documentNavigationSite{}, false
}

func TestPublisherSiteAtUsesShiftedAndCollapsedOpenViewThenClosedStoreTruth(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 3
	store.ApplySnapshot("scope", readmodel.Snapshot{Relations: []api.ProjectRelation{{
		ID: "relation:writer", To: "prompt:writer", Source: &api.SourceLoc{File: file, Line: 3, Column: &column},
	}}})
	publisher.DidOpen(uri, 1)
	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	shifted, ok := publisher.SiteAt(uri, protocol.Position{Line: 3, Character: 2})
	if !ok || shifted.Range.Start != (protocol.Position{Line: 3, Character: 2}) {
		t.Fatalf("shifted SiteAt = %#v, %v", shifted, ok)
	}

	publisher.DidChange(uri, 3, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 3, Character: 1},
			End:   protocol.Position{Line: 3, Character: 4},
		},
	}})
	collapsed, ok := publisher.SiteAt(uri, protocol.Position{Line: 3, Character: 1})
	if !ok || collapsed.Range.Start != collapsed.Range.End ||
		collapsed.Range.Start != (protocol.Position{Line: 3, Character: 1}) {
		t.Fatalf("collapsed SiteAt = %#v, %v", collapsed, ok)
	}

	publisher.DidClose(uri)
	disk, ok := publisher.SiteAt(uri, protocol.Position{Line: 2, Character: 2})
	if !ok || disk.Range.Start != (protocol.Position{Line: 2, Character: 2}) {
		t.Fatalf("closed SiteAt = %#v, %v; want Store position", disk, ok)
	}
}

func TestPublisherSiteAtBreaksCollapsedDisplayedPositionTiesByID(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	columnThree, columnFive := 3, 5
	store.ApplySnapshot("scope", readmodel.Snapshot{Relations: []api.ProjectRelation{
		{ID: "relation:z", To: "prompt:target", Source: &api.SourceLoc{File: file, Line: 3, Column: &columnThree}},
		{ID: "relation:a", To: "prompt:target", Source: &api.SourceLoc{File: file, Line: 3, Column: &columnFive}},
	}})
	publisher.DidOpen(uri, 1)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 2, Character: 1},
			End:   protocol.Position{Line: 2, Character: 6},
		},
	}})

	got, ok := publisher.SiteAt(uri, protocol.Position{Line: 2, Character: 1})
	if !ok || got.Site.ID != "relation:a" {
		t.Fatalf("SiteAt collapsed tie = %#v, %v; want lower ID", got, ok)
	}
}

func TestPublisherReferencesToBreaksCollapsedDisplayedPositionTiesByID(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	columnThree, columnFive := 3, 5
	targetID := "prompt:target"
	store.ApplySnapshot("scope", readmodel.Snapshot{Relations: []api.ProjectRelation{
		{ID: "relation:z", To: targetID, Source: &api.SourceLoc{File: file, Line: 3, Column: &columnThree}},
		{ID: "relation:a", To: targetID, Source: &api.SourceLoc{File: file, Line: 3, Column: &columnFive}},
	}})
	publisher.DidOpen(uri, 1)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 2, Character: 1},
			End:   protocol.Position{Line: 2, Character: 6},
		},
	}})

	got := publisher.ReferencesTo(targetID)
	if len(got) != 2 || got[0].Site.ID != "relation:a" || got[1].Site.ID != "relation:z" {
		t.Fatalf("ReferencesTo collapsed tie = %#v, want ID order", got)
	}
}
