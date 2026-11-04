import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearerToken, handleMcpRequest } from "../src/mcp-handler.js";

const SERVER_URL = new URL("https://anime-log-mcp.test/mcp");
const MCP_TOKEN = "annict-token";

const serve = (request: Request): Promise<Response> => handleMcpRequest(request);

const graphqlResponse = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

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

describe("handleMcpRequest", () => {
  let annictFetch: ReturnType<typeof vi.fn>;
  const clients: Client[] = [];

  const connectClient = async (token = MCP_TOKEN): Promise<Client> => {
    const client = new Client(
      { name: "test-client", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(SERVER_URL, {
      fetch: (url, init) => {
        const request = new Request(url, init);
        request.headers.set("Authorization", `Bearer ${token}`);
        return serve(request);
      },
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  beforeEach(() => {
    annictFetch = vi.fn(async () => graphqlResponse({ viewer: VIEWER }));
    vi.stubGlobal("fetch", annictFetch);
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})));
    vi.unstubAllGlobals();
  });

  it("2026-07-28の接続でtools/listを返す", async () => {
    const client = await connectClient();
    expect(client.getProtocolEra()).toBe("modern");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "annict_get_episodes",
      "annict_get_library_entries",
      "annict_get_user",
      "annict_get_viewer",
      "annict_get_work",
      "annict_record_episode",
      "annict_search_characters",
      "annict_search_organizations",
      "annict_search_people",
      "annict_search_works",
      "annict_update_status",
    ]);

    await client.close();
  });

  it("ハンドシェイクなしのtools/listにセッションヘッダーなしで応答する", async () => {
    const response = await serve(
      new Request(SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${MCP_TOKEN}`,
          "Mcp-Method": "tools/list",
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();

    const body = (await response.json()) as { result: Record<string, unknown> };
    expect(body.result).toMatchObject({
      resultType: "complete",
      ttlMs: expect.any(Number),
      cacheScope: "private",
      _meta: {
        "io.modelcontextprotocol/serverInfo": { name: "anime-log-mcp" },
      },
    });
    expect(body.result.tools).toHaveLength(11);
  });

  it("2025-06-18のinitializeに応答する", async () => {
    const response = await serve(
      new Request(SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${MCP_TOKEN}`,
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "legacy-client", version: "0.0.0" },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("AuthorizationヘッダーのAnnictトークンでツールを呼び出す", async () => {
    const client = await connectClient();

    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(VIEWER);

    const [, init] = annictFetch.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "bearer annict-token" });

    await client.close();
  });

  it("2つの異なるトークンで独立して処理する", async () => {
    const first = await connectClient("annict-token-1");
    await first.callTool({ name: "annict_get_viewer", arguments: {} });
    await first.close();

    const second = await connectClient("annict-token-2");
    const result = await second.callTool({ name: "annict_get_viewer", arguments: {} });
    await second.close();

    expect(result.isError).toBeFalsy();
    expect(annictFetch).toHaveBeenCalledTimes(2);
    const auths = annictFetch.mock.calls.map(([, init]) => (init as RequestInit).headers);
    expect(auths[0]).toMatchObject({ Authorization: "bearer annict-token-1" });
    expect(auths[1]).toMatchObject({ Authorization: "bearer annict-token-2" });
  });

  it("フィルタのない検索を拒否する", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "annict_search_characters", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("'name' or 'annictId'");
    expect(annictFetch).not.toHaveBeenCalled();
  });

  it("単数の検索引数をAnnictのリスト変数として渡す", async () => {
    annictFetch.mockResolvedValueOnce(
      graphqlResponse({
        searchCharacters: {
          edges: [],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
        },
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "annict_search_characters",
      arguments: { name: "レム", annictId: 42 },
    });
    await client.close();

    expect(result.isError).toBeFalsy();
    const [, init] = annictFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as { variables: Record<string, unknown> };
    expect(body.variables).toMatchObject({ names: ["レム"], annictIds: [42], first: 25 });
  });

  it("Annictが401を返すとAuthorizationヘッダーの確認を促す", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("401");
    expect(text).toContain("Check the Authorization header");
  });

  it("401以外のエラーはそのまま返す", async () => {
    annictFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("500");
  });

  it("Annictのレート制限時に待つ秒数を返す", async () => {
    annictFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ type: "too_many_requests" }] }), {
        status: 429,
        headers: { "Retry-After": "42" },
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("retry after 42 seconds");
    expect(annictFetch).toHaveBeenCalledTimes(1);
  });

  it("Authorizationヘッダーがない場合は401を返し、OAuthのチャレンジを付けない", async () => {
    const response = await handleMcpRequest(new Request(SERVER_URL));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("Missing Authorization");
  });

  it("Bearer以外のAuthorizationでもトークンを本文に出さない", async () => {
    const response = await handleMcpRequest(
      new Request(SERVER_URL, { headers: { Authorization: "Basic secret-token" } }),
    );
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain("secret-token");
  });
});

describe("bearerToken", () => {
  it.each([
    ["bearer token", "token"],
    ["BEARER token", "token"],
    ["Bearer   token", "token"],
    ["Basic token", null],
    ["Bearer", null],
    ["Bearer   ", null],
    [null, null],
    [undefined, null],
  ])("%sを受け取ると%sを返す", (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });
});
