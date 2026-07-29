import type { CruxPromptTextUserPromptPreview } from "@use-crux/core/observability";
import type { ReactNode } from "react";
import { Streamdown } from "streamdown";
import type { ObservabilityRunDetailNode } from "@/types";
import { validPromptTextUserPrompt } from "./model";

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        User · prompt
      </div>
      <div
        className="rounded-[10px] px-4 py-3 text-[14px] leading-[1.6]"
        style={{
          background: "var(--devtools-bg-muted)",
          border: "1px solid var(--devtools-border)",
          fontFamily: "var(--devtools-serif)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Shows exact PromptText regions and token attribution when evidence is
 * reconstructing, otherwise preserving the established plain-text card.
 */
export function UserPromptCard({
  plainText,
  promptText,
}: {
  readonly plainText?: string;
  readonly promptText?: CruxPromptTextUserPromptPreview | unknown;
}) {
  const valid = validPromptTextUserPrompt(promptText);
  if (!valid) {
    if (plainText === undefined) return null;
    return (
      <Frame>
        <div className="devtools-prose">
          <Streamdown>{plainText}</Streamdown>
        </div>
      </Frame>
    );
  }
  const sources = [
    ...new Set(
      valid.segments.flatMap((segment) =>
        segment.source
          ? [
              `${segment.source}${
                segment.sourceVersion ? ` · ${segment.sourceVersion}` : ""
              }`,
            ]
          : [],
      ),
    ),
  ];

  return (
    <Frame>
      <div
        style={{ whiteSpace: "pre-wrap" }}
        aria-label="Resolved PromptText user prompt"
      >
        {valid.segments.map((segment, index) => (
          <span
            key={index}
            data-prompt-text-kind={
              segment.dynamic ? "interpolated" : "authored"
            }
            title={[
              segment.dynamic ? "interpolated" : "authored",
              segment.source,
              segment.sourceVersion,
            ]
              .filter(Boolean)
              .join(" · ")}
            style={{
              background: segment.dynamic
                ? "var(--devtools-iris-soft)"
                : "transparent",
              borderBottom: segment.dynamic
                ? "1px solid var(--devtools-iris)"
                : "1px solid transparent",
            }}
          >
            {segment.text}
          </span>
        ))}
      </div>
      <div
        className="mt-3 flex flex-wrap gap-2 border-t pt-2 font-mono text-[10px]"
        style={{
          borderColor: "var(--devtools-border)",
          color: "var(--devtools-fg-muted)",
        }}
      >
        <span>authored · static · {valid.staticTokens}</span>
        <span>interpolated · dynamic · {valid.dynamicTokens}</span>
        <span>total · {valid.tokens}</span>
      </div>
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px]">
          {sources.map((source) => (
            <span key={source}>source · {source}</span>
          ))}
        </div>
      )}
    </Frame>
  );
}

/**
 * Adapts one Local Run Detail node to the user-prompt presentation while
 * preserving the plain captured prompt as the fail-closed fallback.
 */
export function RunDetailUserPrompt({
  node,
  plainText,
}: {
  readonly node: ObservabilityRunDetailNode;
  readonly plainText?: string;
}) {
  return (
    <UserPromptCard
      plainText={plainText}
      promptText={node.request?.userPrompt}
    />
  );
}
