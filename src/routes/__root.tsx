/// <reference types="vite/client" />

import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Fit Fetcher" },
      { name: "description", content: "Size Weaver scrapes and normalizes official brand size guides from the web into importable JSON files." },
      { name: "author", content: "Fit Fetcher" },
      { property: "og:title", content: "Fit Fetcher" },
      { property: "og:description", content: "Size Weaver scrapes and normalizes official brand size guides from the web into importable JSON files." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Fit Fetcher" },
      { name: "twitter:description", content: "Size Weaver scrapes and normalizes official brand size guides from the web into importable JSON files." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/84e0d079-d7ed-43fd-ad89-2374564c8d07/id-preview-93333beb--b09818c5-f8d1-4f00-a816-72096c6e1911.lovable.app-1776593429781.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/84e0d079-d7ed-43fd-ad89-2374564c8d07/id-preview-93333beb--b09818c5-f8d1-4f00-a816-72096c6e1911.lovable.app-1776593429781.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
