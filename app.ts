import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountChatFind, type ChatFindController } from "./chat-find";

let controller: ChatFindController | null = null;

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "chat-find",
    mount({ signal }) {
      const mounted = mountChatFind();
      controller = mounted;
      const dispose = () => {
        mounted.dispose();
        if (controller === mounted) controller = null;
      };
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });

  app.commands.register({
    id: "find-in-chat",
    title: "Find in chat",
    isAvailable: () => document.querySelector("[data-thread-window]") !== null,
    run: () => {
      controller?.openFromCommand();
    },
  });
});
