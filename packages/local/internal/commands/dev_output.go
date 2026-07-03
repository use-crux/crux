package commands

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func devStatusf(io *output.IO, format string, args ...any) {
	fmt.Fprintf(io.Err, format, args...)
}

func devBullet(io *output.IO) string {
	return io.Sprint(output.Dim, "*")
}

func devOK(io *output.IO) string {
	return io.Sprint(output.Green, "OK")
}

func devText(io *output.IO, text string) string {
	return io.Sprint(output.Fg, text)
}

func devAccent(io *output.IO, text string) string {
	return io.Sprint(output.Accent, text)
}

func devStrong(io *output.IO, text string) string {
	return io.Sprint(output.BoldCyan, text)
}
