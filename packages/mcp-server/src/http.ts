import { createServer, type ServerResponse } from "node:http";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { handleMcpRequest } from "./mcp-handler.js";

const nodeHandler = toNodeHandler(
  { fetch: handleMcpRequest },
  { onerror: (error) => console.error("MCP handler failed", error) },
);

const sendBody = (res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void => {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
};

export const createAppServer = ({ localOnly = true }: { localOnly?: boolean } = {}) => {
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  return createServer(async (req, res) => {
    if (localOnly && (!validateHost(req, res) || !validateOrigin(req, res))) return;

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendBody(res, 400, "Bad Request");
      return;
    }

    if (url.pathname === "/healthz") {
      sendBody(res, 200, JSON.stringify({ status: "ok" }), "application/json; charset=utf-8");
      return;
    }

    if (url.pathname === "/") {
      sendBody(
        res,
        200,
        "anime-log-mcp\nMCP endpoint: /mcp\nAuthorization: Bearer <Annict personal access token (read + write)>\nDo not share the token.\n",
      );
      return;
    }

    if (url.pathname !== "/mcp") {
      sendBody(res, 404, "Not found");
      return;
    }

    try {
      await nodeHandler(req, res);
    } catch (error) {
      console.error("Request failed", error);
      if (!res.headersSent) sendBody(res, 500, "Internal Server Error");
    }
  });
};
