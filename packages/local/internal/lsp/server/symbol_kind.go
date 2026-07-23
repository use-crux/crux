package server

import "github.com/use-crux/crux/packages/local/internal/lsp/protocol"

func symbolKind(kind string) protocol.SymbolKind {
	switch kind {
	case "prompt":
		return protocol.SymbolKindFunction
	case "context":
		return protocol.SymbolKindObject
	case "tool":
		return protocol.SymbolKindMethod
	case "agent":
		return protocol.SymbolKindClass
	case "flow":
		return protocol.SymbolKindEvent
	case "eval":
		return protocol.SymbolKindInterface
	case "router", "cascade", "fallback":
		return protocol.SymbolKindOperator
	default:
		return protocol.SymbolKindObject
	}
}
