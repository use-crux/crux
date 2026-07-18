import type { ReactNode } from "react";
import { Chip, SectionHead } from "./primitives";
import { T } from "./tokens";
import type { ViewDef } from "./adapt";
import { useIndexIndex, useIndexSelect } from "./context";
import {
  mcpCatalogView,
  type McpCatalogToolState,
  type McpServerCatalogView,
  type McpToolCatalogView,
} from "./mcp-catalog";

function Row({ label, children }: { label: string; children?: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 12,
        padding: "5px 0",
        fontFamily: T.mono,
        fontSize: 11.5,
      }}
    >
      <span style={{ color: T.fgFaint }}>{label}</span>
      <span style={{ color: T.fg, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const label = state
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
  const tone =
    state === "current"
      ? "ok"
      : state === "failed" || state === "removed"
        ? "danger"
        : state === "stale"
          ? "warn"
          : "muted";
  return <Chip tone={tone}>{label}</Chip>;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: T.bgElev,
        border: `1px solid ${T.border}`,
        borderRadius: 11,
        padding: "12px 18px",
        marginBottom: 22,
      }}
    >
      {children}
    </div>
  );
}

function transportLabel(view: McpServerCatalogView): string | undefined {
  const transport = view.transport;
  if (!transport) return undefined;
  if (transport.kind === "stdio")
    return [transport.kind, transport.executable].filter(Boolean).join(" · ");
  if (transport.kind === "streamable-http")
    return [transport.kind, transport.origin, transport.pathname]
      .filter(Boolean)
      .join(" · ");
  return transport.kind;
}

function ToolState({ state }: { state: McpCatalogToolState }) {
  return <StateChip state={state} />;
}

function McpServerDetail({ view }: { view: McpServerCatalogView }) {
  const select = useIndexSelect();
  return (
    <>
      <SectionHead
        eyebrow="MCP server"
        right={<StateChip state={view.state} />}
      />
      <Card>
        <Row label="server id">{view.serverId}</Row>
        <Row label="transport">{transportLabel(view)}</Row>
        <Row label="allow">{view.selection?.allow?.join(", ")}</Row>
        <Row label="deny">{view.selection?.deny?.join(", ")}</Row>
        <Row label="prefix">{view.selection?.prefix}</Row>
        <Row label="latest attempt">{view.observedAt}</Row>
        <Row label="revision">{view.revision}</Row>
        <Row label="failure">
          {view.failure
            ? `${view.failure.phase} · ${view.failure.category}`
            : undefined}
        </Row>
        <Row label="last success">
          {view.lastSuccessfulDiscovery?.observedAt}
        </Row>
        <Row label="implementation">
          {view.lastSuccessfulDiscovery?.implementation}
        </Row>
        <Row label="protocol">
          {view.lastSuccessfulDiscovery?.protocolVersion}
        </Row>
        <Row label="server-reported">
          {view.lastSuccessfulDiscovery?.server
            ? [
                view.lastSuccessfulDiscovery.server.name,
                view.lastSuccessfulDiscovery.server.version,
                "untrusted",
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined}
        </Row>
      </Card>

      <SectionHead
        eyebrow="Provided tools"
        right={<span style={{ color: T.fgFaint }}>{view.tools.length}</span>}
      />
      <Card>
        {view.tools.length === 0 ? (
          <span style={{ color: T.fgMuted, fontSize: 12 }}>
            {view.state === "never-observed"
              ? "Configured, but no discovery has been observed yet."
              : "The latest successful discovery exposed no tools."}
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {view.tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => select(tool.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  border: 0,
                  background: T.bg,
                  color: T.fg,
                  borderRadius: 7,
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  textAlign: "left",
                }}
              >
                <span>{tool.id}</span>
                <ToolState state={tool.state} />
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function schemaFields(schema: McpToolCatalogView["inputSchema"]): string {
  const properties = schema?.properties;
  return properties && typeof properties === "object"
    ? Object.keys(properties).join(", ")
    : "Schema captured";
}

function McpToolDetail({ view }: { view: McpToolCatalogView }) {
  const select = useIndexSelect();
  return (
    <>
      <SectionHead
        eyebrow="MCP origin"
        right={<StateChip state={view.state} />}
      />
      <Card>
        <Row label="server">
          {view.serverDefinitionId ? (
            <button
              type="button"
              onClick={() => select(view.serverDefinitionId!)}
              style={{
                all: "unset",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {view.serverDefinitionId}
            </button>
          ) : (
            `${view.serverId} · unresolved`
          )}
        </Row>
        <Row label="remote name">{view.remoteName}</Row>
        <Row label="exposed name">{view.exposedName}</Row>
        <Row label="provenance">{view.provenance}</Row>
        <Row label="last observed">{view.observedAt}</Row>
        <Row label="tool list fp">{view.toolListFingerprint}</Row>
        <Row label="input schema fp">{view.inputSchemaFingerprint}</Row>
        <Row label="output schema fp">{view.outputSchemaFingerprint}</Row>
        {view.inputSchema && (
          <Row label="input schema">{schemaFields(view.inputSchema)}</Row>
        )}
        {view.outputSchema && (
          <Row label="output schema">{schemaFields(view.outputSchema)}</Row>
        )}
      </Card>

      {view.annotations && (
        <>
          <SectionHead
            eyebrow="Untrusted server annotation"
            right={<Chip tone="warn">Untrusted</Chip>}
          />
          <Card>
            {Object.entries(view.annotations.value).map(([key, value]) => (
              <Row key={key} label={key}>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </Row>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

/** MCP-specific Catalog detail for authored servers and ordinary MCP tools. */
export function IndexMcpDetail({ def }: { def: ViewDef }) {
  const index = useIndexIndex();
  const view = mcpCatalogView(def, index);
  if (!view) return null;
  return view.kind === "server" ? (
    <McpServerDetail view={view} />
  ) : (
    <McpToolDetail view={view} />
  );
}
