import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // OAuth 套件 import 了 workerd 專屬的 cloudflare:workers；測試裡換成最小的替身。
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./tests/helpers/cloudflare-workers.ts", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 讓上面的 alias 也套用到這個套件本身（預設 node_modules 會直接交給 Node 載入）。
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
