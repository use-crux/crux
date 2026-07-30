import type { ChangeEvent, ReactNode } from "react";

type JsonObject = Readonly<Record<string, unknown>>;

export function PromptPreviewForm({
  schema,
  value,
  disabled,
  onChange,
}: {
  readonly schema: JsonObject;
  readonly value: JsonObject;
  readonly disabled: boolean;
  readonly onChange: (value: JsonObject) => void;
}) {
  return (
    <div className="space-y-4">
      <SchemaField
        schema={schema}
        value={value}
        path={[]}
        disabled={disabled}
        onValue={(path, next) => onChange(setAtPath(value, path, next))}
      />
    </div>
  );
}

function SchemaField({
  schema,
  value,
  path,
  disabled,
  onValue,
  label,
}: {
  readonly schema: JsonObject;
  readonly value: unknown;
  readonly path: readonly string[];
  readonly disabled: boolean;
  readonly onValue: (path: readonly string[], value: unknown) => void;
  readonly label?: string;
}): ReactNode {
  const scalar = scalarType(schema.type);
  if (schema.type === "object") {
    const object = isObject(value) ? value : {};
    const properties = isObject(schema.properties) ? schema.properties : {};
    return (
      <fieldset className="space-y-3">
        {label && (
          <legend className="text-sm font-medium">
            {fieldTitle(schema, label)}
          </legend>
        )}
        {Object.keys(properties)
          .sort()
          .map((name) => {
            const child = properties[name];
            return isObject(child) ? (
              <SchemaField
                key={name}
                schema={child}
                value={object[name]}
                path={[...path, name]}
                disabled={disabled}
                onValue={onValue}
                label={name}
              />
            ) : null;
          })}
      </fieldset>
    );
  }
  if (schema.type === "array") {
    return (
      <FieldShell schema={schema} label={label}>
        <textarea
          value={JSON.stringify(Array.isArray(value) ? value : [], null, 2)}
          disabled={disabled}
          rows={4}
          className="w-full rounded border bg-transparent p-2 font-mono text-xs"
          onChange={(event) => updateArray(event, path, onValue)}
        />
      </FieldShell>
    );
  }
  if (!scalar) return null;
  const type = scalar.type;
  let control: ReactNode;
  if (Array.isArray(schema.enum)) {
    control = (
      <select
        disabled={disabled}
        value={JSON.stringify(value ?? null)}
        className="w-full rounded border bg-transparent p-2 text-sm"
        onChange={(event) => onValue(path, JSON.parse(event.target.value))}
      >
        {schema.enum.map((option) => (
          <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  } else if (type === "boolean") {
    control = (
      <input
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onValue(path, event.target.checked)}
      />
    );
  } else {
    control = (
      <input
        type={type === "string" ? "text" : "number"}
        disabled={disabled}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        min={numberAttribute(schema.minimum)}
        max={numberAttribute(schema.maximum)}
        step={type === "integer" ? 1 : type === "number" ? "any" : undefined}
        className="w-full rounded border bg-transparent p-2 text-sm"
        onChange={(event) =>
          onValue(
            path,
            type === "string" ? event.target.value : Number(event.target.value),
          )
        }
      />
    );
  }
  return (
    <FieldShell schema={schema} label={label}>
      {scalar.nullable && !Array.isArray(schema.enum) && (
        <span className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value === null}
            onChange={(event) =>
              onValue(
                path,
                event.target.checked
                  ? null
                  : defaultScalarValue(schema, scalar.type),
              )
            }
          />
          Use null
        </span>
      )}
      {(value !== null || Array.isArray(schema.enum)) && control}
    </FieldShell>
  );
}

function FieldShell({
  schema,
  label,
  children,
}: {
  readonly schema: JsonObject;
  readonly label?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">
        {fieldTitle(schema, label ?? "value")}
      </span>
      {children}
      {typeof schema.description === "string" && (
        <span className="block text-xs opacity-70">{schema.description}</span>
      )}
    </label>
  );
}

function updateArray(
  event: ChangeEvent<HTMLTextAreaElement>,
  path: readonly string[],
  onValue: (path: readonly string[], value: unknown) => void,
): void {
  try {
    const value: unknown = JSON.parse(event.target.value);
    if (Array.isArray(value)) onValue(path, value);
  } catch {
    // Keep the authoritative raw value unchanged until the array is valid.
  }
}

function setAtPath(
  root: JsonObject,
  path: readonly string[],
  value: unknown,
): JsonObject {
  if (path.length === 0) return isObject(value) ? value : root;
  const [head, ...tail] = path;
  const existing = root[head!];
  const current: JsonObject = isObject(existing) ? existing : {};
  return {
    ...root,
    [head!]: tail.length === 0 ? value : setAtPath(current, tail, value),
  };
}

function scalarType(value: unknown):
  | {
      readonly type: "string" | "boolean" | "number" | "integer";
      readonly nullable: boolean;
    }
  | undefined {
  const candidate = Array.isArray(value)
    ? value.find((item) => item !== "null")
    : value;
  const type =
    candidate === "string" ||
    candidate === "boolean" ||
    candidate === "number" ||
    candidate === "integer"
      ? candidate
      : undefined;
  return type
    ? { type, nullable: Array.isArray(value) && value.includes("null") }
    : undefined;
}

function fieldTitle(schema: JsonObject, fallback: string): string {
  return typeof schema.title === "string" ? schema.title : fallback;
}

function numberAttribute(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function defaultScalarValue(
  schema: JsonObject,
  type: "string" | "boolean" | "number" | "integer",
): string | boolean | number {
  const value = schema.default;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (
    (type === "number" || type === "integer") &&
    typeof schema.minimum === "number"
  ) {
    return schema.minimum;
  }
  if (type === "string") return "";
  if (type === "boolean") return false;
  return 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
