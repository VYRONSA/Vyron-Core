/**
 * A Supabase-client-shaped TRANSPORT over real PostgreSQL, for service-layer
 * integration tests.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * This is NOT a mock of the database. Every call here is translated into real SQL and
 * executed by a real PostgreSQL server via psql. Row level security, tenant isolation
 * policies, CHECK constraints, composite foreign keys, append-only triggers and grants
 * all apply exactly as they do in production — which is the entire point: the Phase 0-2
 * suites proved the schema and the pure functions, and this closes the gap by running
 * the ACTUAL service-layer functions against an ACTUAL database.
 *
 * What IS replaced is only the TRANSPORT. In production the Supabase client speaks to
 * PostgREST over HTTP; here the same query-builder surface speaks to psql. The service
 * layer cannot tell the difference, and nothing about the security model is bypassed.
 *
 * ---------------------------------------------------------------------------
 * IDENTITY
 * ---------------------------------------------------------------------------
 *
 * Every statement runs under `SET LOCAL ROLE` plus `request.jwt.claims`, exactly as
 * PostgREST establishes identity for RLS. Running as `authenticated` with a tenant's
 * claims means the policies are genuinely enforced during these tests; running as the
 * owner is available only for fixture setup, and is named explicitly where used.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 *
 * Implements only the subset the Road & Recovery service layer actually uses:
 *   from · select · insert · update · upsert · delete
 *   eq · in · ilike · order · limit · single · maybeSingle
 *
 * Anything outside that throws loudly rather than silently returning the wrong thing —
 * a test harness that quietly guesses is worse than no harness at all.
 *
 * TEST-ONLY. Values are inlined as escaped SQL literals rather than bound parameters,
 * which is acceptable for controlled fixtures and is never used by application code.
 */

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Distinguishes concurrent statement files within one test process. */
let scriptCounter = 0;

export type PgTransportConfig = {
  psqlPath: string;
  host: string;
  port: string;
  user: string;
  database: string;
};

export type PgIdentity =
  | { kind: "owner" }
  | { kind: "authenticated"; email: string }
  | { kind: "service_role" }
  | { kind: "anon" };

type Row = Record<string, unknown>;

export class PgTransportError extends Error {
  sql: string;

  constructor(message: string, sql: string) {
    super(message);
    this.name = "PgTransportError";
    this.sql = sql;
  }
}

// ---------------------------------------------------------------------------
// SQL literal rendering
// ---------------------------------------------------------------------------

