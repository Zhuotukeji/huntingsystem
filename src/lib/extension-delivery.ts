import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EXTENSION_VERSION = "0.4.0";
export const EXTENSION_FILE_NAME = `hunting-extension-v${EXTENSION_VERSION}.zip`;
export const EXTENSION_ARTIFACT_PATH = join(process.cwd(), "artifacts", EXTENSION_FILE_NAME);
export const EXTENSION_CHECKSUM_PATH = `${EXTENSION_ARTIFACT_PATH}.sha256`;

export function getExtensionDeliveryStatus() {
  const downloadable = existsSync(EXTENSION_ARTIFACT_PATH);
  const checksum = existsSync(EXTENSION_CHECKSUM_PATH)
    ? readFileSync(EXTENSION_CHECKSUM_PATH, "utf8").trim().split(/\s+/)[0]
    : "";
  return { version: EXTENSION_VERSION, fileName: EXTENSION_FILE_NAME, downloadable, checksum };
}
