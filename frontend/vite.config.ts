import { defineConfig, type Plugin } from 'vitest/config';

// The Wails runtime is served by the Go asset server at /wails/runtime.js and
// must NOT be bundled. In test mode we redirect it to a stub instead.
function wailsRuntime(): Plugin {
  return {
    name: 'wails-runtime',
    enforce: 'pre',
    resolveId(id) {
      if (id !== '/wails/runtime.js') return;
      if (process.env.VITEST) return null; // fall through to resolve.alias stub
      return { id: '/wails/runtime.js', external: true };
    },
  };
}

export default defineConfig({
  plugins: [wailsRuntime()],

  resolve: {
    alias: process.env.VITEST
      ? { '/wails/runtime.js': new URL('./types/wails-runtime-stub.ts', import.meta.url).pathname }
      : {},
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2025',
    // Desktop app — no chunk-size budget needed.
    chunkSizeWarningLimit: 2000,
  },

  test: {
    environment: 'node',
    include: ['_tests/**/*.test.{js,ts}'],
  },
});
