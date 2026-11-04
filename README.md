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
- Annictの個人用アクセストークン（スコープ: 読み込み + 書き込み）を `.env` に設定する。

## 使い方

```sh
mkdir -p ~/.config/anime-log-mcp
cp .env.example ~/.config/anime-log-mcp/.env
chmod 600 ~/.config/anime-log-mcp/.env
# .env の ANNICT_ACCESS_TOKEN を設定する
npm ci
npm run dev
```

`npm run dev` はファイル変更を監視して起動し、`npm start` は監視なしで起動します。サーバーは起動時に `.env` を読み、`ANNICT_ACCESS_TOKEN` が無ければエラーで終了します。MCPのエンドポイントは `http://127.0.0.1:8000/mcp` です。`GET /healthz` は `{"status":"ok"}` を返します。

`SIGINT` / `SIGTERM` を受けると、新規接続を止め、進行中のリクエストを最大5秒待ってから打ち切ります。

待ち受けアドレスとポートは環境変数で変えられます。

| 変数 | 既定値 | 説明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 待ち受けアドレス |
| `PORT` | `8000` | 待ち受けポート |

`HOST` と `PORT` は `.env` にも書けます。既に環境変数が設定されている場合は、そちらが優先されます。

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

### Home Manager

flake の input に追加します。

```nix
inputs.anime-log-mcp.url = "github:boxfish-jp/anime-log-mcp";
```

`home.nix` で module を import し、サービスを有効にします。

```nix
imports = [ inputs.anime-log-mcp.homeManagerModules.default ];

services.anime-log-mcp = {
  enable = true;
  host = "127.0.0.1";
  port = 8000;
  envFile = "${config.home.homeDirectory}/.config/anime-log-mcp/.env";
};
```

`envFile` の既定値は `${config.home.homeDirectory}/.config/anime-log-mcp/.env` です。上の例は既定値を明示したものです。`.env` の作り方は「使い方」を参照してください。

サービスは systemd user service として動きます。

```sh
systemctl --user start anime-log-mcp
systemctl --user status anime-log-mcp
```

ログインしていない間も動かす場合は linger を有効にします。NixOS では `users.users.<ユーザー名>.linger = true`、それ以外では `loginctl enable-linger "$USER"` を設定します。

トークンは `.env` にだけ書き、Nixの設定には書きません。`envFile` は `EnvironmentFile` として読まれます。`.env` を変更したら `systemctl --user restart anime-log-mcp` で再起動してください。`host = "0.0.0.0"` にする場合の注意は前述の TLS / リバースプロキシの記述を参照してください。

## MCPクライアントの設定

MCPクライアントには URL だけを登録します。認証ヘッダーは不要です。

```json
{
  "mcpServers": {
    "anime-log": {
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
```

`http://127.0.0.1:8000/mcp` は既定の待ち受けアドレスです。`HOST` / `PORT` を変えた場合は合わせてください。

## 認証

サーバーは単一の `ANNICT_ACCESS_TOKEN` を使います。MCPクライアントごとの認証はしません。

- 既定の `.env` は `$XDG_CONFIG_HOME/anime-log-mcp/.env`。`XDG_CONFIG_HOME` が未設定なら `~/.config/anime-log-mcp/.env`。
- `ANNICT_ENV_FILE` で `.env` のパスを上書きできます。
- `ANNICT_ACCESS_TOKEN` を環境変数で設定した場合は `.env` を読みません。`HOST` / `PORT` も `.env` から読みたい場合は、トークンも `.env` に書いてください。
- `.env` の形式は次のとおりです。

  ```sh
  ANNICT_ACCESS_TOKEN=...
  # HOST=127.0.0.1
  # PORT=8000
  ```

- トークンは https://annict.com/settings/apps で「個人用アクセストークン」を新規作成し、スコープを「読み込み + 書き込み」にして取得します。読み込み専用のトークンでは、視聴記録の作成やステータス更新のツールは使えません。
- `.env` は `chmod 600` にし、コミットしないでください。リポジトリの `.env.example` をコピーして使います。
- `nix run` / `npm start` / systemd のどれでも、起動時に同じ `.env` を読みます。`ANNICT_ACCESS_TOKEN` が無ければサーバーは起動しません。
- トークンはサーバーの `.env` に保存されます。不要になったら `.env` から削除し、Annict側でもトークンを削除してください。
- Annictが401を返したときは、`.env` の `ANNICT_ACCESS_TOKEN` を確認し、サービスを再起動してください。トークンが削除・失効している可能性があります。

**このサーバーはMCPクライアントの認証をしません。`/mcp` に到達できる相手は、そのAnnictアカウントとしてツールを呼び出せます。** 既定の `127.0.0.1` のまま、自分専用の環境で使ってください。外部に公開する場合は、認証付きのリバースプロキシを必ず前段に置いてください。TLSだけでは不十分です。

他人が運用するサーバーに自分のトークンを置くと、その運用者はあなたのAnnictアカウントとして読み書きできます。API利用規約第4条は、自分のアクセストークンを第三者に渡さないことを求めています。自分以外に提供する場合は、この点を利用者に明示してください。

## Annict API利用規約への対応

2026年11月25日施行の[API利用規約](https://annict.com/terms/api)に沿うよう、次のとおり扱っています。

### 個人用アクセストークンの説明 (第4条)

このサーバーで使う個人用アクセストークンでは、Annictのデータの読み取りと、視聴記録の作成・視聴ステータスの更新ができます。トークンを他の人に教えたり公開したりしないでください。サーバーの `.env` に保存するトークンは、サーバーを運用する人が読める状態になります。自分が管理する環境でのみ使ってください。

### 保存する利用者情報と削除 (第6条・第7条)

サーバーは `.env` に `ANNICT_ACCESS_TOKEN` を保存します。これはAPIの資格情報であり、Annictの利用者情報ではありません。APIから取得した作品情報や記録はリクエストのたびに取得して返すだけで、保存もキャッシュもしません。運用をやめるときは `.env` を削除してください。

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
- `mcp-server` — MCPハンドラーとNode.js HTTPサーバーの結合テスト。`.env` のトークン、ツール一覧、ツール呼び出し、レート制限、401時の案内を確認します

## 型チェック

```sh
npm run typecheck
```

## 今後の改善候補

- ライブのGraphQL introspectionを使った `graphql-code-generator` による型自動生成
