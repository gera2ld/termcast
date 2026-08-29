import { CanvasAddon } from "@xterm/addon-canvas";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITerminalInitOnlyOptions, type ITerminalOptions } from "@xterm/xterm";
import { terminalThemes } from "$lib/themes";

export type ColorScheme = keyof typeof terminalThemes;

export class XTerm extends Terminal {
  fitAddon: FitAddon;

  constructor(options: ITerminalOptions & ITerminalInitOnlyOptions, scheme: ColorScheme = "dark") {
    super({
      ...options,
      allowProposedApi: true,
      theme: terminalThemes[scheme],
    });
    this.fitAddon = new FitAddon();
    this.loadAddon(this.fitAddon);
    this.loadAddon(new WebLinksAddon());
    this.loadAddon(new ImageAddon());
    this.loadAddon(new CanvasAddon());
    this.loadAddon(new ClipboardAddon());

    this.loadAddon(new Unicode11Addon());
    this.unicode.activeVersion = "11";
  }

  open(el: HTMLElement) {
    super.open(el);
    this.loadAddon(new LigaturesAddon());
  }
}
