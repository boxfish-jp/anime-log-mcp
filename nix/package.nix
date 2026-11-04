{
  pkgs,
  nix-node-build,
  src,
}:
let
  wrapper = pkgs.writeShellScript "anime-log-mcp" ''
    export PATH="${pkgs.nodejs_22}/bin:$PATH"
    cd @out@/lib/anime-log-mcp
    exec ${pkgs.nodejs_22}/bin/node node_modules/.bin/tsx packages/mcp-server/src/index.ts "$@"
  '';
in
nix-node-build.lib.mkNodeApp {
  inherit pkgs src;

  packageManager = "npm";
  pname = "anime-log-mcp";
  version = "0.1.0";

  # package-lock.json を変えたら nix build .#default が表示する got の値に更新する。
  depsHash = "sha256-VNJyiDAgYfWzrh4OD4t4TYxdYoq14Q5zoJ8faZED5vQ=";

  nodejs = pkgs.nodejs_22;
  buildScript = null;
  pruneDev = true;
  mainProgram = "anime-log-mcp";

  meta = {
    description = "Annict GraphQL APIを使う非公式MCPサーバー";
  };

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/anime-log-mcp
    cp -a . $out/lib/anime-log-mcp
    mkdir -p $out/bin
    cp ${wrapper} $out/bin/anime-log-mcp
    substituteInPlace $out/bin/anime-log-mcp --replace-fail "@out@" "$out"
    chmod +x $out/bin/anime-log-mcp

    runHook postInstall
  '';
}
