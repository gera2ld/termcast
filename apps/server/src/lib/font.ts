import { load } from "webfontloader";

// export const loadingFonts = loadFont(
//   'FiraCode Nerd Font',
//   'https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/firacode-nerd-font.css',
// );
export const loadingFonts = loadFont(
  "CaskaydiaCove NF",
  "https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/cascadiacode.css",
);

async function loadFont(name: string, css: string) {
  return new Promise<string | undefined>((resolve) => {
    load({
      custom: {
        families: [name],
        urls: [css],
      },
      inactive() {
        resolve(undefined);
      },
      active() {
        resolve(name);
      },
    });
  });
}
