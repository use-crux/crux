import { source, blogSource } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

export function GET() {
  const startHere = [
    "# Crux documentation for coding agents",
    "",
    "> Start with the smallest relevant page, then use the complete index below to find exact APIs and guides.",
    "",
    "## Start here",
    "",
    "- [Foundations](https://cruxjs.dev/docs/foundations): What Crux is and how its primitives fit together.",
    "- [Getting Started](https://cruxjs.dev/docs/getting-started): Install Crux and ship a first prompt.",
    "- [Developer Tools](https://cruxjs.dev/docs/developer-tools): Devtools, CLI and TUI, VS Code and LSP, and coding-agent access.",
    "- [Guides](https://cruxjs.dev/docs/guides): Task-focused explanations and workflows.",
    "- [API Reference](https://cruxjs.dev/docs/reference): Exact APIs, commands, settings, and contracts.",
    "",
    "Fetch one documentation page as source Markdown by replacing `/docs/` with `/llms.mdx/` in its URL.",
  ].join("\n");

  const blogIndex = [
    "# Crux Blog",
    "",
    ...blogSource
      .getPages()
      .filter((page) => !page.data.draft)
      .sort((a, b) => b.data.date.localeCompare(a.data.date))
      .map(
        (page) =>
          `- [${page.data.title}](https://cruxjs.dev${page.url}): ${page.data.description ?? ""}`,
      ),
  ].join("\n");

  return new Response(
    [startHere, llms(source).index(), blogIndex].join("\n\n"),
  );
}
