import { expect } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode/client/effect"
import { OpenCodeEvent, type OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { Effect, Fiber, Queue, Ref, type Scheduler, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import type { SelectedEvent } from "../../../client/src/shared-events"
import { it } from "../../../core/test/lib/effect"
import { ACPCapabilities } from "../../src/acp/capabilities"
import type { Catalog } from "../../src/acp/catalog"
import { ACPSessions } from "../../src/acp/sessions"
import { ACPTurn } from "../../src/acp/turn"
import { enqueued, makeSession, turn } from "./wire-fixture"

const sessionID = Session.ID.make("ses_cancel_barrier")
const decodeEvent = Schema.decodeUnknownSync(OpenCodeEvent)
const connected = decodeEvent({ id: "evt_connected", type: "server.connected", data: {} })

const fixture = Effect.fnUntraced(function* () {
  const subscriptions = new Set<Queue.Queue<OpenCodeEvent>>()
  const waiting = new Set<Queue.Queue<OpenCodeEvent>>()
  const submitted = yield* Queue.unbounded<{
    readonly id: string
    readonly dispatcher: Scheduler.SchedulerDispatcher
  }>()
  const requests: string[] = []
  const pending = new Set(["msg_other_queued"])
  const updates: SessionNotification[] = []
  const admission: { id?: string; text?: string } = {}
  const sequence = { value: 0 }
  const http = HttpClient.make((request, url) => {
    requests.push(`${request.method} ${url.pathname}`)
    if (url.pathname === `/api/session/${sessionID}/prompt` && admission.id)
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, enqueued(sessionID, admission.id, "user", { text: admission.text })),
      )
    if (url.pathname === `/api/session/${sessionID}/interrupt`)
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })))
    return Effect.die(new Error(`unexpected cancellation request: ${request.method} ${url.pathname}`))
  })
  const base = yield* OpenCode.make({ baseUrl: "https://cancel.test" }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
  )
  const client = {
    ...base,
    session: {
      ...base.session,
      prompt: (input: Parameters<typeof base.session.prompt>[0]) => {
        const id = input.id
        if (!id) return Effect.die(new Error("ACP must submit an explicit inbox ID"))
        admission.id = id
        admission.text = input.text
        return base.session.prompt(input).pipe(
          Effect.tap(() =>
            Effect.withFiber((fiber) => {
              pending.add(id)
              return Queue.offer(submitted, { id, dispatcher: fiber.currentDispatcher })
            }),
          ),
        )
      },
    },
    event: {
      ...base.event,
      subscribe: <Type extends Exclude<OpenCodeEvent["type"], "server.connected">>(input?: {
        readonly types?: ReadonlyArray<Type>
      }) =>
        Stream.unwrap(
          Effect.acquireRelease(
            Queue.unbounded<OpenCodeEvent>().pipe(Effect.tap((queue) => Effect.sync(() => subscriptions.add(queue)))),
            (queue) => Effect.sync(() => subscriptions.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue))),
          ).pipe(
            Effect.map((queue) =>
              Stream.make(connected).pipe(
                Stream.concat(
                  Stream.fromEffectRepeat(
                    Effect.sync(() => waiting.add(queue)).pipe(
                      Effect.andThen(Queue.take(queue)),
                      Effect.ensuring(Effect.sync(() => waiting.delete(queue))),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ).pipe(
          Stream.filter(
            (event): event is OpenCodeEvent & SelectedEvent<OpenCodeEvent, Type | "server.connected"> =>
              event.type === "server.connected" ||
              !input?.types?.length ||
              input.types.some((type) => type === event.type),
          ),
        ),
    },
  }
  const model = Model.Info.default(Provider.ID.make("test"), Model.ID.make("test-model"))
  const snapshot: Catalog = {
    models: [model],
    defaultModel: model,
    modes: [{ id: Agent.ID.make("build"), name: "Build" }],
    defaultModeID: Agent.ID.make("build"),
    commands: [],
  }
  const catalog = { get: () => Effect.succeed(snapshot), reload: () => Effect.void, changes: () => Stream.never }
  const connection = {
    sessionUpdate: (update: SessionNotification) =>
      Effect.sync(() => {
        updates.push(update)
      }),
    requestPermission: () => Effect.die(new Error("unexpected permission request")),
    createElicitation: () => Effect.die(new Error("unexpected elicitation request")),
    extNotification: () => Effect.die(new Error("unexpected extension notification")),
    responded: () => Effect.void,
  }
  const sessions = yield* ACPSessions.make({ client, connection, catalog })
  yield* sessions.attach(Schema.decodeUnknownSync(Session.Info)(makeSession(sessionID)), "/workspace", [])
  const service = yield* ACPTurn.make({
    client,
    connection,
    sessions,
    catalog,
    capabilities: yield* Ref.make(ACPCapabilities.parse(undefined)),
  })
  const waitingAfterSubmit = Effect.gen(function* () {
    const submission = yield* Queue.take(submitted)
    // submit 已返回。排空同一 dispatcher 后，事件 consumer 已等在空队列上；不靠 sleep 猜顺序。
    submission.dispatcher.flush()
    expect(subscriptions.size).toBe(2)
    expect(waiting.size).toBe(2)
    return submission.id
  })
  return {
    service,
    requests,
    pending,
    subscriptions,
    updates,
    waitingAfterSubmit,
    send: (...events: OpenCodeEventEncoded[]) =>
      Effect.forEach(
        events,
        (event) => {
          if (event.type === "session.inbox.delivered") pending.delete(event.data.inboxID)
          const seq = ++sequence.value
          const decoded = decodeEvent({
            ...event,
            id: `evt_${seq}`,
            created: seq,
            ...("durable" in event ? { durable: { ...event.durable, seq } } : {}),
          })
          return Effect.forEach(subscriptions, (queue) => Queue.offer(queue, decoded), { discard: true })
        },
        { discard: true },
      ),
  }
})

for (const cancellation of ["session/cancel", "request signal"] as const) {
  it.effect(
    `late ${cancellation} returns cancelled before delivery without another backend event`,
    Effect.gen(function* () {
      const test = yield* fixture()
      const controller = new AbortController()
      const prompt = { sessionId: sessionID, prompt: [{ type: "text" as const, text: "synthetic pending input" }] }
      const response = yield* test.service.prompt(prompt, controller.signal).pipe(Effect.forkScoped)
      const inboxID = yield* test.waitingAfterSubmit
      expect(response.pollUnsafe()).toBeUndefined()
      expect(test.pending).toEqual(new Set(["msg_other_queued", inboxID]))
      const cancel =
        cancellation === "session/cancel"
          ? test.service.cancel({ sessionId: sessionID })
          : Effect.sync(() => controller.abort())
      const result = yield* cancel.pipe(
        Effect.andThen(Fiber.join(response)),
        Effect.timeout("2 seconds"),
        TestClock.withLive,
      )
      expect(result.stopReason).toBe("cancelled")
      expect(test.requests).toEqual([
        `POST /api/session/${sessionID}/prompt`,
        `POST /api/session/${sessionID}/interrupt`,
      ])
      expect(test.subscriptions.size).toBe(1)
      expect(test.pending).toEqual(new Set(["msg_other_queued", inboxID]))

      const next = yield* test.service.prompt(prompt, new AbortController().signal).pipe(Effect.forkScoped)
      const nextID = yield* test.waitingAfterSubmit
      expect(nextID).not.toBe(inboxID)
      yield* test.send(...turn(sessionID, nextID))
      expect((yield* Fiber.join(next)).stopReason).toBe("end_turn")
      expect(test.subscriptions.size).toBe(1)
      expect(test.pending).toEqual(new Set(["msg_other_queued", inboxID]))
    }),
  )
}
