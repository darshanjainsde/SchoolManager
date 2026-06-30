/**
 * Enforces the modular-monolith boundary inside apps/api:
 *
 *   apps/api/src/modules/<X>/**  may import from
 *   apps/api/src/modules/<Y>/index.ts          ← OK (public interface)
 *   apps/api/src/modules/<Y>/...everything else ← FORBIDDEN
 *
 * Common code (common/**, health/**, app.module.ts) and shared workspace
 * packages can be imported freely.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internal-import',
      severity: 'error',
      comment:
        'Modules may only import each other through their public interface (the module folder index.ts). Reach into another module is forbidden — it would block extracting that module into its own service later.',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/(?!index\\.ts$).+',
        pathNot: '^apps/api/src/modules/$1/',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
