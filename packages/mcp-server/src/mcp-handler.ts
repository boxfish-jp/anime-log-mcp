import { type AuthInfo, createMcpHandler, preloadSchemas } from "@modelcontextprotocol/server";
import { createAnnictMcpServer } from "./server.js";

preloadSchemas();

export const bearerToken = (authorization: string | null | undefined): string | null => {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  const token = match?.[1]?.trim();
  return token || null;
};

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
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    return new Response("Missing Authorization: Bearer <Annict personal access token>.", {
      status: 401,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const authInfo: AuthInfo = { token, clientId: "", scopes: [] };
  return mcpHandler.fetch(request, { authInfo });
};
