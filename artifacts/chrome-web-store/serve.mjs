import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const root = new URL("./", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const file = pathname === "/source.html" ? join(root, "source.html") : null;
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  createReadStream(file).pipe(response);
});

server.listen(4179, "127.0.0.1", () => {
  console.log("Chrome Web Store asset preview: http://127.0.0.1:4179/source.html");
});
