import { SQLStatement } from "@dsqlbase/core";
import {
  AttributeChange,
  DDLOperationError,
  IndexedDDLOperation,
  OperationAction,
  OperationRisk,
} from "./reconciliation/operations/index.js";

/**
 * One row of a plan report: an operation — one statement — or a refused change. Flat and
 * serializable, so a script can print it, log it as JSON, or post it somewhere.
 */
export type PlanRow = {
  /** Execution order, from 1; `null` for a refusal, which never runs. */
  step: number | null;
  /** The change this row belongs to: every step of one change shares it. */
  change: string;
  /** `"2/3"` — this row's place in its change. */
  changeStep: string;
  subject: string;
  subjectKind: string;
  action: OperationAction;
  target: string | null;
  targetKind: string | null;
  /** What the step changes, as `attribute: from → to`, `;`-separated. */
  changes: string;
  risk: OperationRisk | "refused";
  destructive: boolean;
  async: boolean;
  note: string | null;
  /** The statement, printed; `""` for a refusal. */
  sql: string;
  refusal: { code: string; message: string } | null;
  /**
   * The step won't run under the options the plan was made with: refused, or its risk isn't
   * in `allow`. `false` from `planRows`; the runner sets it.
   */
  blocked: boolean;
};

/** A {@link PlanRow} after `run`: how its statement went. `skipped` follows a failed step. */
export type ExecutedPlanRow = PlanRow & {
  status: "completed" | "failed" | "processing" | "skipped";
  durationMs: number;
  error: string | null;
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export function formatChanges(changes: AttributeChange[]): string {
  return changes
    .map(({ attribute, from, to }) => {
      if (from === null || from === undefined) return `${attribute}: ${formatValue(to)}`;
      return `${attribute}: ${formatValue(from)} → ${formatValue(to)}`;
    })
    .join("; ");
}

const lower = (kind: string) => kind.toLowerCase().replace(/_/g, " ");

/** The rows of a plan: its operations in execution order, then its refusals. */
export function planRows(
  operations: IndexedDDLOperation[],
  errors: DDLOperationError[],
  print: (operation: IndexedDDLOperation) => SQLStatement
): PlanRow[] {
  const rows: PlanRow[] = operations.map((operation, index) => {
    const { summary } = operation;

    return {
      step: index + 1,
      change: summary.change,
      changeStep: `${summary.step}/${summary.steps}`,
      subject: summary.subject.name,
      subjectKind: summary.subject.kind,
      action: summary.action,
      target: summary.target?.name ?? null,
      targetKind: summary.target?.kind ?? null,
      changes: formatChanges(summary.changes),
      risk: summary.risk,
      destructive: summary.risk === "destructive",
      async: summary.async,
      note: summary.note ?? null,
      sql: print(operation).text,
      refusal: null,
      blocked: false,
    };
  });

  for (const error of errors) {
    const summary = error.summary;
    const subjectName = summary?.subject.name ?? error.object.name;

    rows.push({
      step: null,
      change: summary?.target ? `${subjectName}.${summary.target.name}` : subjectName,
      changeStep: "",
      subject: subjectName,
      subjectKind: summary?.subject.kind ?? error.object.kind,
      action: summary?.action ?? "ALTER",
      target: summary?.target?.name ?? error.subject ?? null,
      targetKind: summary?.target?.kind ?? null,
      changes: formatChanges(summary?.changes ?? []),
      risk: "refused",
      destructive: false,
      async: false,
      note: null,
      sql: "",
      refusal: { code: String(error.code), message: error.message },
      blocked: true,
    });
  }

  return rows;
}

export type FormatPlanOptions = {
  /** `text` aligns columns for a terminal; `markdown` is a GitHub table. @default "text" */
  format?: "text" | "markdown";
  /** Adds the statement as the last column. @default false */
  sql?: boolean;
};

/**
 * A plan — `runner.plan()`'s result, `runner.run()`'s, or rows — as a table, followed by the
 * refusals' messages. No dependencies; meant for scripts and CI logs.
 */
export function formatPlan(
  plan: { rows: readonly (PlanRow | ExecutedPlanRow)[] } | readonly (PlanRow | ExecutedPlanRow)[],
  options: FormatPlanOptions = {}
): string {
  const rows = "rows" in plan ? plan.rows : plan;
  const markdown = options.format === "markdown";

  if (rows.length === 0) {
    return "Nothing to do: the database matches the definition.";
  }

  const executed = rows.some((row) => "status" in row);
  const header = ["#", "Subject", "Action", "Target", "Changes", "Risk", "Async"];
  if (executed) header.push("Status");
  if (options.sql) header.push("SQL");

  const body = rows.map((row) => {
    const cells = [
      row.step === null ? "–" : String(row.step),
      `${lower(row.subjectKind)} ${row.subject}`,
      row.changeStep && row.changeStep !== "1/1" ? `${row.action} (${row.changeStep})` : row.action,
      row.target === null
        ? ""
        : row.targetKind
          ? `${lower(row.targetKind)} ${row.target}`
          : row.target,
      row.refusal ? `${row.refusal.code}${row.changes ? `: ${row.changes}` : ""}` : row.changes,
      riskCell(row),
      row.async ? "async" : "",
    ];
    if (executed) cells.push("status" in row ? row.status : "");
    if (options.sql) cells.push(row.sql);
    return cells.map((cell) => cell.replace(/\s+/g, " ").trim());
  });

  const refusals = rows.filter((row) => row.refusal !== null);
  const footer = refusals.map(
    (row) => `Refused ${row.subject}${row.target ? `.${row.target}` : ""}: ${row.refusal?.message}`
  );
  const failures = rows.flatMap((row) =>
    "error" in row && row.error ? [`Failed step ${row.step}: ${row.error}`] : []
  );

  const table = markdown ? markdownTable(header, body) : textTable(header, body);
  return [table, ...(footer.length || failures.length ? ["", ...failures, ...footer] : [])].join(
    "\n"
  );
}

function riskCell(row: PlanRow): string {
  if (row.risk === "refused") return "REFUSED";
  const risk = row.risk === "destructive" ? "DESTRUCTIVE" : row.risk;
  return row.blocked ? `${risk} (not allowed)` : risk;
}

function textTable(header: string[], body: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((cells) => cells[column]?.length ?? 0))
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return [line(header), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join(
    "\n"
  );
}

function markdownTable(header: string[], body: string[][]): string {
  const line = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;

  return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
}
