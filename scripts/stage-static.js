const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public");

function copy(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
["index.html", "css", "js", "data", "vendor", "dist"].forEach(copy);
const jsDir = path.join(OUT, "js");
for (const name of fs.readdirSync(jsDir)) {
  if (!/^(spr|rich|seal|store|analysis|app)\.js$/.test(name)) fs.rmSync(path.join(jsDir, name));
}
console.log("Staged static site in public/");
