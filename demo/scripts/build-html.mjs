// index.template.html + assets/states.json → index.html (states inlined: no render-time fetch)
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("..", import.meta.url);
const tpl = readFileSync(new URL("scripts/index.template.html", dir), "utf8");
const data = readFileSync(new URL("assets/states.json", dir), "utf8");
writeFileSync(new URL("index.html", dir), tpl.replace("/*STATES*/ null", data));
console.log("index.html written");
