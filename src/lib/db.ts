import { neon } from "@neondatabase/serverless";

type NeonSql = ReturnType<typeof neon>;
let cached: NeonSql | null = null;

function client(): NeonSql {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  cached = neon(url);
  return cached;
}

export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  client()(strings, ...values)) as NeonSql;
