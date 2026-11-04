import { type AuthInfo, createMcpHandler, preloadSchemas } from "@modelcontextprotocol/server";
import { createAnnictMcpServer } from "./server.js";

preloadSchemas();

const mcpHandler = createMcpHandler(
  (ctx) => {
    const token = ctx.authInfo?.token;
    if (!token) throw new Error("Missing Annict access token.");
    return createAnnictMcpServer(token);
  },
  {
    legacy: "stateless",
    onerror: (error) => console.error("MCP request rejected", error),
  },
);

export const closeMcpHandler = () => mcpHandler.close();

export const handleMcpRequest = async (request: Request): Promise<Response> => {
  const token = process.env.ANNICT_ACCESS_TOKEN;
  if (!token) {
    return new Response("ANNICT_ACCESS_TOKEN is not configured on the server.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const authInfo: AuthInfo = { token, clientId: "anime-log-mcp", scopes: [] };
  return mcpHandler.fetch(request, { authInfo });
};
