{
  description = "AnnictのGraphQL APIを利用した非公式MCPサーバー";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix-node-build = {
      url = "github:boxfish-jp/nix-node-build";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      nix-node-build,
      ...
    }:
    let
      perSystem = flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          devShell = import ./nix/dev_shell.nix { inherit pkgs; };
          package = import ./nix/package.nix {
            inherit pkgs nix-node-build;
            src = ./.;
          };
        in
        {
          formatter = pkgs.nixfmt-tree;
          devShells.default = devShell;
          packages.default = package;
          apps.default = {
            type = "app";
            program = "${package}/bin/anime-log-mcp";
            meta = {
              description = "Start the local MCP server";
            };
          };
        }
      );
    in
    perSystem
    // {
      homeManagerModules.default = import ./nix/home_manager_module.nix self;
    };
}
