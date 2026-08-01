import { T } from "./tokens";
import { Chip, SectionHead } from "./primitives";
import type { ViewDef } from "./adapt";

const KNOWLEDGE_KINDS = new Set([
  "rag.knowledgeBase",
  "rag.knowledgeBase.view",
  "knowledge.relation",
  "knowledge.assertions",
  "knowledge.communities",
  "knowledge.model",
]);

function compactList(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "";
}

function specificRows(def: ViewDef): Array<[string, string | number | undefined]> {
  const f = def.facts;
  switch (def.kind) {
    case "rag.knowledgeBase":
      return [["knowledge base", f?.knowledgeBaseId]];
    case "rag.knowledgeBase.view":
      return [
        ["knowledge base", f?.knowledgeBaseId],
        ["view", f?.viewId],
        ["filter fields", compactList(f?.whereFields)],
      ];
    case "knowledge.relation":
      return [["relation", f?.relationId]];
    case "knowledge.assertions":
      return [["assertions", f?.assertionId]];
    case "knowledge.communities":
      return [["communities", f?.communitiesId]];
    case "knowledge.model":
      return [["model", f?.modelName]];
    default:
      return [];
  }
}

function factRows(def: ViewDef): Array<[string, string | number]> {
  const f = def.facts ?? {};
  const rows: Array<[string, string | number | undefined]> = [
    ["definition id", def.id],
    ...specificRows(def),
    ["namespace", f.namespace],
    ["model", f.modelName],
    ["version", f.version],
    ["types", compactList(f.typeNames)],
  ];
  return rows.filter(
    (row): row is [string, string | number] =>
      row[1] !== undefined && row[1] !== "",
  );
}

export function IndexKnowledge({ def }: { def: ViewDef }) {
  if (!KNOWLEDGE_KINDS.has(def.kind)) return null;
  const rows = factRows(def);
  if (rows.length === 0) return null;
  return (
    <>
      <SectionHead
        eyebrow="Knowledge"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {rows.length} details
          </span>
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: "6px 18px 12px",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: 36,
          }}
        >
          {rows.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                padding: "6px 0",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  color: T.fgMuted,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: T.fg,
                  textAlign: "right",
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
        {def.facts?.whereFields && def.facts.whereFields.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 12,
            }}
          >
            {def.facts.whereFields.map((field) => (
              <Chip key={field} tone="ok" mono>
                {field}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
