{ pkgs }:
pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    pkgs.typescript-language-server
  ];

  shellHook = ''
    echo "初回は npm ci を実行してください。"
    echo "型チェック: npm run typecheck"
    echo "テスト: npm test"
    echo "開発サーバー: nix run"
  '';
}
