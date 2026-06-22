import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types/index.ts',
    'src/echo/index.ts',
    'src/lifecycle/index.ts',
    'src/dispatch/index.ts',
    'src/session/index.ts',
    'src/logger/index.ts',
  ],
  outDir: 'dist',
  format: 'esm',
  dts: { resolve: false },
  sourcemap: true,
  minify: true,
  clean: true,
  splitting: true,
  treeshake: true,
})
