import { createHash } from "node:crypto";

export function normalizeMigration(contents: string): string {
  return contents.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
    .split("\n").filter((line) => !line.trim().startsWith(">"))
    .join("\n").trim() + "\n";
}

export function migrationSha256(contents: string): string {
  return createHash("sha256").update(normalizeMigration(contents)).digest("hex");
}
