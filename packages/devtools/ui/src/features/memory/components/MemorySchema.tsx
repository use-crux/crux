import { LDCard } from "./MemoryAtoms";
import type { MemoryStoreDetail } from "@/types";

interface SchemaFieldNode {
  name?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  fields?: readonly SchemaFieldNode[];
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  items?: { type?: string };
  properties?: Record<string, unknown>;
  required?: readonly string[];
}

/**
 * Stable property order: required fields first (in their declared order), then
 * the rest alphabetically. Go serializes `map[string]any` in random order, so
 * without this the schema card reshuffles on every refetch.
 */
function orderProperties(
  properties: Record<string, unknown>,
  required: readonly string[],
): [string, unknown][] {
  const rank = (name: string): number => {
    const i = required.indexOf(name);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return Object.entries(properties).sort(([a], [b]) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

/** Normalize one JSON-Schema property into the flat `SchemaFieldNode` the card renders. */
function propertyToField(
  name: string,
  raw: unknown,
  required: readonly string[],
): SchemaFieldNode {
  const p = (raw ?? {}) as JsonSchemaProperty;
  let type = p.type;
  if (type === "array" && p.items?.type) type = `${p.items.type}[]`;
  const nested =
    p.type === "object" && p.properties
      ? orderProperties(p.properties, p.required ?? []).map(([n, f]) =>
          propertyToField(n, f, p.required ?? []),
        )
      : undefined;
  return {
    name,
    type,
    required: required.includes(name),
    description: p.description,
    ...(nested ? { fields: nested } : {}),
  };
}

export function SchemaCard({
  schema,
  inferredFields,
  color,
  authoringHint,
}: {
  schema: MemoryStoreDetail["schema"];
  inferredFields?: readonly { name: string; ty: string }[];
  color: string;
  authoringHint?: string;
}) {
  const s = schema as
    | {
        name?: string;
        title?: string;
        description?: string;
        fields?: readonly SchemaFieldNode[];
        properties?: Record<string, unknown>;
        required?: readonly string[];
      }
    | undefined;
  const required = s && Array.isArray(s.required) ? s.required : [];
  const fields: SchemaFieldNode[] = s
    ? Array.isArray(s.fields)
      ? (s.fields as SchemaFieldNode[])
      : s.properties
        ? orderProperties(s.properties, required).map(([name, f]) =>
            propertyToField(name, f, required),
          )
        : []
    : [];
  const hasAuthored = fields.length > 0;
  const hasInferred =
    !hasAuthored && Boolean(inferredFields && inferredFields.length > 0);
  // JSON-Schema uses `title`; authored field-list schemas use `name`.
  const schemaName = s?.name ?? s?.title;
  const title = hasAuthored
    ? `Schema${schemaName ? ` · ${schemaName}` : ""}`
    : hasInferred
      ? "Schema · inferred"
      : "Schema";
  return (
    <LDCard title={title} color={color} padding="12px 14px">
      {hasAuthored ? (
        <>
          <div
            className="font-mono text-[11px]"
            style={{ color: "var(--qw-fg-muted)", lineHeight: 1.7 }}
          >
            {fields.map((f, i) => (
              <SchemaFieldLine key={`${f.name ?? i}`} field={f} depth={0} />
            ))}
          </div>
          {s?.description && (
            <div
              className="mt-2.5 pt-2.5 text-[12px] leading-[1.5]"
              style={{
                borderTop: "1px dashed var(--qw-border)",
                color: "var(--qw-fg-muted)",
                fontFamily: "var(--qw-serif, Georgia, serif)",
              }}
            >
              {s.description}
            </div>
          )}
        </>
      ) : hasInferred ? (
        <>
          <div
            className="font-mono text-[11px]"
            style={{ color: "var(--qw-fg-muted)", lineHeight: 1.7 }}
          >
            {inferredFields!.map((f) => (
              <div key={f.name}>
                <span style={{ color: "var(--qw-crux)" }}>{f.name}</span>{" "}
                <span style={{ color: "var(--qw-fg-faint)" }}>{f.ty}</span>
              </div>
            ))}
          </div>
          <div
            className="mt-2.5 pt-2.5 text-[11.5px] leading-[1.45]"
            style={{
              borderTop: "1px dashed var(--qw-border)",
              color: "var(--qw-fg-faint)",
              fontFamily: "var(--qw-serif, Georgia, serif)",
            }}
          >
            Authored schema not declared in this project — showing
            runtime-inferred shape.
            {authoringHint && (
              <>
                {" "}
                Declare with <span className="font-mono">
                  {authoringHint}
                </span>{" "}
                to see typed field descriptions here.
              </>
            )}
          </div>
        </>
      ) : (
        <SchemaPlaceholderBody authoringHint={authoringHint} />
      )}
    </LDCard>
  );
}

function SchemaPlaceholderBody({ authoringHint }: { authoringHint?: string }) {
  return (
    <div
      className="text-[12px] leading-[1.5]"
      style={{
        color: "var(--qw-fg-muted)",
        fontFamily: "var(--qw-serif, Georgia, serif)",
      }}
    >
      <div
        className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em]"
        style={{ color: "var(--qw-fg-faint)" }}
      >
        Pending authored schema
      </div>
      Not declared in this project yet — runtime hasn't observed any fields
      either.
      {authoringHint && (
        <div className="mt-1.5">
          Declare with{" "}
          <span className="font-mono" style={{ color: "var(--qw-fg)" }}>
            {authoringHint}
          </span>{" "}
          and the typed fields will surface here automatically.
        </div>
      )}
    </div>
  );
}

function SchemaFieldLine({
  field,
  depth,
}: {
  field: SchemaFieldNode;
  depth: number;
}) {
  const indent = depth * 12;
  return (
    <div style={{ paddingLeft: indent }}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        {field.name && (
          <span style={{ color: "var(--qw-crux)" }}>{field.name}</span>
        )}
        {field.type && (
          <span style={{ color: "var(--qw-fg-faint)" }}>{field.type}</span>
        )}
        {field.required && (
          <span
            className="rounded-[3px] px-[5px] text-[9px] font-semibold uppercase tracking-[0.06em]"
            style={{
              color: "var(--qw-danger)",
              background: "var(--qw-danger-soft)",
            }}
          >
            required
          </span>
        )}
      </div>
      {field.description && (
        <div
          className="pb-1 text-[11.5px] leading-[1.45]"
          style={{
            color: "var(--qw-fg-muted)",
            fontFamily: "var(--qw-serif, Georgia, serif)",
            maxWidth: 360,
          }}
        >
          {field.description}
        </div>
      )}
      {field.fields && field.fields.length > 0 && (
        <div>
          {field.fields.map((c, i) => (
            <SchemaFieldLine
              key={`${c.name ?? i}`}
              field={c}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
