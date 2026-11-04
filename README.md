# anime-log-mcp

[Annict](https://annict.com)(アニメ視聴記録サービス)の公式GraphQL APIを利用した、非公式のMCP (Model Context Protocol) サーバーです。Node.jsのHTTPサーバーとして動き、Cloudflare Workersは使いません。Annictの運営とは関係ありません。

[API利用規約](https://annict.com/terms/api)第13条は、アプリケーションの名前にAnnictの名称を冠することを、公式のものと誤解させる表示として禁じています。そのため、本サーバーの名前と公開URLのどれにもAnnictを含めていません。公開するときは、サーバー名やドメインにもAnnictを含めないでください。

npmで公開されている `annict` パッケージはREST API v1をラップしたものでアーカイブ済みのため使用していません。本プロジェクトは次の2つのパッケージで構成されます。

- `packages/annict-client` — Annict公式GraphQL API (`https://api.annict.com/graphql`) を直接操作する薄いTypeScriptクライアント
- `packages/mcp-server` — `annict-client` を使ってツールを公開する、Node.js上のMCPサーバー

## 動作環境

- Node.js 22系とnpm。動作確認済みのNode.jsは22.23.4。
- Nixを使う場合はflakesを有効にしたNix。対応システムは `x86_64-linux` / `aarch64-linux` のみ（macOSは対象外）。
- 動作確認済みは `x86_64-linux`。`aarch64-linux` は未検証。
- Annictの個人用アクセストークン（スコープ: 読み込み + 書き込み）は利用者が用意する。

## 使い方

```sh
npm ci
npm run dev
```

`npm run dev` はファイル変更を監視して起動し、`npm start` は監視なしで起動します。MCPのエンドポイントは `http://127.0.0.1:8000/mcp` です。`GET /healthz` は `{"status":"ok"}` を返します。

`SIGINT` / `SIGTERM` を受けると、新規接続を止め、進行中のリクエストを最大5秒待ってから打ち切ります。

待ち受けアドレスとポートは環境変数で変えられます。

| 変数 | 既定値 | 説明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 待ち受けアドレス |
| `PORT` | `8000` | 待ち受けポート |

- 既定の `127.0.0.1` では、Host と Origin を localhost に限定します。
- `HOST=0.0.0.0` は LAN/外部から到達でき、TLS なしではトークンが平文で流れます。
- リモートに公開する場合は、TLS 終端のリバースプロキシで Host/Origin 制限と TLS を必須にしてください。

旧Cloudflare Workers版の `.dev.vars` や `.wrangler/` が残っている場合は削除してください。旧OAuthアプリのクライアントシークレットはもう使いません。

Nixを使う場合は、依存を解決してビルドしたパッケージから起動できます。`npm ci` は不要です。

```sh
nix run
```

リポジトリの外から実行する場合は、`nix run /path/to/anime-log-mcp` のようにパスを指定してください。この flake は `nix-node-build` の `mkNodeApp` を使っています。

開発・テスト用のシェルでは `npm ci` を使います。

```sh
nix develop
npm ci
npm run typecheck
npm test
```

## MCPクライアントの設定

MCPクライアントがカスタムヘッダーに対応している必要があります。URLを登録するだけのOAuth専用クライアントでは使えません。

```json
{
  "mcpServers": {
    "anime-log": {
      "url": "http://127.0.0.1:8000/mcp",
      "headers": {
        "Authorization": "Bearer <Annictの個人用アクセストークン>"
      }
    }
  }
}
```

トークンは https://annict.com/settings/apps で「個人用アクセストークン」を新規作成し、スコープを「読み込み + 書き込み」にして取得してください。読み込み専用のトークンでは、視聴記録の作成やステータス更新のツールは使えません。

個人用アクセストークンは、他の人に教えたり公開したりしないでください。MCPクライアントの設定ファイルに保存されるため、そのファイルの権限と取り扱いにも注意してください。

## 認証

認証には `Authorization: Bearer <Annictの個人用アクセストークン>` ヘッダーだけを使います。クエリパラメータやCookieは使いません。

このサーバーは、自分が管理する環境で動かしてください。他人が運用するサーバーに個人用アクセストークンを設定すると、その運用者はあなたのAnnictアカウントとして読み書きできます。

API利用規約第4条は、自分のアクセストークンを第三者に渡さないことを求めています。自分以外に提供する場合は、この点を利用者に明示してください。ローカルで自分だけが使う場合も、自分専用の環境として扱ってください。

サーバーはトークンを保存しません。リクエストごとに、そのリクエストの `Authorization` ヘッダーのトークンでAnnict GraphQL APIを呼び出すだけです。データベースや取得データのキャッシュもありません。

Annictが401を返したときは、ツールの結果をエラーにし、MCPクライアントの `Authorization` ヘッダーを確認するよう案内します。トークンが削除・失効している可能性があります。

サーバーのプロセスはリクエスト処理中にトークンを扱えます。`Authorization` ヘッダーをログに残さないでください。

## Annict API利用規約への対応

2026年11月25日施行の[API利用規約](https://annict.com/terms/api)に沿うよう、次のとおり扱っています。

### 個人用アクセストークンの説明 (第4条)

このサーバーで使う個人用アクセストークンでは、Annictのデータの読み取りと、視聴記録の作成・視聴ステータスの更新ができます。トークンを他の人に教えたり公開したりしないでください。

### 保存する利用者情報と削除 (第6条・第7条)

サーバーは利用者情報を保存しません。APIから取得した作品情報や記録はリクエストのたびに取得して返すだけで、保存もキャッシュもしません。運用をやめるときに、サーバー側で削除する利用者情報はありません。

### レート制限 (第11条)

Annict APIのレート制限は、アクセストークンと接続元IPの組ごとに1分あたり600リクエストです(2026年10月25日時点。最新の値は[開発者向けヘルプ](https://wikino.app/s/annict/pages/357)を確認してください)。上限を超えると、Annictは `Retry-After` ヘッダー付きの429を返します。

- `Retry-After` が10秒以内なら、その秒数だけ待ってから1回だけ再送します
- それより長い場合や再送も429だった場合は、ツールの結果を `isError: true` とし、待つべき秒数をメッセージに含めて返します(`retry after N seconds`)

`annict-client` を単体で使う場合は、`rateLimitMaxWaitSeconds` でその場で待つ秒数の上限を変えられます(0でその場では待ちません)。429は `AnnictRateLimitError` として投げられ、`retryAfterSeconds` で待つべき秒数を取れます。

## 提供ツール

| ツール名 | 説明 |
|---|---|
| `annict_get_viewer` | 認証ユーザーのプロフィールと視聴ステータス件数を取得 |
| `annict_get_user` | `username` を指定して他のAnnictユーザーのプロフィールと視聴ステータス件数を取得 |
| `annict_get_library_entries` | 認証ユーザーのライブラリ(視聴記録中の作品)を、ステータスで絞り込んで一覧取得 |
| `annict_search_works` | タイトル・シーズンで作品を検索 |
| `annict_get_work` | 数値の `annictId` で作品を1件取得 |
| `annict_get_episodes` | 作品の `annictId` からエピソード一覧を取得 |
| `annict_search_characters` | 名前(または `annictId`)でアニメのキャラクターを検索。所属シリーズも一緒に返します |
| `annict_search_people` | 名前(または `annictId`)で声優・監督などの人物を検索 |
| `annict_search_organizations` | 名前(または `annictId`)で制作会社・スタジオを検索 |
| `annict_record_episode` | エピソードを視聴済みとして記録(コメント任意) |
| `annict_update_status` | 作品の視聴ステータスを更新 |

一覧系のツール(`annict_get_library_entries` / `annict_search_works` / `annict_get_episodes` / `annict_search_characters` / `annict_search_people` / `annict_search_organizations`)はカーソルページネーションに対応しています。レスポンスの `pageInfo.hasNextPage` が `true` のとき、`pageInfo.endCursor` を次の呼び出しの `after` に渡すと続きを取得できます。`first` の既定値は25件です。

`annict_record_episode` の `episodeId` と `annict_update_status` の `workId` は、AnnictのRelay形式のグローバルID(各オブジェクトの `id` フィールド)です。数値の `annictId` とは異なるので注意してください。`annict_get_episodes` や `annict_search_works` のレスポンスに含まれる `id` フィールドを利用します。

## プロトコル

MCPの2026-07-28リビジョンに対応しています。セッションを保持せず、リクエストごとにサーバーインスタンスを生成します。`legacy: "stateless"` を指定しているため、2025リビジョンまでのクライアントも同じツール定義で接続できます。ただし、GET/DELETE（SSEの再開・セッション削除）は405で、サーバー起点の通知は使いません。

## テスト

```sh
npm test
```

- `annict-client` — `fetch` をモックしたユニットテスト
- `mcp-server` — MCPハンドラーとNode.js HTTPサーバーの結合テスト。`Authorization` ヘッダーの検証、ツール一覧、ツール呼び出し、レート制限、401時の案内を確認します

## 型チェック

```sh
npm run typecheck
```

## 今後の改善候補

- ライブのGraphQL introspectionを使った `graphql-code-generator` による型自動生成
