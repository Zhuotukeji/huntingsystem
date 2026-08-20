import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import vm from "node:vm";

const root = process.cwd();
const extensionDirectory = join(root, "extension");
const artifactDirectory = join(root, "artifacts");
const expectedVersion = "0.3.0";
const artifactName = `hunting-extension-v${expectedVersion}.zip`;

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function check() {
  const manifestPath = join(extensionDirectory, "manifest.json");
  assert(existsSync(manifestPath), "extension/manifest.json is missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert(manifest.manifest_version === 3, "manifest_version must be 3");
  assert(manifest.version === expectedVersion, `manifest version must be ${expectedVersion}`);
  assert(manifest.side_panel?.default_path === "sidepanel.html", "side panel entry is missing");
  assert(!manifest.content_scripts, "content_scripts are prohibited");
  const permissions = new Set<string>(manifest.permissions || []);
  for (const required of ["activeTab", "storage", "sidePanel", "tabs"]) assert(permissions.has(required), `permission ${required} is required`);
  for (const prohibited of ["cookies", "scripting", "webRequest", "debugger", "downloads", "history"]) assert(!permissions.has(prohibited), `permission ${prohibited} is prohibited`);
  const hosts: string[] = manifest.host_permissions || [];
  assert(hosts.length === 2 && hosts.includes("http://localhost/*") && hosts.includes("http://127.0.0.1/*"), "host_permissions must be limited to local backend hosts");
  assert(manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self'", "extension CSP is not strict enough");
  for (const size of [16, 32, 48, 128]) {
    const iconPath = join(extensionDirectory, "icons", `icon${size}.png`);
    assert(existsSync(iconPath), `icon${size}.png is missing`);
    const data = readFileSync(iconPath);
    assert(data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), `icon${size}.png is not a PNG`);
    assert(data.readUInt32BE(16) === size && data.readUInt32BE(20) === size, `icon${size}.png dimensions are invalid`);
  }
  for (const required of ["background.js", "sidepanel.html", "sidepanel.css", "capture.css", "sidepanel.js", "synthetic.html", "synthetic.css", "README.md"]) assert(existsSync(join(extensionDirectory, required)), `${required} is missing`);
  for (const script of files(extensionDirectory).filter((path) => path.endsWith(".js"))) new vm.Script(readFileSync(script, "utf8"), { filename: relative(root, script) });
  const source = readFileSync(join(extensionDirectory, "sidepanel.js"), "utf8");
  for (const prohibited of ["chrome.cookies", "chrome.scripting", "executeScript", "chrome.webRequest", "document.cookie"]) assert(!source.includes(prohibited), `prohibited API reference found: ${prohibited}`);
  assert(source.includes("captureVisibleTab") && source.includes("window.confirm"), "visible screenshot confirmation flow is missing");
  assert(source.includes("chrome.storage.session"), "temporary extracted-text session storage is missing");
  for (const removed of ["resume-file", "uploadResume", "/api/plugin/resumes"]) assert(!source.includes(removed), `removed resume import flow is still present: ${removed}`);
  assert(source.includes("/api/plugin/resume-capture/segment") && source.includes("/api/plugin/resume-capture/finalize"), "multi-screen resume capture flow is incomplete");
  assert(source.includes("localhost:3010") && source.includes("localhost:3000"), "backend auto-discovery ports are missing");
  assert(source.includes("result.data.version === chrome.runtime.getManifest().version"), "backend compatibility check is missing");
  console.log(`Extension check passed: MV3 v${expectedVersion}, ${files(extensionDirectory).length} files`);
}

function u16(value: number) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value: number) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }

function zip(entries: Array<{ name: string; data: Buffer }>) {
  const localParts: Buffer[] = []; const centralParts: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"); const crc = crc32(entry.data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data]);
    const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    localParts.push(local); centralParts.push(central); offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  return Buffer.concat([...localParts, central, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);
}

function pack() {
  check();
  const entries = files(extensionDirectory).sort().map((path) => ({ name: relative(extensionDirectory, path).replaceAll("\\", "/"), data: readFileSync(path) }));
  const archive = zip(entries); const checksum = createHash("sha256").update(archive).digest("hex");
  mkdirSync(artifactDirectory, { recursive: true }); const archivePath = join(artifactDirectory, artifactName);
  writeFileSync(archivePath, archive); writeFileSync(`${archivePath}.sha256`, `${checksum}  ${basename(archivePath)}\n`);
  console.log(`Packed ${relative(root, archivePath)} (${archive.length} bytes)`); console.log(`SHA-256 ${checksum}`);
}

const operation = process.argv[2];
if (operation === "check") check(); else if (operation === "pack") pack(); else throw new Error("Usage: tsx scripts/extension-tool.ts <check|pack>");
