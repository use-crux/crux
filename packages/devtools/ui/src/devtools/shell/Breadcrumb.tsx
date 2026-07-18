/**
 * Navigable header breadcrumb.
 *
 * Pages author breadcrumbs as plain `"Group / Label / detail"` strings
 * (see `DevtoolsShellProps.breadcrumb`). This component splits that string and
 * turns every segment except the last (the current page) into a button
 * when its label resolves to a known screen via `breadcrumbTarget`.
 * Group headings (Inspect, Library, …) and detail ids don't resolve, so
 * they stay as plain, non-clickable text.
 *
 * Inherits the mono/uppercase/faint typography from the wrapper in
 * DevtoolsShell; clickable segments only add a hover affordance.
 */

import { Fragment } from "react";
import { useNavigation } from "@/app/navigation/useNavigation";
import { breadcrumbTarget } from "@/app/navigation/navTarget";

export function Breadcrumb({ text }: { text: string }) {
  const { navigate } = useNavigation();
  const segments = text
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return (
    <>
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        const target = isLast ? null : breadcrumbTarget(segment);
        return (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden> / </span>}
            {target ? (
              <button
                type="button"
                onClick={() => navigate(target)}
                className="cursor-pointer underline-offset-2 transition-colors hover:text-[var(--devtools-fg)] hover:underline"
              >
                {segment}
              </button>
            ) : (
              <span>{segment}</span>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
