import { timingSafeEqual } from "node:crypto";
import { trpcServer } from "@hono/trpc-server";
import { context, propagation, type TextMapGetter } from "@opentelemetry/api";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { appRouter } from "./trpc";

const SECRET_HEADER = "x-workspace-secret";

const headersGetter: TextMapGetter<Headers> = {
  get: (carrier, key) => carrier.get(key) ?? undefined,
  keys: (carrier) => [...carrier.keys()],
};

export interface CreateAppOptions {
  sharedSecret: string;
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  const expected = Buffer.from(options.sharedSecret);

  const requireSecret = createMiddleware(async (c, next) => {
    // EventSource (used by tRPC SSE subscriptions) can't send custom headers,
    // so subscriptions authenticate via a `secret` query param instead.
    const headerSecret = c.req.header(SECRET_HEADER);
    const querySecret = c.req.query("secret");
    const provided = Buffer.from(headerSecret ?? querySecret ?? "");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    await next();
  });

  const extractTraceContext = createMiddleware(async (c, next) => {
    const active = propagation.extract(
      context.active(),
      c.req.raw.headers,
      headersGetter,
    );
    await context.with(active, next);
  });

  app.use("/trpc/*", requireSecret);
  app.use("/trpc/*", extractTraceContext);
  app.use("/trpc/*", trpcServer({ router: appRouter }));

  return app;
}
