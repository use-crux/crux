package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestMemoryStoreDetailPreservesEffectiveCaptureModes(t *testing.T) {
	tests := []struct {
		name string
		mode string
	}{
		{name: "omitted config effective default", mode: "deferred"},
		{name: "explicit inline", mode: "inline"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			memoryID := "capture-" + test.mode
			st := store.NewStore()
			st.SetIndexData(store.IndexData{
				Definitions: []store.ProjectDefinition{
					{
						ID:       "memory:" + memoryID,
						Kind:     "memory",
						Name:     memoryID,
						Fidelity: "resolved",
						Metadata: json.RawMessage(fmt.Sprintf(`{"captureMode":%q}`, test.mode)),
					},
				},
			})
			st.MemoryWrite(store.MemoryWriteEvent{
				MemoryID:   memoryID,
				MemoryType: "working",
				Operation:  "set",
				EntryKey:   "state",
				Content:    "ready",
				Timestamp:  1,
			})

			service := NewService(st, inspect.NewService(st, t.TempDir()))
			value, found, err := service.MemoryStoreDetail(context.Background(), memoryID)
			if err != nil || !found {
				t.Fatalf("memory detail found=%v err=%v", found, err)
			}
			if detail := value.(memoryStoreDetail); detail.CaptureMode != test.mode {
				t.Fatalf("captureMode = %q, want %q", detail.CaptureMode, test.mode)
			}
		})
	}
}
