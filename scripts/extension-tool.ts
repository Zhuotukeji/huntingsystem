import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import vm from "node:vm";

const root = process.cwd();
const extensionDirectory = join(root, "extension");
const artifactDirectory = join(root, "artifacts");
const expectedVersion = "0.7.2";
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
  assert(!manifest.side_panel, "side_panel must not be declared; use the standalone workspace window");
  assert(!manifest.content_scripts, "content_scripts are prohibited");
  const permissions = new Set<string>(manifest.permissions || []);
  for (const required of ["activeTab", "storage", "tabCapture", "tabs"]) assert(permissions.has(required), `permission ${required} is required`);
  for (const prohibited of ["sidePanel", "cookies", "scripting", "webRequest", "debugger", "downloads", "history"]) assert(!permissions.has(prohibited), `permission ${prohibited} is prohibited`);
  const hosts: string[] = manifest.host_permissions || [];
  assert(hosts.length === 2 && hosts.includes("http://localhost/*") && hosts.includes("http://127.0.0.1/*"), "host_permissions must be limited to local backend hosts");
  const externalMatches: string[] = manifest.externally_connectable?.matches || [];
  assert(externalMatches.length === 2 && externalMatches.every((match) => hosts.includes(match)), "external connection must be limited to local backend hosts");
  assert(manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self'", "extension CSP is not strict enough");
  for (const size of [16, 32, 48, 128]) {
    const iconPath = join(extensionDirectory, "icons", `icon${size}.png`);
    assert(existsSync(iconPath), `icon${size}.png is missing`);
    const data = readFileSync(iconPath);
    assert(data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), `icon${size}.png is not a PNG`);
    assert(data.readUInt32BE(16) === size && data.readUInt32BE(20) === size, `icon${size}.png dimensions are invalid`);
  }
  for (const required of ["background.js", "sidepanel.html", "sidepanel.css", "capture.css", "fallback.css", "scan-utils.js", "review-mode.js", "sidepanel.js", "synthetic.html", "synthetic.css", "README.md"]) assert(existsSync(join(extensionDirectory, required)), `${required} is missing`);
  for (const script of files(extensionDirectory).filter((path) => path.endsWith(".js"))) new vm.Script(readFileSync(script, "utf8"), { filename: relative(root, script) });
  const source = readFileSync(join(extensionDirectory, "sidepanel.js"), "utf8");
  const backgroundSource = readFileSync(join(extensionDirectory, "background.js"), "utf8");
  assert(backgroundSource.includes("onMessageExternal") && backgroundSource.includes("HUNTING_EXTENSION_PING"), "installation status handshake is missing");
  assert(backgroundSource.includes("chrome.action.onClicked"), "extension action click handler is missing");
  for (const required of ["chrome.windows.get", "chrome.windows.update", "chrome.windows.create", "chrome.storage.session", "workspaceWindowId"]) assert(backgroundSource.includes(required), `standalone workspace window flow is missing: ${required}`);
  assert(!backgroundSource.includes("chrome.windows.getAll"), "workspace launch must not scan every Chrome window");
  assert(backgroundSource.includes("chrome.tabs.create") && backgroundSource.includes("chrome.runtime.getURL(WORKSPACE_PATH)"), "workspace tab fallback is missing");
  for (const prohibited of ["chrome.sidePanel", "setPanelBehavior", "side_panel"]) assert(!backgroundSource.includes(prohibited), `side panel implementation must not be reintroduced: ${prohibited}`);
  assert(source.includes("state.sourceWindowId") && source.includes("{ active: true, windowId: state.sourceWindowId }"), "workspace actions must target the original Chrome window");
  const searchPhraseSource = source.slice(source.indexOf("function searchPhrase"), source.indexOf("function renderTasks"));
  assert(searchPhraseSource.includes("slice(0, 1)") && !searchPhraseSource.includes("locations"), "task copy must use one broad keyword without an inline location");
  assert(source.includes("sourceTabId") && source.includes("sourceTabUrl") && source.includes('status: "authorizing"'), "capture authorization context or waiting state is missing");
  assert(source.includes("HUNTING_SOURCE_CONTEXT") && source.includes("window.setTimeout(startResumeScan, 0)"), "capture must resume after the target tab action click");
  for (const prohibited of ["chrome.cookies", "chrome.scripting", "executeScript", "chrome.webRequest", "document.cookie"]) assert(!source.includes(prohibited), `prohibited API reference found: ${prohibited}`);
  assert(source.includes("captureVisibleTab") && source.includes("window.confirm"), "visible screenshot confirmation flow is missing");
  assert(source.includes("chrome.tabCapture.getMediaStreamId") && source.includes("targetTabId: tabId"), "resume scan must request a stream for the selected tab id");
  assert(source.includes("navigator.mediaDevices.getUserMedia") && source.includes('chromeMediaSource: "tab"') && source.includes('chromeMediaSourceId: streamId'), "target tab stream constraints are missing");
  assert(source.includes('scanner.mode = "target-tab"'), "target tab capture mode is missing");
  assert(!source.includes("getDisplayMedia"), "ambiguous screen sharing must not be used");
  const startScanSource = source.slice(source.indexOf("async function startResumeScan"), source.indexOf("async function processReviewScanFrames"));
  assert(startScanSource.includes("startTargetTabCapture") && !startScanSource.includes("captureVisibleTab"), "resume scan must only use the targeted tab stream");
  for (const removed of ["captureVisibleTabFrame", "tab-share", "visible-tab", "scan-video", '"<all_urls>"']) assert(!source.includes(removed), `prohibited capture path or broad permission is still present: ${removed}`);
  const sidepanelHtml = readFileSync(join(extensionDirectory, "sidepanel.html"), "utf8");
  assert(sidepanelHtml.includes("scan-preview-image") && sidepanelHtml.includes("scan-preview-thumbnails"), "in-memory frame gallery is missing");
  assert(source.includes("selectScannerPreview") && source.includes("processingFrames"), "frame gallery selection or processing state is missing");
  assert(sidepanelHtml.includes('id="scan-capture"') && source.includes("captureCurrentFrame"), "explicit frame capture button is missing");
  for (const removed of ["HUNTING_SCAN_ENTER", "HUNTING_SCAN_KEY_ENABLE", "handleScanKeydown", "startScanKeyBridge"]) assert(!source.includes(removed), `keyboard capture bridge is still present: ${removed}`);
  assert(source.includes("取景预览 · 尚未计入帧") && source.includes("setupPreview"), "uncounted setup preview is missing");
  assert(!source.includes("SCAN_INTERVAL_MS") && !source.includes("sampleTimer"), "periodic resume screenshots must be disabled");
  const finishSource = source.slice(source.indexOf("async function finishResumeScan"), source.indexOf("async function retryScanRecognition"));
  assert(!finishSource.includes("captureScanFrame("), "finishing a scan must not capture an extra frame");
  assert(source.includes("所有关键帧均未识别"), "resume scan must skip invalid leading frames");
  assert(!source.includes("首帧识别失败"), "one invalid leading frame must not abort the entire resume scan");
  const scanUtilsSource = readFileSync(join(extensionDirectory, "scan-utils.js"), "utf8");
  const scanContext: { HuntingScanUtils?: { fingerprintDifference: (left: number[], right: number[]) => number; selectKeyframes: <T>(frames: T[], maximum: number) => T[] } } = {};
  vm.runInNewContext(scanUtilsSource, scanContext, { filename: "extension/scan-utils.js" });
  const scanUtils = scanContext.HuntingScanUtils;
  assert(scanUtils && source.includes("selectKeyframes") && source.includes("MAX_UPLOAD_FRAMES = 10"), "keyframe selection and upload limit are missing");
  const sampleFrames = Array.from({ length: 25 }, (_, index) => index);
  const selectedFrames = scanUtils.selectKeyframes(sampleFrames, 10);
  assert(selectedFrames.length === 10 && selectedFrames[0] === 0 && selectedFrames.at(-1) === 24, "keyframe selection must preserve the first and last frames");
  assert(scanUtils.fingerprintDifference([10, 20], [10, 20]) === 0 && scanUtils.fingerprintDifference([10, 20], [20, 40]) === 15, "fingerprint difference is invalid");
  const reviewModeSource = readFileSync(join(extensionDirectory, "review-mode.js"), "utf8");
  const reviewContext: { HuntingReviewMode?: { createCampaigns: () => Array<{ id: string }>; createTasks: () => Array<{ id: string; status: string }>; analyzeVisibleScreenshot: (value: string) => { candidates: Array<{ alias: string }>; note: string }; greetingDraft: () => string; scanResult: (count: number) => { frameCount: number } } } = {};
  vm.runInNewContext(reviewModeSource, reviewContext, { filename: "extension/review-mode.js" });
  const reviewMode = reviewContext.HuntingReviewMode;
  assert(reviewMode && reviewMode.createCampaigns().length === 1 && reviewMode.createTasks().length >= 2, "review mode fixtures are incomplete");
  assert(reviewMode.createTasks().every((task) => task.status === "NEW"), "review mode tasks must reset safely");
  assert(reviewMode.analyzeVisibleScreenshot("data:image/jpeg;base64,synthetic").candidates[0]?.alias.includes("合成"), "review mode screenshot result must be synthetic");
  assert(reviewMode.greetingDraft().includes("合成草稿") && reviewMode.scanResult(7).frameCount === 7, "review mode greeting or scan result is invalid");
  assert(!reviewModeSource.includes("fetch(") && !reviewModeSource.includes("chrome."), "review fixtures must not access network or Chrome data");
  assert(source.includes("enterReviewMode") && source.includes("processReviewScanFrames") && source.includes("商店审核模式只允许使用插件内置的合成演示页"), "offline store review flow is incomplete");
  assert(source.includes("reviewFixtures.analyzeVisibleScreenshot") && source.includes("reviewFixtures.greetingDraft"), "review screenshot and greeting branches are missing");
  assert(source.includes("SCAN_MAX_DURATION_MS = 60_000"), "scan duration limit is missing");
  assert(!source.includes("MediaRecorder"), "resume scans must not create video files");
  for (const removed of ["resume-file", "uploadResume", "/api/plugin/resumes"]) assert(!source.includes(removed), `removed resume import flow is still present: ${removed}`);
  for (const removed of ["capture-screen", "undo-capture", "finalize-capture"]) assert(!source.includes(removed), `manual multi-screen control is still present: ${removed}`);
  assert(source.includes("/api/plugin/resume-capture/segment") && source.includes("/api/plugin/resume-capture/finalize"), "multi-screen resume capture flow is incomplete");
  assert(source.includes('const DEFAULT_BACKENDS = ["http://localhost:3000"]'), "backend must only connect to localhost:3000");
  assert(source.includes('const SUPPORTED_BACKEND_VERSION = "0.7.1"') && source.includes("result.data.version === SUPPORTED_BACKEND_VERSION"), "backend compatibility check is missing");
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
