package server

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func waitForE2ECompletionItem(
	t *testing.T,
	writer *jsonrpc.Writer,
	reader *jsonrpc.Reader,
	uri protocol.DocumentURI,
	position protocol.Position,
	label string,
	firstID int,
) protocol.CompletionItem {
	t.Helper()
	for attempt := 0; attempt < 80; attempt++ {
		id := firstID + attempt
		writeLSP(t, writer, map[string]any{
			"jsonrpc": "2.0", "id": id, "method": protocol.MethodCompletion,
			"params": protocol.CompletionParams{
				TextDocument: protocol.TextDocumentIdentifier{URI: uri},
				Position:     position,
			},
		})
		response := readUntil(t, reader, func(message map[string]json.RawMessage) bool {
			return string(message["id"]) == jsonNumber(id)
		})
		var list protocol.CompletionList
		if json.Unmarshal(response["result"], &list) == nil {
			for _, item := range list.Items {
				if item.Label == label {
					return item
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("completion never returned %q", label)
	return protocol.CompletionItem{}
}

func completionPositionAfter(t *testing.T, source, needle string) protocol.Position {
	t.Helper()
	offset := strings.Index(source, needle)
	if offset < 0 {
		t.Fatalf("completion source does not contain %q", needle)
	}
	offset += len(needle)
	lineStart := strings.LastIndex(source[:offset], "\n") + 1
	return protocol.Position{
		Line:      uint32(strings.Count(source[:offset], "\n")),
		Character: uint32(len(utf16.Encode([]rune(source[lineStart:offset])))),
	}
}
