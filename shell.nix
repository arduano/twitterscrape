{ pkgs ? import <nixpkgs> { } }:
with pkgs;
pkgs.mkShell {
  packages = [ chromium ];
  PUPPETEER_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
}
