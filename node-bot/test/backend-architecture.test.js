const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ROUTE_OWNERS } = require("../architecture/route-ownership");

const nodeBotRoot = path.join(__dirname, "..");
const routeCallPattern =
  /\b(app|router)\.(get|post|put|patch|delete|use)\s*\(\s*(["'])([^"']+)\3/g;

function joinRoutePaths(mountPath, routePath) {
  if (routePath === "/") return mountPath;
  return `${mountPath.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`;
}

function extractRoutes(owner) {
  const source = fs.readFileSync(path.join(nodeBotRoot, owner.source), "utf8");
  const routes = [];
  let match;
  while ((match = routeCallPattern.exec(source))) {
    const target = match[1];
    const routePath =
      target === "router"
        ? joinRoutePaths(owner.mountPath || "", match[4])
        : match[4];
    routes.push({
      owner: owner.id,
      source: owner.source,
      method: match[2].toUpperCase(),
      path: routePath,
    });
  }
  return routes;
}

function patternMatches(routePath, pattern) {
  if (!pattern.endsWith("/*")) return routePath === pattern;
  const prefix = pattern.slice(0, -2);
  return routePath === prefix || routePath.startsWith(`${prefix}/`);
}

function expectedOwner(routePath) {
  const candidates = ROUTE_OWNERS.flatMap((owner) =>
    owner.patterns
      .filter((pattern) => patternMatches(routePath, pattern))
      .map((pattern) => ({
        owner: owner.id,
        exact: !pattern.endsWith("/*"),
        length: pattern.length,
      })),
  ).sort((left, right) =>
    Number(right.exact) - Number(left.exact) || right.length - left.length,
  );
  return candidates[0]?.owner || null;
}

function findProductionRouteSources(directory = nodeBotRoot) {
  const sources = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      ["mobile-app", "node_modules", "test", "tmp"].includes(entry.name)
    ) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...findProductionRouteSources(absolutePath));
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    routeCallPattern.lastIndex = 0;
    if (routeCallPattern.test(source)) {
      sources.push(path.relative(nodeBotRoot, absolutePath).replace(/\\/g, "/"));
    }
  }
  return sources;
}

test("the ownership manifest covers every production route source", () => {
  const declaredSources = ROUTE_OWNERS.map((owner) => owner.source).sort();
  const discoveredSources = findProductionRouteSources().sort();
  assert.deepEqual(discoveredSources, declaredSources);
});

test("every public HTTP route has one declared source owner", () => {
  const routes = ROUTE_OWNERS.flatMap(extractRoutes);
  assert.ok(routes.length > 60, "route inventory unexpectedly shrank");

  for (const route of routes) {
    assert.equal(
      expectedOwner(route.path),
      route.owner,
      `${route.method} ${route.path} is declared in ${route.source} but owned elsewhere`,
    );
  }
});

test("no public HTTP method and path is declared twice", () => {
  const routes = ROUTE_OWNERS.flatMap(extractRoutes);
  const registrations = new Map();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const previous = registrations.get(key);
    assert.equal(
      previous,
      undefined,
      `${key} is declared by both ${previous} and ${route.source}`,
    );
    registrations.set(key, route.source);
  }
});

test("each composition layer registers its route modules exactly once", () => {
  const contracts = [
    {
      source: "server.js",
      registrars: [
        "registerCapabilities",
        "registerCoreRoutes",
        "registerVTubeRoutes",
        "registerMobileRoutes",
      ],
    },
    {
      source: "server-routes.js",
      registrars: ["registerConversationRoutes", "registerSpeechRoutes"],
    },
  ];
  for (const contract of contracts) {
    const source = fs.readFileSync(
      path.join(nodeBotRoot, contract.source),
      "utf8",
    );
    for (const registrar of contract.registrars) {
      const calls = source.match(new RegExp(`\\b${registrar}\\s*\\(`, "g")) || [];
      assert.equal(
        calls.length,
        1,
        `${contract.source} must call ${registrar} exactly once`,
      );
    }
  }
});

test("the backend entry point has one reachable listen call", () => {
  const source = fs.readFileSync(path.join(nodeBotRoot, "server.js"), "utf8");
  const listenCalls = source.match(/\bserver\.listen\s*\(/g) || [];
  assert.equal(listenCalls.length, 1);
});
