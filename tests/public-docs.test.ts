import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readPackageFile(relativePath: string): Promise<string> {
  return readFile(join(packageRoot, relativePath), "utf8");
}

test("README makes the public MIT source posture and npm boundary explicit", async () => {
  const readme = await readPackageFile("README.md");

  assert.match(readme, /public GitHub/i);
  assert.match(readme, /MIT License/i);
  assert.match(readme, /private: true/i);
  assert.match(readme, /npm publication/i);
  assert.match(readme, /--workspace-root/);
});

test("security docs describe the packet-only boundary and the Chrome automation risk", async () => {
  const security = await readPackageFile("SECURITY.md");
  const threatModel = await readPackageFile("THREAT_MODEL.md");
  const chromeSetting = await readPackageFile("docs/chrome-apple-events-setting.md");

  assert.match(security, /packet boundary/i);
  assert.match(security, /third-party service|third party service/i);
  assert.match(security, /best-effort redaction|best effort redaction/i);
  assert.match(security, /post-hoc tripwire|post-hoc|post hoc/i);

  assert.match(threatModel, /packet boundary/i);
  assert.match(threatModel, /does not expose local shell, filesystem, or local network/i);
  assert.match(threatModel, /public GitHub|GitHub sharing|source-visible/i);

  assert.match(chromeSetting, /Allow JavaScript from Apple Events/i);
  assert.match(chromeSetting, /trusted local automation/i);
  assert.match(chromeSetting, /BRIDGE_OK/);
});

test("release posture notes describe public MIT source and separate npm launch paths", async () => {
  const releasePosture = await readPackageFile("docs/release-posture-and-launch.md");

  assert.match(releasePosture, /public GitHub source repository/i);
  assert.match(releasePosture, /MIT License/i);
  assert.match(releasePosture, /Forking: allowed/i);
  assert.match(releasePosture, /npm package release/i);
  assert.match(releasePosture, /private: true/i);
  assert.match(releasePosture, /npm publication/i);
});
