import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppServer } from "../src/http.js";

const VIEWER = {
  id: "VXNlci0x",
  annictId: 1,
  username: "mokuichi",
  name: "Mokuichi",
  avatarUrl: "https://example.test/avatar.png",
  watchingCount: 3,
  watchedCount: 120,
  wannaWatchCount: 7,
  onHoldCount: 0,
  stopWatchingCount: 1,
  recordsCount: 400,
};

const graphqlResponse = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const originalFetch = globalThis.fetch.bind(globalThis);

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const mcpRequest = (token: string, method: string, params: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "Mcp-Method": method,
    "MCP-Protocol-Version": "2026-07-28",
    ...(method === "tools/call" ? { "Mcp-Name": String(params.name) } : {}),
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  }),
});

describe("createAppServer", () => {
  let server: ReturnType<typeof createAppServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createAppServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("GET /healthzでstatus okを返す", async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("GET /でMCPエンドポイントを案内する", async () => {
    const response = await fetch(`${baseUrl}/`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("anime-log-mcp");
    expect(text).toContain("/mcp");
  });

  it("AuthorizationなしのPOST /mcpで401を返す", async () => {
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST" });

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Missing Authorization");
  });

  it("AuthorizationありのPOST /mcpでtools/listを返す", async () => {
    const response = await fetch(`${baseUrl}/mcp`, mcpRequest("test-token", "tools/list", {}));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(11);
  });

  it("loopbackでは許可されないOriginを403で拒否する", async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers: { Origin: "http://evil.example" } });

    expect(response.status).toBe(403);
  });

  it("tools/callをHTTP経由で実行し、AuthorizationヘッダーのトークンをAnnictへ渡す", async () => {
    const annictFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input).startsWith("https://api.annict.com/graphql")) {
        return graphqlResponse({ viewer: VIEWER });
      }
      return originalFetch(input, init);
    });
    vi.stubGlobal("fetch", annictFetch);

    const response = await fetch(
      `${baseUrl}/mcp`,
      mcpRequest("test-token", "tools/call", { name: "annict_get_viewer", arguments: {} }),
    );
    const body = (await response.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    expect(JSON.parse(body.result.content[0]!.text)).toEqual(VIEWER);

    const annictCall = annictFetch.mock.calls.find(([input]) =>
      urlOf(input as RequestInfo | URL).startsWith("https://api.annict.com/graphql"),
    );
    expect(annictCall).toBeDefined();
    expect((annictCall![1] as RequestInit).headers).toMatchObject({ Authorization: "bearer test-token" });
  });

  it("Annictが401を返すとHTTP経由のツール結果に案内を返す", async () => {
    const annictFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input).startsWith("https://api.annict.com/graphql")) {
        return new Response("unauthorized", { status: 401 });
      }
      return originalFetch(input, init);
    });
    vi.stubGlobal("fetch", annictFetch);

    const response = await fetch(
      `${baseUrl}/mcp`,
      mcpRequest("test-token", "tools/call", { name: "annict_get_viewer", arguments: {} }),
    );
    const body = (await response.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("401");
    expect(body.result.content[0]!.text).toContain("Check the Authorization header");

    const annictCall = annictFetch.mock.calls.find(([input]) =>
      urlOf(input as RequestInfo | URL).startsWith("https://api.annict.com/graphql"),
    );
    expect((annictCall![1] as RequestInit).headers).toMatchObject({ Authorization: "bearer test-token" });
  });
});
