import { registerHooks } from 'node:module';

// Match the app's @/* aliases without compiling or loading Next.js in unit tests.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
