package server

import (
	"net/url"
	"reflect"
	"testing"
)

func TestParseRunsOptionsIncludesRunRowFilters(t *testing.T) {
	opts := parseRunsOptions(url.Values{
		"status": []string{"ok,error"},
		"kind":   []string{"generation,retrieval"},
		"target": []string{"support"},
		"model":  []string{"gpt-4o"},
		"has":    []string{"feedback"},
	})

	if !reflect.DeepEqual(opts.Status, []string{"ok", "error"}) {
		t.Fatalf("status = %#v", opts.Status)
	}
	if !reflect.DeepEqual(opts.Kind, []string{"generation", "retrieval"}) {
		t.Fatalf("kind = %#v", opts.Kind)
	}
	if !reflect.DeepEqual(opts.Target, []string{"support"}) {
		t.Fatalf("target = %#v", opts.Target)
	}
	if !reflect.DeepEqual(opts.Model, []string{"gpt-4o"}) {
		t.Fatalf("model = %#v", opts.Model)
	}
	if !reflect.DeepEqual(opts.Has, []string{"feedback"}) {
		t.Fatalf("has = %#v", opts.Has)
	}
}