function literal(value: unknown, columnType?: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "object") {
    // A Postgres ARRAY column (udt_name '_text', '_uuid', …) and a jsonb column both
    // receive a JavaScript array, so the COLUMN TYPE has to decide the rendering —
    // exactly as PostgREST does it. Rendering every array as ::jsonb silently broke
    // text[] columns such as blocking_scopes and missing_codes.
    if (Array.isArray(value) && columnType && columnType.startsWith("_")) {
      const items = (value as unknown[])
        .map((entry) => `"${String(entry).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",");
      return `'{${items.replace(/'/g, "''")}}'`;
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function identifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier in test transport: ${name}`);
  }
  return `"${name}"`;
}

/** "id, company_id" or "*" -> a safe select list. */
function selectList(columns: string): string {
  const trimmed = (columns || "*").trim();
  if (trimmed === "*") return "*";
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => identifier(part))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function identityPrelude(identity: PgIdentity): string {
  switch (identity.kind) {
    case "owner":
      return "";
    case "anon":
      return "SET LOCAL ROLE anon;";
    case "service_role":
      return `SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);`;
    case "authenticated":
      return `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', ${literal(
        JSON.stringify({ email: identity.email, role: "authenticated" })
      )}, true);`;
  }
}

/**
 * Runs a statement and returns its rows as JSON.
 *
 * Wrapped in an explicit transaction so SET LOCAL ROLE applies, and so a failed
 * statement rolls back rather than leaving a half-applied fixture behind.
 */
function runSql(
  config: PgTransportConfig,
  identity: PgIdentity,
  sql: string
): { rows: Row[]; error: { message: string; code: string } | null } {
  // A data-modifying statement cannot be used as a sub-select, so INSERT/UPDATE/DELETE
  // go into a CTE while a plain SELECT stays a subquery.
  const modifies = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);
  const collect = modifies
    ? `WITH __q AS (${sql}) SELECT coalesce(json_agg(row_to_json(__q)), '[]'::json)::text AS __rows FROM __q;`
    : `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)::text AS __rows FROM (${sql}) t;`;

  const wrapped = ["BEGIN;", identityPrelude(identity), collect, "COMMIT;"]
    .filter(Boolean)
    .join("\n");

  // The statement goes to psql through a UTF-8 FILE rather than through -c.
  //
  // On Windows a command-line argument reaches psql through the ANSI codepage, so any
  // non-ASCII character — an em dash in a requirement's guidance text, say — arrives as a
  // single CP1252 byte and PostgreSQL rejects it as "invalid byte sequence for encoding
  // UTF8". A file is read with the client encoding declared below, so the text survives.
  const scriptPath = path.join(
    os.tmpdir(),
    `rr-pg-transport-${process.pid}-${scriptCounter++}.sql`
  );
  writeFileSync(scriptPath, wrapped, { encoding: "utf8" });

  try {
    const output = execFileSync(
      config.psqlPath,
      [
        "-h",
        config.host,
        "-p",
        config.port,
        "-U",
        config.user,
        "-d",
        config.database,
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-q",
        "-f",
        scriptPath,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PGCLIENTENCODING: "UTF8" },
      }
    );

    // The json_agg line is the only tuple output; SET/BEGIN/COMMIT produce none with -q.
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
    const payload = lines[lines.length - 1] ?? "[]";
    return { rows: JSON.parse(payload) as Row[], error: null };
  } catch (caught: unknown) {
    const stderr = String(
      (caught as { stderr?: Buffer | string })?.stderr ?? (caught as Error)?.message ?? caught
    );
    const message = stderr
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("ERROR:"))
      ?.replace(/^ERROR:\s*/, "");
    return {
      rows: [],
      error: {
        message: message || stderr.trim() || "Unknown database error",
        // Enough of a shape for isSupabaseMissingTableError()-style checks.
        code: /does not exist/i.test(stderr) ? "42P01" : "P0001",
      },
    };
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

/** Executes statements verbatim. No wrapping, so DDL and multi-statement scripts work. */
function runRaw(
  config: PgTransportConfig,
  identity: PgIdentity,
  statements: string
): { error: { message: string; code: string } | null } {
  const wrapped = ["BEGIN;", identityPrelude(identity), statements, ";", "COMMIT;"]
    .filter(Boolean)
    .join("\n");

  const scriptPath = path.join(
    os.tmpdir(),
    `rr-pg-transport-raw-${process.pid}-${scriptCounter++}.sql`
  );
  writeFileSync(scriptPath, wrapped, { encoding: "utf8" });

  try {
    execFileSync(
      config.psqlPath,
      [
        "-h", config.host,
        "-p", config.port,
        "-U", config.user,
        "-d", config.database,
        "-v", "ON_ERROR_STOP=1",
        "-At", "-q",
        "-f", scriptPath,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PGCLIENTENCODING: "UTF8" },
      }
    );
    return { error: null };
  } catch (caught: unknown) {
    const stderr = String(
      (caught as { stderr?: Buffer | string })?.stderr ?? (caught as Error)?.message ?? caught
    );
    const message = stderr
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("ERROR:"))
      ?.replace(/^ERROR:\s*/, "");
    return { error: { message: message || stderr.trim() || "Unknown database error", code: "P0001" } };
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Filter = {
  column: string;
  op: "eq" | "in" | "ilike" | "neq" | "is" | "not" | "gt" | "gte" | "lt" | "lte";
  value: unknown;
};

type Pending =
  | { kind: "select"; columns: string }
  | { kind: "insert"; rows: Row[]; returning: string | null }
  | { kind: "upsert"; rows: Row[]; onConflict: string; returning: string | null }
  | { kind: "update"; patch: Row; returning: string | null }
  | { kind: "delete"; returning: string | null };

/**
 * Column types per table, read once from the live database.
 *
 * The transport has to know whether a JavaScript array is destined for a text[] column or
 * a jsonb one. PostgREST answers that from the schema; so does this, rather than guessing
 * from the shape of the value.
 */
const columnTypeCache = new Map<string, Record<string, string>>();

function columnTypes(config: PgTransportConfig, table: string): Record<string, string> {
  const key = `${config.database}.${table}`;
  const cached = columnTypeCache.get(key);
  if (cached) return cached;

  const { rows } = runSql(
    config,
    { kind: "owner" },
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, "''")}'`
  );

  const types: Record<string, string> = {};
  for (const row of rows) {
    types[String((row as Row).column_name)] = String((row as Row).udt_name);
  }
  columnTypeCache.set(key, types);
  return types;
}

