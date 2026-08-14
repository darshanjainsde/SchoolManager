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
    {
      name: 'no-library-service-imports',
      severity: 'error',
      comment:
        'Sckools must not import the library SERVICE\'s own code. Isolation was enforced in one direction only — .dependency-cruiser.library.cjs stops the library reaching into Sckools, but nothing stopped Sckools reaching the other way except apps/api/tsconfig.json happening to list its includes literally, which is a build detail, not a rule: widen one include and apps/api compiles half of library-api into the Sckools bundle. The library runs as its own deployment with its own Nest app, its own guards and its own request context; importing a service or controller out of it turns "merge or split the services later" from a routing change into a rewrite. Two doors are deliberately NOT closed here because they are the designed ones: `@library/core` (packages/library-core), pure functions with no Prisma and no Nest, which exists precisely so both apps answer "what does this child owe" identically; and `@library/db`, which apps/api/src/modules/library/internal/* already uses to read the library database directly for the librarian\'s counter.',
      from: { path: '^apps/(api|web)/' },
      // Two shapes, because a violation can arrive as either:
      //   - a resolved path, when someone reaches across with `../../library-api/...`
      //     (the likeliest form — apps/library-api is not a dependency of
      //     apps/api, so a relative path is how it would actually be written)
      //   - the bare specifier, if @library/api ever ships as an importable
      //     package. Matching only resolved paths would miss an unresolvable
      //     import, which dependency-cruiser records as the raw string.
      to: { path: '^apps/library-(api|web)/|^@library/api$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // `no-library-service-imports` names apps/web in its `from`, so the scan
    // has to reach apps/web or half that rule is decoration (trap 9: a gate
    // covers less than you assume). Scanning the app root pulls in
    // middleware.ts and scripts/ as well as app|components|lib — and needs
    // build output kept out, which `doNotFollow` alone does not do.
    // NOT `(^|/)api(/|$)` for the ncc output directory, however much it looks
    // like the library config's pattern: that segment also matches the `api`
    // in `apps/api/...` and silently excludes the entire Sckools API from the
    // scan — the rule below still reported the apps/web probe, so the run
    // looked healthy while covering 46 fewer modules. Anchor it to
    // `apps/<app>/api/` instead. (The library config gets away with the loose
    // form only because its app directory is named `library-api`.)
    exclude: { path: '(^|/)(node_modules|\\.next|\\.turbo|dist|generated)(/|$)|^apps/[^/]+/api/' },
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
