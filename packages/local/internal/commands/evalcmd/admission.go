package evalcmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func confirmUnknownCost(cmd *cobra.Command) (bool, error) {
	_, _ = fmt.Fprint(cmd.ErrOrStderr(), "Eval has external actions with unknown maximum cost. Continue? [y/N] ")
	answer, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && len(answer) == 0 {
		return false, err
	}
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes", nil
}
