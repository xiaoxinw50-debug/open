import { createWorker } from "tesseract.js";
import os from "node:os";
import path from "node:path";

const imagePath = process.argv[2];

if (!imagePath) {
  console.error("missing image path");
  process.exit(2);
}

let worker;

try {
  worker = await createWorker("eng+chi_sim", 1, {
    cachePath: path.join(os.tmpdir(), "switch-margin-tesseract-cache")
  });
  const result = await worker.recognize(imagePath);
  const text = String(result?.data?.text || "").trim();
  process.stdout.write(JSON.stringify({ text }));
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
} finally {
  if (worker) {
    await worker.terminate().catch(() => {});
  }
}
