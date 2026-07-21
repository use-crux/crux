package mapping

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func (m *Mapper) sourceRange(source api.SourceRange) protocol.Range {
	file := resolveFile(m.options.Root, source.File)
	start := protocol.Position{Line: zeroLine(source.StartLine)}
	if source.StartColumn != nil {
		start.Character = m.options.Lines.UTF16Column(file, source.StartLine, *source.StartColumn)
	}
	endLine := source.StartLine
	if source.EndLine != nil {
		endLine = *source.EndLine
	}
	end := protocol.Position{Line: zeroLine(endLine), Character: start.Character}
	if source.EndColumn != nil {
		end.Character = m.options.Lines.UTF16Column(file, endLine, *source.EndColumn)
	}
	return protocol.Range{Start: start, End: end}
}

func rangeCoversLine(source api.SourceRange, line int) bool {
	end := source.StartLine
	if source.EndLine != nil {
		end = *source.EndLine
	}
	return line >= source.StartLine && line <= end
}

func sameFile(root, left, right string) bool {
	return filepath.Clean(resolveFile(root, left)) == filepath.Clean(resolveFile(root, right))
}

func resolveFile(root, file string) string {
	if filepath.IsAbs(file) || windowsAbsolutePath.MatchString(file) {
		return file
	}
	return filepath.Join(root, file)
}
