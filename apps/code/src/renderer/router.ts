import {
  createHashHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const router = createTanStackRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
