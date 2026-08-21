import { createReadStream, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const contentTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (pathname === "/sidepanel.html") {
    const source = readFileSync(join(root, "extension", "sidepanel.html"), "utf8")
      .replaceAll('href="sidepanel.css"', 'href="/extension/sidepanel.css"')
      .replaceAll('href="capture.css"', 'href="/extension/capture.css"')
      .replaceAll('src="icons/', 'src="/extension/icons/')
      .replace('<script src="scan-utils.js"></script>', '<script src="/tests/extension-review-browser-mock.js"></script><script src="/extension/scan-utils.js"></script>')
      .replace('<script src="review-mode.js"></script>', '<script src="/extension/review-mode.js"></script>')
      .replace('<script src="sidepanel.js"></script>', '<script src="/extension/sidepanel.js"></script>');
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(source);
    return;
  }
  const relative = pathname.replace(/^\//, "");
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || (!relative.startsWith("extension/") && !relative.startsWith("tests/"))) {
    response.writeHead(404); response.end("Not found"); return;
  }
  response.writeHead(200, { "Content-Type": contentTypes[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(file).on("error", () => { response.destroy(); }).pipe(response);
});

server.listen(4186, "127.0.0.1", () => console.log("Extension review harness: http://127.0.0.1:4186/sidepanel.html"));
