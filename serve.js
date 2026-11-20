// Servidor local para ver la web de La Chancha: node serve.js  →  http://localhost:5500
const http = require("http"), fs = require("fs"), path = require("path");
const root = __dirname;
const port = +process.argv[2] || 5500;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  else if (!path.extname(p)) p += ".html"; // URLs limpias: /awards → awards.html (igual que en Vercel)
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(b);
  });
}).listen(port, () => console.log("La Chancha en http://localhost:" + port));
