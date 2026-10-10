import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source"] },
  plugins: [
    {
      name: "laas-text",
      transform(code, id) {
        if (id.endsWith(".laas")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  test: { include: ["test/unit/**/*.test.ts"] },
});
