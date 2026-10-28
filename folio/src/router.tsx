import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { PageError } from "./components/page-error";

export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: PageError,
  });
