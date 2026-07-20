package evalcmd

import (
	"bufio"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func confirmUnknownCost(streams *output.IO) (bool, error) {
	_, _ = fmt.Fprint(streams.Err, "Eval has external actions with unknown maximum cost. Continue? [y/N] ")
	answer, err := bufio.NewReader(streams.In).ReadString('\n')
	if err != nil && len(answer) == 0 {
		return false, err
	}
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes", nil
}
