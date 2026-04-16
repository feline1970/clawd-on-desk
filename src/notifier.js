"use strict";

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEDUPE_WINDOW_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;

function isEnvEnabled(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function classifyCursorTerminalResult(agentId, event, state) {
  if (agentId === "display-state") {
    if (state === "attention" || state === "mini-happy") return "success";
    if (state === "error" || state === "mini-alert") return "failure";
    return null;
  }
  if (agentId === "cursor-agent") {
    if (event === "Stop") return "success";
    if (event === "SessionEnd" && state === "sleeping") return "success";
    if (event === "StopFailure" || state === "error") return "failure";
    return null;
  }
  if (agentId === "codex") {
    if (event === "event_msg:task_complete" && state === "attention") return "success";
    if (state === "error") return "failure";
    return null;
  }
  return null;
}

function formatSessionLabel(sessionId) {
  const safe = sessionId || "default";
  if (safe === "default" || safe === "display-global") return safe;
  return safe.length > 6 ? `...${safe.slice(-6)}` : safe;
}

function formatSourceLabel(source) {
  if (!source) return "unknown";
  if (source === "cursor-agent") return "cursor";
  return source;
}

function buildNotificationText(payload, result, tsNow) {
  const safeSessionId = payload.sessionId || "default";
  const outcomeText = result === "success" ? "成功" : "失败";
  const title = result === "success" ? "Agent 执行完成" : "Agent 执行失败";
  const lines = [
    `结果：${outcomeText}`,
    `状态：${payload.state || "unknown"}`,
    `会话：${formatSessionLabel(safeSessionId)}`,
    `来源：${formatSourceLabel(payload.sourceAgent || payload.agentId)}`,
    `项目：${payload.projectName || "-"}`,
    `时间：${new Date(payload.occurredAt || tsNow).toLocaleString()}`,
  ];
  return {
    title,
    message: lines.join("\n"),
    dedupeKey: `${safeSessionId}:${result}:${payload.event || "unknown"}`,
    safeSessionId,
  };
}

function createPushoverNotifier(options = {}) {
  const env = options.env || process.env;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requestTimeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : REQUEST_TIMEOUT_MS;
  const dedupeWindowMs = Number.isFinite(options.dedupeWindowMs) ? options.dedupeWindowMs : DEDUPE_WINDOW_MS;

  const pushoverEnabled = isEnvEnabled(env.PUSHOVER_ENABLED);
  const pushoverToken = typeof env.PUSHOVER_APP_TOKEN === "string" ? env.PUSHOVER_APP_TOKEN.trim() : "";
  const pushoverUser = typeof env.PUSHOVER_USER_KEY === "string" ? env.PUSHOVER_USER_KEY.trim() : "";
  const telegramEnabled = isEnvEnabled(env.TELEGRAM_ENABLED);
  const telegramToken = typeof env.TELEGRAM_BOT_TOKEN === "string" ? env.TELEGRAM_BOT_TOKEN.trim() : "";
  const telegramChatId = typeof env.TELEGRAM_CHAT_ID === "string" ? env.TELEGRAM_CHAT_ID.trim() : "";
  const pushoverDedupe = new Map();
  const telegramDedupe = new Map();

  function cleanupDedupe(map, tsNow) {
    for (const [key, ts] of map.entries()) {
      if (tsNow - ts > dedupeWindowMs) map.delete(key);
    }
  }

  function markAndCheckDuplicate(map, dedupeKey, tsNow) {
    cleanupDedupe(map, tsNow);
    const lastTs = map.get(dedupeKey);
    if (lastTs && tsNow - lastTs <= dedupeWindowMs) return true;
    map.set(dedupeKey, tsNow);
    return false;
  }

  async function sendCursorTerminalNotification(payload = {}) {
    const result = classifyCursorTerminalResult(payload.agentId, payload.event, payload.state);
    if (!result) return { skipped: "not-terminal-event" };
    if (!pushoverEnabled) return { skipped: "disabled" };
    if (!pushoverToken || !pushoverUser) return { skipped: "missing-config" };
    if (typeof fetchImpl !== "function") return { skipped: "fetch-unavailable" };

    const tsNow = now();
    const text = buildNotificationText(payload, result, tsNow);
    if (markAndCheckDuplicate(pushoverDedupe, text.dedupeKey, tsNow)) return { skipped: "duplicate" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const body = new URLSearchParams({
        token: pushoverToken,
        user: pushoverUser,
        title: text.title,
        message: text.message,
        priority: result === "failure" ? "1" : "0",
      });
      const res = await fetchImpl(PUSHOVER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        return { skipped: "http-error", status: res.status };
      }
      return { sent: true };
    } catch (err) {
      return { skipped: "network-error", error: err && err.message ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendCursorTerminalTelegramNotification(payload = {}) {
    const result = classifyCursorTerminalResult(payload.agentId, payload.event, payload.state);
    if (!result) return { skipped: "not-terminal-event" };
    if (!telegramEnabled) return { skipped: "disabled" };
    if (!telegramToken || !telegramChatId) return { skipped: "missing-config" };
    if (typeof fetchImpl !== "function") return { skipped: "fetch-unavailable" };

    const tsNow = now();
    const text = buildNotificationText(payload, result, tsNow);
    if (markAndCheckDuplicate(telegramDedupe, text.dedupeKey, tsNow)) return { skipped: "duplicate" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetchImpl(`${TELEGRAM_API_BASE}/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: `${text.title}\n${text.message}`,
          disable_notification: result !== "failure",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { skipped: "http-error", status: res.status };
      }
      return { sent: true };
    } catch (err) {
      return { skipped: "network-error", error: err && err.message ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    sendCursorTerminalNotification,
    sendCursorTerminalTelegramNotification,
    classifyCursorTerminalResult,
  };
}

module.exports = {
  createPushoverNotifier,
  classifyCursorTerminalResult,
};
