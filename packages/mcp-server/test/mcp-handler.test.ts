import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpRequest } from "../src/mcp-handler.js";

const SERVER_URL = new URL("https://anime-log-mcp.test/mcp");
const ANNICT_TOKEN = "annict-token";
const originalToken = process.env.ANNICT_ACCESS_TOKEN;

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

  const connectClient = async (): Promise<Client> => {
    const client = new Client(
      { name: "test-client", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(SERVER_URL, {
      fetch: (url, init) => serve(new Request(url, init)),
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  beforeEach(() => {
    process.env.ANNICT_ACCESS_TOKEN = ANNICT_TOKEN;
    annictFetch = vi.fn(async () => graphqlResponse({ viewer: VIEWER }));
    vi.stubGlobal("fetch", annictFetch);
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})));
    if (originalToken === undefined) delete process.env.ANNICT_ACCESS_TOKEN;
    else process.env.ANNICT_ACCESS_TOKEN = originalToken;
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

  it("サーバーのANNICT_ACCESS_TOKENでツールを呼び出す", async () => {
    const client = await connectClient();

    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(VIEWER);

    const [, init] = annictFetch.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `bearer ${ANNICT_TOKEN}` });

    await client.close();
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

  it("Annictが401を返すとANNICT_ACCESS_TOKENの確認を促す", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("401");
    expect(text).toContain("Check ANNICT_ACCESS_TOKEN");
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

  it("ANNICT_ACCESS_TOKENが未設定なら503を返す", async () => {
    delete process.env.ANNICT_ACCESS_TOKEN;

    const response = await handleMcpRequest(new Request(SERVER_URL));

    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("ANNICT_ACCESS_TOKEN is not configured");
  });
});
