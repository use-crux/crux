package view

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestTransformStoreRejectsEstablishAfterNewerChange(t *testing.T) {
	store := newTransformStore()
	opened := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 1, SourceHash: "saved",
	}
	changed := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 2, SourceHash: "dirty",
	}
	if !store.reserve("/repo/source.ts", opened) {
		t.Fatal("initial revision was not reserved")
	}
	store.change("/repo/source.ts", changed, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{}, Text: "x",
	}})
	if store.establishCurrent(
		"/repo/source.ts",
		opened,
		"saved",
		normalizedView{},
	) {
		t.Fatal("stale selected view replaced the newer document revision")
	}
	snapshot := store.snapshot()
	if got := snapshot.documents["/repo/source.ts"].revision; got != changed {
		t.Fatalf("tracked revision = %#v, want %#v", got, changed)
	}
}

func TestTransformStoreCurrentRejectsAbsentRequestDocument(t *testing.T) {
	store := newTransformStore()
	revision := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 1, SourceHash: "saved",
	}
	if store.current(Stamp{
		TransformRevision: store.snapshot().revision,
		RequestDocument:   &revision,
		requestFile:       "/repo/source.ts",
	}) {
		t.Fatal("absent request document was current")
	}
}

func TestTransformLocationAcceptsExactDirtyEffectiveHash(t *testing.T) {
	location := Location{
		File:  "/repo/source.ts",
		Range: testRange(1, 2, 1, 8),
	}
	got, ok := transformLocation(
		location,
		"missing-record",
		"signature",
		transformSnapshot{documents: map[string]documentTransform{
			location.File: {
				revision: indexview.DocumentRevision{
					OpenEpoch: 1, Version: 2, SourceHash: "dirty",
				},
				baseSourceHash: "saved",
				records:        map[string]trackedRange{},
			},
		}},
		map[string]selectedSourceHash{
			location.File: {effective: "dirty", base: "saved"},
		},
	)
	if !ok || got != location {
		t.Fatalf("dirty exact location = %#v, %v; want %#v, true", got, ok, location)
	}
}

func TestTransformLocationRejectsUnavailableOpenDocument(t *testing.T) {
	location := Location{
		File:  "/repo/destination.ts",
		Range: testRange(1, 2, 1, 8),
	}
	got, ok := transformLocation(
		location,
		"definition:destination",
		"signature",
		transformSnapshot{documents: map[string]documentTransform{
			location.File: {
				unavailable: true,
				records:     map[string]trackedRange{},
			},
		}},
		map[string]selectedSourceHash{
			location.File: {effective: "saved", base: "saved"},
		},
	)
	if ok {
		t.Fatalf("unavailable open location = %#v, true; want omitted", got)
	}
}

func TestTransformStoreRecoversUnavailableDocumentOnFullReplacement(t *testing.T) {
	store := newTransformStore()
	file := "/repo/source.ts"
	unavailable := indexview.DocumentRevision{OpenEpoch: 1, Version: 1}
	recovered := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 2, SourceHash: "current",
	}
	store.unavailable(file, unavailable)
	store.change(file, recovered, []protocol.TextDocumentContentChangeEvent{{
		Text: "const value = md`current`;\n",
	}})

	snapshot := store.snapshot()
	if snapshot.documents[file].unavailable {
		t.Fatal("full-document recovery retained unavailable marker")
	}
	location := Location{File: file, Range: testRange(0, 14, 0, 25)}
	if got, ok := transformLocation(
		location,
		"ref:owner",
		"signature",
		snapshot,
		map[string]selectedSourceHash{
			file: {effective: "current", base: "current"},
		},
	); !ok || got != location {
		t.Fatalf("recovered exact location = %#v, %v", got, ok)
	}
}
