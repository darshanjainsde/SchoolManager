const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// SINGLE-REACT DEDUPE (critical). In this pnpm monorepo with node-linker=hoisted,
// `react` exists at two physical paths (the app resolves .pnpm/react@19.0.0,
// while hoisted deps like react-native-screens resolve <root>/node_modules/react).
// Same version, different files -> Metro bundles TWO React instances -> the app
// crashes at launch with "Cannot read property 'useRef'/'useContext' of null".
// Force every `react`/`react-dom` import to resolve from the app root so there is
// exactly one React copy in the bundle.
const dedupe = /^(react|react-dom)(\/|$)/;
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (dedupe.test(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.js') },
      moduleName,
      platform,
    );
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
