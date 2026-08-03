package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// ExactArgs validates required positional arguments and includes enough
// command-specific guidance to recover without opening help separately.
func ExactArgs(count int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) == count {
			return nil
		}
		message := fmt.Sprintf("expected %d argument(s), received %d", count, len(args))
		if len(args) < count {
			message = fmt.Sprintf("missing required argument(s): %s", requiredArgumentNames(cmd.Use, len(args)))
		}
		usage := "  " + cmd.CommandPath()
		if fields := strings.Fields(cmd.Use); len(fields) > 1 {
			usage += " " + strings.Join(fields[1:], " ")
		}
		if example := strings.Trim(cmd.Example, "\n"); strings.TrimSpace(example) != "" {
			return fmt.Errorf("%s\n\nUsage:\n%s\n\nExample:\n%s", message, usage, example)
		}
		return fmt.Errorf("%s\n\nUsage:\n%s", message, usage)
	}
}

func requiredArgumentNames(use string, provided int) string {
	var required []string
	for _, field := range strings.Fields(use) {
		if strings.HasPrefix(field, "<") && strings.HasSuffix(field, ">") {
			required = append(required, field)
		}
	}
	if provided < len(required) {
		required = required[provided:]
	}
	if len(required) == 0 {
		return "positional argument"
	}
	return strings.Join(required, " ")
}
