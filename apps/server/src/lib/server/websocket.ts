import type { WsData } from "./handlers/terminal";
import { handleTerminalMessage, handleTerminalClose } from "./handlers/terminal";
import { handleRealtimeOpen, handleRealtimeClose } from "./handlers/realtime";

export const websocket: Bun.WebSocketHandler<WsData> = {
  open(ws) {
    if (ws.data.type === "terminal") {
      // Initialize per-connection state
      (ws as any)._connState = {};
    } else if (ws.data.type === "realtime") {
      handleRealtimeOpen(ws);
    }
  },
  message(ws, message) {
    if (ws.data.type === "terminal") {
      handleTerminalMessage(ws, message);
    }
    // realtime has no client messages
  },
  close(ws) {
    if (ws.data.type === "terminal") {
      handleTerminalClose(ws);
    } else if (ws.data.type === "realtime") {
      handleRealtimeClose(ws);
    }
  },
};
