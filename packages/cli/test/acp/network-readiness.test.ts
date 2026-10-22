import { expect } from "bun:test"
import { OpenCode } from "@opencode/client/effect"
import { OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { ConfigProvider, Deferred, Effect, Fiber, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { it } from "../../../core/test/lib/effect"
import { ACPCatalog } from "../../src/acp/catalog"

const wanted = {
  ...Model.Info.default(Provider.ID.make("test"), Model.ID.make("wanted")),
  variants: [{ id: Model.VariantID.make("medium") }],
}
const builtin = Model.Info.default(Provider.ID.make("builtin"), Model.ID.make("early"))
const connected = Schema.decodeUnknownSync(OpenCodeEvent)({ id: "evt_connected", type: "server.connected", data: {} })
const cwd = "/synthetic-readiness"
const settings = {
  OPENCODE_ACP_REQUIRED_MODEL: "test/wanted",
  OPENCODE_ACP_REQUIRED_VARIANT: "medium",
  OPENCODE_ACP_CATALOG_TIMEOUT_MS: "150",
}
const expectedModel = {
  providerID: Provider.ID.make("test"),
  id: Model.ID.make("wanted"),
  variant: Model.VariantID.make("medium"),
}

// 仅替换 HTTP 边界。实际 client 解码、catalog、超时和缓存均参与测试。
const fixture = Effect.fnUntraced(function* (mode: "ready" | "late" | "missing" | "hang" = "ready") {
  const state = { mode, calls: 0, signals: [] as AbortSignal[] }
  const reading = yield* Deferred.make<void>()
  const http = HttpClient.make((request, url, signal) =>
    Effect.gen(function* () {
      const reply = (data: unknown) =>
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data,
            location: { directory: cwd, project: { id: "global", directory: cwd } },
          }),
        )
      if (url.pathname === "/api/plugin")
        return reply([{ id: "fixture", source: { type: "builtin" }, state: { status: "active" }, features: {} }])
      state.signals.push(signal)
      if (state.signals.length === 4) yield* Deferred.succeed(reading, undefined)
      if (state.mode === "hang") return yield* Effect.callback<never>(() => undefined) // 不监听 abort。
      if (url.pathname === "/api/model") {
        state.calls++
        return reply(
          state.mode === "missing" || (state.mode === "late" && state.calls < 3) ? [builtin] : [builtin, wanted],
        )
      }
      if (url.pathname === "/api/model/default") return reply(builtin)
      if (url.pathname === "/api/agent") return reply([Agent.Info.default(Agent.ID.make("build"))])
      if (url.pathname === "/api/command") return reply([])
      return yield* Effect.die(new Error(`unexpected readiness request: ${request.method} ${url.pathname}`))
    }),
  )
  const client = yield* OpenCode.make({ baseUrl: "https://readiness.test" }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
  )
  const catalog = yield* ACPCatalog.make({
    ...client,
    event: { ...client.event, subscribe: () => Stream.make(connected).pipe(Stream.concat(Stream.never)) },
  })
  return {
    state,
    reading: Deferred.await(reading),
    request: (overrides: Record<string, string | undefined> = {}) =>
      catalog
        .get(cwd)
        .pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({ ...settings, ...overrides }),
          ),
        ),
  }
})

it.effect(
  "waits past builtin catalog, selects explicit target and variant, caches only readiness",
  Effect.gen(function* () {
    const test = yield* fixture("late")
    const pending = yield* test.request().pipe(Effect.forkScoped)
    yield* test.reading
    yield* TestClock.adjust("50 millis")
    const catalog = yield* Fiber.join(pending)
    expect(catalog.defaultModel).toEqual(expectedModel)
    expect(test.state.calls).toBe(3)
    expect(yield* test.request()).toBe(catalog)
    expect(test.state.calls).toBe(3)
  }),
)

it.effect(
  "missing target fails at the deadline without fallback; same-cwd failure is evicted",
  Effect.gen(function* () {
    const test = yield* fixture("missing")
    const pending = yield* test.request().pipe(Effect.forkScoped)
    yield* test.reading
    yield* TestClock.adjust("149 millis")
    expect(pending.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 milli")
    expect(yield* Fiber.join(pending).pipe(Effect.flip)).toMatchObject({
      safeMessage: "ACP catalog readiness deadline exceeded",
    })
    test.state.mode = "ready"
    expect((yield* test.request()).defaultModel).toEqual(expectedModel)
  }),
)

it.effect(
  "all four hanging reads receive abort at the default deadline even if transport ignores it",
  Effect.gen(function* () {
    const test = yield* fixture("hang")
    const pending = yield* test.request({ OPENCODE_ACP_CATALOG_TIMEOUT_MS: undefined }).pipe(Effect.forkScoped)
    yield* test.reading
    yield* TestClock.adjust("29999 millis")
    expect(pending.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 milli")
    expect(yield* Fiber.join(pending).pipe(Effect.flip)).toMatchObject({
      safeMessage: "ACP catalog readiness deadline exceeded",
    })
    expect(test.state.signals).toHaveLength(4)
    expect(test.state.signals.every((signal) => signal.aborted)).toBe(true)
  }),
)

it.effect(
  "invalid deadline, absent target and unavailable variant fail closed",
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* Effect.forEach(["0", "NaN", "1.5", "120001"], (value) =>
      test.request({ OPENCODE_ACP_CATALOG_TIMEOUT_MS: value }).pipe(
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => expect(error).toMatchObject({ message: expect.stringContaining("deadline") })),
        ),
      ),
    )
    expect(yield* test.request({ OPENCODE_ACP_REQUIRED_MODEL: undefined }).pipe(Effect.flip)).toMatchObject({
      message: "ACP requires an explicit provider/model target",
    })
    expect(test.state.calls).toBe(0)
    expect(yield* test.request({ OPENCODE_ACP_REQUIRED_VARIANT: "unavailable" }).pipe(Effect.flip)).toMatchObject({
      _tag: "ACPInvalidEffortError",
      effort: "unavailable",
    })
  }),
)
