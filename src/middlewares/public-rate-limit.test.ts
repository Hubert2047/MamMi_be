import { afterEach, describe, expect, it } from "vitest";
import {
  publicRateLimit,
  resetPublicRateLimitsForTest,
} from "./public-rate-limit.js";

const invoke = (
  middleware: ReturnType<typeof publicRateLimit>,
  request: { ip: string; params?: Record<string, string> },
) => {
  let status = 0;
  let body: any;
  let nextCalled = false;
  const response: any = {
    setHeader() {},
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
    },
  };
  middleware(request as any, response, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
};

afterEach(resetPublicRateLimitsForTest);

describe("public rate limit", () => {
  it("does not make two carts on the same Wi-Fi consume each other quota", () => {
    const middleware = publicRateLimit(
      "quote",
      1,
      60_000,
      (req: any) => `cart:${req.params.cartToken}`,
    );
    expect(
      invoke(middleware, { ip: "10.0.0.1", params: { cartToken: "cart-a" } })
        .nextCalled,
    ).toBe(true);
    expect(
      invoke(middleware, { ip: "10.0.0.1", params: { cartToken: "cart-b" } })
        .nextCalled,
    ).toBe(true);
  });

  it("returns 429 when one cart exceeds its own quota", () => {
    const middleware = publicRateLimit(
      "quote",
      1,
      60_000,
      (req: any) => `cart:${req.params.cartToken}`,
    );
    invoke(middleware, { ip: "10.0.0.1", params: { cartToken: "cart-a" } });
    const blocked = invoke(middleware, {
      ip: "10.0.0.1",
      params: { cartToken: "cart-a" },
    });
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("PUBLIC_RATE_LIMITED");
  });
});