class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean }[] = [];
  private limitValue: number | null = null;
  private singleMode: "one" | "maybe" | null = null;

  private config: PgTransportConfig;
  private identity: PgIdentity;
  private table: string;
  private pending: Pending;

  constructor(
    config: PgTransportConfig,
    identity: PgIdentity,
    table: string,
    pending: Pending
  ) {
    this.config = config;
    this.identity = identity;
    this.table = table;
    this.pending = pending;
  }

  select(columns = "*"): this {
    if (this.pending.kind === "select") {
      this.pending = { kind: "select", columns };
    } else {
      // .insert(...).select(...) / .update(...).select(...) -> RETURNING
      this.pending = { ...this.pending, returning: columns } as Pending;
    }
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ column, op: "neq", value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }

  ilike(column: string, value: unknown): this {
    this.filters.push({ column, op: "ilike", value });
    return this;
  }

  /** PostgREST's IS filter: `.is(column, null)` is how supabase-js expresses IS NULL. */
  is(column: string, value: unknown): this {
    this.filters.push({ column, op: "is", value });
    return this;
  }

  /** PostgREST's negation: `.not(column, "is", null)` expresses IS NOT NULL. */
  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is") {
      throw new Error(`Unsupported .not() operator in test transport: ${operator}`);
    }
    this.filters.push({ column, op: "not", value });
    return this;
  }

  /**
   * Range filters, needed by any query bounded to a date window.
   *
   * PostgREST renders these as simple comparisons, and so does this transport. They exist
   * here because Phase 6 intelligence bounds every fact query by an explicit window, and a
   * transport that silently lacked them would have made those bounds untestable.
   */
  gt(column: string, value: unknown): this {
    this.filters.push({ column, op: "gt", value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: "gte", value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: "lt", value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: "lte", value });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orderBy.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }

  single(): this {
    this.singleMode = "one";
    return this;
  }

  private whereClause(): string {
    if (this.filters.length === 0) return "";
    const parts = this.filters.map((filter) => {
      const column = identifier(filter.column);
      if (filter.op === "in") {
        const values = (filter.value as unknown[]) ?? [];
        if (values.length === 0) return "false";
        return `${column} IN (${values.map((entry) => literal(entry)).join(", ")})`;
      }
      if (filter.op === "ilike") return `${column} ILIKE ${literal(filter.value)}`;
      if (filter.op === "not") {
        if (filter.value === null) return `${column} IS NOT NULL`;
        if (filter.value === true) return `${column} IS NOT TRUE`;
        if (filter.value === false) return `${column} IS NOT FALSE`;
        throw new Error(`Unsupported .not() value in test transport: ${String(filter.value)}`);
      }
      if (filter.op === "is") {
        if (filter.value === null) return `${column} IS NULL`;
        if (filter.value === true) return `${column} IS TRUE`;
        if (filter.value === false) return `${column} IS FALSE`;
        throw new Error(`Unsupported .is() value in test transport: ${String(filter.value)}`);
      }
      if (filter.op === "gt" || filter.op === "gte" || filter.op === "lt" || filter.op === "lte") {
        // A range comparison against NULL is never true. Rendering it as such keeps the
        // transport honest rather than quietly dropping the bound.
        if (filter.value === null) return "false";
        const symbol =
          filter.op === "gt" ? ">" : filter.op === "gte" ? ">=" : filter.op === "lt" ? "<" : "<=";
        return `${column} ${symbol} ${literal(filter.value)}`;
      }
      if (filter.op === "neq") {
        return filter.value === null ? `${column} IS NOT NULL` : `${column} <> ${literal(filter.value)}`;
      }
      return filter.value === null ? `${column} IS NULL` : `${column} = ${literal(filter.value)}`;
    });
    return ` WHERE ${parts.join(" AND ")}`;
  }

  private tail(): string {
    let sql = "";
    if (this.orderBy.length > 0) {
      sql += ` ORDER BY ${this.orderBy
        .map((entry) => `${identifier(entry.column)} ${entry.ascending ? "ASC" : "DESC"}`)
        .join(", ")}`;
    }
    if (this.limitValue !== null) sql += ` LIMIT ${Number(this.limitValue)}`;
    return sql;
  }

  private buildSql(): string {
    const table = `public.${identifier(this.table)}`;

    if (this.pending.kind === "select") {
      return `SELECT ${selectList(this.pending.columns)} FROM ${table}${this.whereClause()}${this.tail()}`;
    }

    if (this.pending.kind === "insert" || this.pending.kind === "upsert") {
      const rows = this.pending.rows;
      if (rows.length === 0) return `SELECT 1 WHERE false`;
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const types = columnTypes(this.config, this.table);
      const values = rows
        .map(
          (row) =>
            `(${columns
              .map((column) => literal(row[column] ?? null, types[column]))
              .join(", ")})`
        )
        .join(", ");
      let sql = `INSERT INTO ${table} (${columns.map(identifier).join(", ")}) VALUES ${values}`;

      if (this.pending.kind === "upsert") {
        const conflictColumns = this.pending.onConflict
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map(identifier)
          .join(", ");
        const conflictSet = new Set(
          this.pending.onConflict.split(",").map((part) => part.trim()).filter(Boolean)
        );
        // The conflict key itself is not re-assigned; everything else is overwritten,
        // which is what Supabase's upsert does.
        const updates = columns
          .filter((column) => !conflictSet.has(column))
          .map((column) => `${identifier(column)} = EXCLUDED.${identifier(column)}`)
          .join(", ");
        sql += updates
          ? ` ON CONFLICT (${conflictColumns}) DO UPDATE SET ${updates}`
          : ` ON CONFLICT (${conflictColumns}) DO NOTHING`;
      }

      const returning = this.pending.returning;
      sql += ` RETURNING ${returning ? selectList(returning) : "*"}`;
      return sql;
    }

    if (this.pending.kind === "update") {
      const patch = this.pending.patch;
      const types = columnTypes(this.config, this.table);
      const assignments = Object.keys(patch)
        .map((column) => `${identifier(column)} = ${literal(patch[column], types[column])}`)
        .join(", ");
      const returning = this.pending.returning;
      return `UPDATE ${table} SET ${assignments}${this.whereClause()} RETURNING ${
        returning ? selectList(returning) : "*"
      }`;
    }

    const returning = this.pending.returning;
    return `DELETE FROM ${table}${this.whereClause()} RETURNING ${
      returning ? selectList(returning) : "*"
    }`;
  }

  private execute(): { data: unknown; error: unknown } {
    const sql = this.buildSql();
    const { rows, error } = runSql(this.config, this.identity, sql);

    if (error) {
      return { data: null, error: { message: error.message, code: error.code, details: sql } };
    }

    if (this.singleMode === "one") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: {
            message:
              rows.length === 0
                ? "JSON object requested, multiple (or no) rows returned"
                : "Multiple rows returned for single()",
            code: "PGRST116",
          },
        };
      }
      return { data: rows[0], error: null };
    }

    if (this.singleMode === "maybe") {
      if (rows.length > 1) {
        return { data: null, error: { message: "Multiple rows returned", code: "PGRST116" } };
      }
      return { data: rows[0] ?? null, error: null };
    }

    return { data: rows, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    try {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    } catch (caught: unknown) {
      return Promise.reject(caught).then(onfulfilled, onrejected) as PromiseLike<TResult2>;
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type PgTestClient = {
  from: (table: string) => {
    select: (columns?: string) => QueryBuilder;
    insert: (rows: Row | Row[]) => QueryBuilder;
    upsert: (rows: Row | Row[], options?: { onConflict?: string }) => QueryBuilder;
    update: (patch: Row) => QueryBuilder;
    delete: () => QueryBuilder;
  };
  /** Raw escape hatch for fixtures and assertions. Runs as the given identity. */
  sql: (statement: string, identity?: PgIdentity) => Row[];
  /**
   * Runs statements verbatim, with no row collection.
   *
   * `sql()` wraps its statement so it can return JSON rows, which DDL and multi-statement
   * scripts cannot be wrapped in. Use this for a test that needs to CREATE or DROP
   * something — simulating an infrastructure failure, for instance.
   */
  exec: (statements: string, identity?: PgIdentity) => void;
  identity: PgIdentity;
};

/**
 * Builds a client that talks to a real PostgreSQL database as a specific identity.
 *
 * Pass this straight into the service-layer functions: they accept a SupabaseClient and
 * use only the query-builder surface implemented above.
 */
export function createPgTestClient(
  config: PgTransportConfig,
  identity: PgIdentity = { kind: "owner" }
): PgTestClient {
  return {
    identity,
    exec(statements: string, execIdentity: PgIdentity = identity) {
      const { error } = runRaw(config, execIdentity, statements);
      if (error) throw new PgTransportError(error.message, statements);
    },
    from(table: string) {
      return {
        select: (columns = "*") =>
          new QueryBuilder(config, identity, table, { kind: "select", columns }),
        insert: (rows: Row | Row[]) =>
          new QueryBuilder(config, identity, table, {
            kind: "insert",
            rows: Array.isArray(rows) ? rows : [rows],
            returning: null,
          }),
        upsert: (rows: Row | Row[], options: { onConflict?: string } = {}) =>
          new QueryBuilder(config, identity, table, {
            kind: "upsert",
            rows: Array.isArray(rows) ? rows : [rows],
            onConflict: options.onConflict || "id",
            returning: null,
          }),
        update: (patch: Row) =>
          new QueryBuilder(config, identity, table, { kind: "update", patch, returning: null }),
        delete: () => new QueryBuilder(config, identity, table, { kind: "delete", returning: null }),
      };
    },
    sql(statement: string, as: PgIdentity = identity): Row[] {
      const { rows, error } = runSql(config, as, statement);
      if (error) throw new PgTransportError(error.message, statement);
      return rows;
    },
  };
}

/**
 * Reads the disposable-database configuration from the environment.
 *
 * Returns null when it is absent, so the integration suite SKIPS rather than fails on a
 * machine with no PostgreSQL. It never falls back to a default connection, so it cannot
 * accidentally reach a real project.
 */
export function readTestDatabaseConfig(): PgTransportConfig | null {
  const psqlPath = process.env.RR_TEST_PSQL;
  const database = process.env.RR_TEST_DB;
  if (!psqlPath || !database) return null;

  return {
    psqlPath,
    database,
    host: process.env.RR_TEST_PGHOST || "127.0.0.1",
    port: process.env.RR_TEST_PGPORT || "55432",
    user: process.env.RR_TEST_PGUSER || "postgres",
  };
}
