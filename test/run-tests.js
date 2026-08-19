import assert from "node:assert/strict";
import { parseRegion, isUsableCapture } from "../src/screen-capture.js";
import { resolveApiKey } from "../src/vision-client.js";
import { extractImageReferences } from "../src/image-bridge.js";
import { assertPathAllowed } from "../src/image-attachments.js";

async function main() {
  // parseRegion
  assert.deepEqual(parseRegion("10,20,300,400"), { x: 10, y: 20, width: 300, height: 400 });
  assert.deepEqual(parseRegion(" 1, 2 , 3 , 4 "), { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(parseRegion("1,2,3"), undefined);
  assert.equal(parseRegion("1,2,0,4"), undefined);
  assert.equal(parseRegion("1,2,-3,4"), undefined);
  assert.equal(parseRegion(""), undefined);
  assert.equal(parseRegion("a,b,c,d"), undefined);

  // isUsableCapture
  assert.equal(isUsableCapture({ blank: false, width: 200, height: 100 }), true);
  assert.equal(isUsableCapture({ blank: true, width: 200, height: 100 }), false);
  assert.equal(isUsableCapture({ blank: false, width: 50, height: 100 }), false);
  assert.equal(isUsableCapture({ blank: false, width: 200, height: 50 }), false);
  assert.equal(isUsableCapture(null), false);
  assert.equal(isUsableCapture(undefined), false);

  // resolveApiKey
  assert.equal(await resolveApiKey({ apiKey: "literal", apiKeyEnv: "SOME_ENV" }, null), "literal");
  const ctx = {
    get(name) {
      if (name === "credentials") {
        return { resolve: async () => ({ value: "from-credentials", source: "file" }) };
      }
      return undefined;
    },
  };
  assert.equal(await resolveApiKey({ apiKey: "", apiKeyEnv: "OPENCODE_API_KEY" }, ctx), "from-credentials");
  process.env.TEST_VISION_KEY = "from-env";
  try {
    assert.equal(await resolveApiKey({ apiKey: "", apiKeyEnv: "TEST_VISION_KEY" }, null), "from-env");
  } finally {
    delete process.env.TEST_VISION_KEY;
  }

  // extractImageReferences
  assert.deepEqual(extractImageReferences("see ![](a.png)"), [{ raw: "![](a.png)", target: "a.png" }]);
  assert.deepEqual(extractImageReferences("no image"), []);
  assert.equal(extractImageReferences("data:image/png;base64,AAAA").length, 1);

  // assertPathAllowed
  assert.throws(() => assertPathAllowed("C:/secret/a.png", { deniedImageDirs: ["C:/secret"] }));
  assert.doesNotThrow(() => assertPathAllowed("C:/ok/a.png", { deniedImageDirs: ["C:/secret"] }));
  assert.throws(() => assertPathAllowed("C:/other/a.png", { allowedImageDirs: ["C:/ok"] }));
  assert.doesNotThrow(() => assertPathAllowed("C:/ok/a.png", { allowedImageDirs: ["C:/ok"] }));
  assert.doesNotThrow(() => assertPathAllowed("C:/any/a.png", { allowedImageDirs: [], deniedImageDirs: [] }));

  console.log("ALL TESTS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
