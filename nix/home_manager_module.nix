self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.anime-log-mcp;
  pkg = cfg.package;
in
{
  options.services.anime-log-mcp = {
    enable = lib.mkEnableOption "anime-log-mcp MCP server";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.default;
      defaultText = lib.literalExpression "self.packages.\${pkgs.system}.default";
      description = "anime-log-mcp package to use";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host name or IP address to bind to";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8000;
      description = "Port for the MCP HTTP server to listen on";
    };

    envFile = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.config/anime-log-mcp/.env";
      defaultText = lib.literalExpression ''"''${config.home.homeDirectory}/.config/anime-log-mcp/.env"'';
      description = "Path to the .env file containing ANNICT_ACCESS_TOKEN";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ pkg ];

    systemd.user.services.anime-log-mcp = {
      Unit = {
        Description = "anime-log-mcp MCP server";
      };
      Service = {
        ExecStart = "${pkg}/bin/anime-log-mcp";
        Restart = "on-failure";
        RestartSec = 5;
        TimeoutStopSec = 15;
        EnvironmentFile = "-${cfg.envFile}";
        Environment = [
          "HOST=${cfg.host}"
          "PORT=${toString cfg.port}"
        ];
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
