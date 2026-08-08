import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "src", "index.html");
const distDir = join(__dirname, "dist");
const dest = join(distDir, "index.html");

mkdirSync(distDir, { recursive: true });
copyFileSync(src, dest);

console.log("Built", dest);
