"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createPushoverNotifier } = require("../src/notifier");

describe("pushover notifier", () => {
  it("sends success notification for cursor SessionEnd + sleeping", async () => {
    const calls = [];
    const notifier = createPushoverNotifier({
      env: {
        PUSHOVER_ENABLED: "true",
        PUSHOVER_APP_TOKEN: "app-token",
        PUSHOVER_USER_KEY: "user-key",
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
      },
    });

    const result = await notifier.sendCursorTerminalNotification({
      agentId: "cursor-agent",
      event: "SessionEnd",
      state: "sleeping",
      sessionId: "s0",
      occurredAt: Date.now(),
    });

    assert.deepStrictEqual(result, { sent: true });
    assert.strictEqual(calls.length, 1);
  });

  it("sends success notification for codex task_complete + attention", async () => {
    const calls = [];
    const notifier = createPushoverNotifier({
      env: {
        PUSHOVER_ENABLED: "true",
        PUSHOVER_APP_TOKEN: "app-token",
        PUSHOVER_USER_KEY: "user-key",
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
      },
    });

    const result = await notifier.sendCursorTerminalNotification({
      agentId: "codex",
      event: "event_msg:task_complete",
      state: "attention",
      sessionId: "codex:s1",
      occurredAt: Date.now(),
    });

    assert.deepStrictEqual(result, { sent: true });
    assert.strictEqual(calls.length, 1);
  });

  it("sends failure notification for cursor StopFailure", async () => {
    const calls = [];
    const notifier = createPushoverNotifier({
      env: {
        PUSHOVER_ENABLED: "1",
        PUSHOVER_APP_TOKEN: "app-token",
        PUSHOVER_USER_KEY: "user-key",
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
      },
    });

    const result = await notifier.sendCursorTerminalNotification({
      agentId: "cursor-agent",
      event: "StopFailure",
      state: "error",
      sessionId: "s2",
      occurredAt: Date.now(),
    });

    assert.deepStrictEqual(result, { sent: true });
    assert.strictEqual(calls.length, 1);
  });

  it("dedupes same session and event inside window", async () => {
    let nowValue = 1000;
    const notifier = createPushoverNotifier({
      env: {
        PUSHOVER_ENABLED: "true",
        PUSHOVER_APP_TOKEN: "app-token",
        PUSHOVER_USER_KEY: "user-key",
      },
      now: () => nowValue,
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    const first = await notifier.sendCursorTerminalNotification({
      agentId: "cursor-agent",
      event: "Stop",
      state: "attention",
      sessionId: "s3",
    });
    nowValue += 5000;
    const second = await notifier.sendCursorTerminalNotification({
      agentId: "cursor-agent",
      event: "Stop",
      state: "attention",
      sessionId: "s3",
    });

    assert.deepStrictEqual(first, { sent: true });
    assert.deepStrictEqual(second, { skipped: "duplicate" });
  });

  it("skips when token or user key is missing", async () => {
    const notifier = createPushoverNotifier({
      env: {
        PUSHOVER_ENABLED: "true",
        PUSHOVER_APP_TOKEN: "",
        PUSHOVER_USER_KEY: "",
      },
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    const result = await notifier.sendCursorTerminalNotification({
      agentId: "cursor-agent",
      event: "Stop",
      state: "attention",
      sessionId: "s4",
    });

    assert.deepStrictEqual(result, { skipped: "missing-config" });
  });
});

describe("telegram notifier", () => {
  it("sends success notification for cursor Stop + attention", async () => {
    const calls = [];
    const notifier = createPushoverNotifier({
      env: {
        TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_CHAT_ID: "chat-id",
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
      },
    });

    const result = await notifier.sendCursorTerminalTelegramNotification({
      agentId: "cursor-agent",
      event: "Stop",
      state: "attention",
      sessionId: "t1",
      occurredAt: Date.now(),
    });

    assert.deepStrictEqual(result, { sent: true });
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /api\.telegram\.org/);
  });

  it("dedupes same session and event inside window", async () => {
    let nowValue = 2000;
    const notifier = createPushoverNotifier({
      env: {
        TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_CHAT_ID: "chat-id",
      },
      now: () => nowValue,
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    const first = await notifier.sendCursorTerminalTelegramNotification({
      agentId: "cursor-agent",
      event: "StopFailure",
      state: "error",
      sessionId: "t2",
    });
    nowValue += 3000;
    const second = await notifier.sendCursorTerminalTelegramNotification({
      agentId: "cursor-agent",
      event: "StopFailure",
      state: "error",
      sessionId: "t2",
    });

    assert.deepStrictEqual(first, { sent: true });
    assert.deepStrictEqual(second, { skipped: "duplicate" });
  });

  it("skips when token or chat id is missing", async () => {
    const notifier = createPushoverNotifier({
      env: {
        TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_CHAT_ID: "",
      },
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    const result = await notifier.sendCursorTerminalTelegramNotification({
      agentId: "cursor-agent",
      event: "Stop",
      state: "attention",
      sessionId: "t3",
    });

    assert.deepStrictEqual(result, { skipped: "missing-config" });
  });
});
