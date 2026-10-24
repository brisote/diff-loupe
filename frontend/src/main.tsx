import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/icons.css";
import "./styles/app.css";
import { App } from "./App";
import { createBackend } from "./api";
import { followSystemTheme } from "./lib/theme";
import { StoreProvider } from "./state/context";
import { createAppStore } from "./state/store";

followSystemTheme();
const store = createAppStore(createBackend());
void store.getState().start();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <StoreProvider store={store}>
        <App />
      </StoreProvider>
    </StrictMode>,
  );
}
