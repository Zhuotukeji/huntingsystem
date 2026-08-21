import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getChromeDistributionSettings } from "@/lib/settings";

export const EXTENSION_VERSION = "0.5.0";
export const EXTENSION_FILE_NAME = `hunting-extension-v${EXTENSION_VERSION}.zip`;
export const EXTENSION_ARTIFACT_PATH = join(process.cwd(), "artifacts", EXTENSION_FILE_NAME);
export const EXTENSION_CHECKSUM_PATH = `${EXTENSION_ARTIFACT_PATH}.sha256`;

export function getExtensionDeliveryStatus() {
  const downloadable = existsSync(EXTENSION_ARTIFACT_PATH);
  const checksum = existsSync(EXTENSION_CHECKSUM_PATH)
    ? readFileSync(EXTENSION_CHECKSUM_PATH, "utf8").trim().split(/\s+/)[0]
    : "";
  const distribution = getChromeDistributionSettings();
  return {
    version: EXTENSION_VERSION,
    fileName: EXTENSION_FILE_NAME,
    downloadable,
    checksum,
    ...distribution,
    deliveryMode: distribution.webStoreUrl ? "WEB_STORE" as const : "SIDELOAD" as const,
  };
}
