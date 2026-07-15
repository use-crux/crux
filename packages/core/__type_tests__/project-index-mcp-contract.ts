import type {
  McpServerFacts,
  McpToolSelectionFacts,
  PrimitiveSpecificFacts,
  ToolFacts,
} from "../src/project-index";

const allowSelection = {
  allow: ["search"],
  prefix: "docs_",
} as const satisfies McpToolSelectionFacts;

const serverFacts = {
  kind: "mcp.server",
  serverId: "docs",
  transport: {
    kind: "streamable-http",
    origin: "https://mcp.example.test",
    pathname: "/tools",
  },
  tools: allowSelection,
} as const satisfies McpServerFacts;

const toolFacts = {
  kind: "tool",
  toolName: "docs_search",
  mcp: {
    serverId: "docs",
    remoteName: "search",
    exposedName: "docs_search",
    provenance: "authored-expected",
  },
} as const satisfies ToolFacts;

const primitiveFacts: readonly PrimitiveSpecificFacts[] = [
  serverFacts,
  toolFacts,
];

// @ts-expect-error allow and deny are intentionally mutually exclusive.
const invalidSelection: McpToolSelectionFacts = {
  allow: ["search"],
  deny: ["delete"],
};

void primitiveFacts;
void invalidSelection;
