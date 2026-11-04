import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "./http.js";
import { closeMcpHandler } from "./mcp-handler.js";

const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const envFile = process.env.ANNICT_ENV_FILE ?? join(configHome, "anime-log-mcp", ".env");

if (!process.env.ANNICT_ACCESS_TOKEN && existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.error(`Failed to load ${envFile}`, error);
    process.exit(1);
  }
}

if (!process.env.ANNICT_ACCESS_TOKEN) {
  console.error(`ANNICT_ACCESS_TOKEN is not set. Write it to ${envFile} or set it in the environment.`);
  process.exit(1);
}

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8000");
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const localOnly = host === "127.0.0.1" || host === "::1" || host === "localhost";
const server = createAppServer({ localOnly });

server.once("error", (error) => {
  console.error(`Failed to listen on ${host}:${port}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

server.listen(port, host, () => {
  const shownHost = host.includes(":") ? `[${host}]` : host;
  console.log(`anime-log-mcp listening on ${shownHost}:${port} (MCP endpoint: /mcp)`);
});

let shuttingDown = false;
let closing: Promise<void> | undefined;
const closeHandler = () => (closing ??= closeMcpHandler());

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;

  server.close(() => {
    void closeHandler().finally(() => process.exit(0));
  });
  server.closeIdleConnections();

  const force = setTimeout(() => {
    server.closeAllConnections();
    void closeHandler().finally(() => process.exit(0));
  }, 5000);
  force.unref();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}
