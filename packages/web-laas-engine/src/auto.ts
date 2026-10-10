// Drop-in script: <script src="web-laas-engine.auto.js"></script>
// Attaches a controller with the default snippets to the page and exposes it
// as window.webLaas (call webLaas.setState({ configText }) to customize).
import { LaasController } from "./dom/controller";

declare global {
  interface Window {
    webLaas?: LaasController;
  }
}

if (!window.webLaas) {
  const controller = new LaasController();
  controller.attach();
  window.webLaas = controller;
}
