/**
 * Write dist/icms-sat-practice.html with CSS, KaTeX, fonts, data, and figures inlined.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "registry.json"), "utf8"));
const subjects = registry.subjects.map(function (entry) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), "utf8"));
});

function embedFonts(css) {
  return css.replace(/url\(fonts\/([^)]+\.woff2)\)/g, function (_match, file) {
    const buf = fs.readFileSync(path.join(ROOT, "vendor", "katex", "fonts", file));
    return "url(data:font/woff2;base64," + buf.toString("base64") + ")";
  });
}

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_match, href) {
  let css = fs.readFileSync(path.join(ROOT, href), "utf8");
  if (href.indexOf("katex") >= 0) css = embedFonts(css);
  css = css.replace(/<\/style/gi, "<\\/style");
  return "<style>" + css + "</style>";
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (_match, href) {
  const js = fs.readFileSync(path.join(ROOT, href), "utf8").replace(/<\/script/gi, "<\\/script");
  return "<script>" + js + "</script>";
});
const payload = JSON.stringify({ subjects: subjects })
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");
html = html.replace("<!--ICMS_DATA-->", "<script>window.ICMS_DATA=" + payload + ";</script>");
html = "<!-- ICMS Practice single-file build. Open in a browser. Works offline. -->\n" + html;

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "icms-sat-practice.html");
fs.writeFileSync(out, html);
const bytes = fs.statSync(out).size;
console.log("Wrote " + out + " (" + (bytes / 1048576).toFixed(2) + " MB)");
