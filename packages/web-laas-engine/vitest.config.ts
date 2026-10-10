import { defineConfig } from "vitest/config";

export default defineConfig({
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
