import { randomUUID } from "node:crypto";

const MAX_SPANS_PER_TASK = 120;
const MAX_GLOBAL_SPANS = 300;

/**
 * Lightweight OpenTelemetry GenAI semantic span collector for internal stage tracing
 * and opt-in OTLP/HTTP JSON trace ingestion (`POST /api/otel/v1/traces`).
 */
export function createOtelTelemetryCollector() {
  const globalSpans = [];

  function recordGenAiSpan(task, spanInput = {}) {
    const startMs = Number(spanInput.startMs || Date.now());
    const durationMs = Math.max(0, Number(spanInput.durationMs || 0));
    const span = {
      traceId: spanInput.traceId || task?.id || randomUUID().replaceAll("-", ""),
      spanId: spanInput.spanId || randomUUID().slice(0, 16),
      taskId: task?.id || spanInput.taskId || "",
      name: String(spanInput.name || `gen_ai.${spanInput.stage || "stage"}`),
      attributes: {
        "gen_ai.operation.name": String(spanInput.operation || spanInput.stage || "chat"),
        "gen_ai.system": String(spanInput.provider || "unknown"),
        "gen_ai.request.model": String(spanInput.model || ""),
        "gen_ai.usage.input_tokens": Number(spanInput.usage?.input_tokens || spanInput.usage?.prompt_tokens || 0),
        "gen_ai.usage.output_tokens": Number(spanInput.usage?.output_tokens || spanInput.usage?.completion_tokens || 0),
        "gen_ai.usage.cached_tokens": Number(spanInput.usage?.cached_input_tokens || 0),
      },
      status: String(spanInput.status || "OK"),
      startTimeMs: startMs,
      endTimeMs: startMs + durationMs,
      durationMs,
      recordedAt: new Date().toISOString(),
    };
    if (task && typeof task === "object") {
      task.telemetrySpans ||= [];
      task.telemetrySpans = [...task.telemetrySpans, span].slice(-MAX_SPANS_PER_TASK);
    }
    globalSpans.push(span);
    if (globalSpans.length > MAX_GLOBAL_SPANS) {
      globalSpans.splice(0, globalSpans.length - MAX_GLOBAL_SPANS);
    }
    return span;
  }

  function ingestOtlpPayload(payload, tasksById = new Map()) {
    const resourceSpans = Array.isArray(payload?.resourceSpans) ? payload.resourceSpans : [];
    let accepted = 0;
    for (const rs of resourceSpans) {
      for (const ss of Array.isArray(rs?.scopeSpans) ? rs.scopeSpans : []) {
        for (const rawSpan of Array.isArray(ss?.spans) ? ss.spans : []) {
          const attrs = {};
          for (const a of Array.isArray(rawSpan?.attributes) ? rawSpan.attributes : []) {
            if (a?.key) attrs[a.key] = a.value?.stringValue ?? a.value?.intValue ?? a.value?.doubleValue ?? a.value?.boolValue ?? "";
          }
          const taskId = String(attrs["opensybau.task_id"] || attrs["session.id"] || "");
          const startNano = Number(rawSpan.startTimeUnixNano || 0);
          const endNano = Number(rawSpan.endTimeUnixNano || startNano);
          const durationMs = startNano && endNano >= startNano ? Math.round((endNano - startNano) / 1_000_000) : 0;
          const span = {
            traceId: String(rawSpan.traceId || ""),
            spanId: String(rawSpan.spanId || randomUUID().slice(0, 16)),
            taskId,
            name: String(rawSpan.name || "otlp.span"),
            attributes: attrs,
            status: rawSpan.status?.code === 2 ? "ERROR" : "OK",
            startTimeMs: startNano ? Math.round(startNano / 1_000_000) : Date.now(),
            endTimeMs: endNano ? Math.round(endNano / 1_000_000) : Date.now(),
            durationMs,
            recordedAt: new Date().toISOString(),
          };
          const task = taskId ? tasksById.get(taskId) : null;
          if (task) {
            task.telemetrySpans ||= [];
            task.telemetrySpans = [...task.telemetrySpans, span].slice(-MAX_SPANS_PER_TASK);
          }
          globalSpans.push(span);
          accepted += 1;
        }
      }
    }
    if (globalSpans.length > MAX_GLOBAL_SPANS) {
      globalSpans.splice(0, globalSpans.length - MAX_GLOBAL_SPANS);
    }
    return { accepted };
  }

  function listSpans(task = null) {
    if (task) return Array.isArray(task.telemetrySpans) ? task.telemetrySpans : [];
    return [...globalSpans];
  }

  return { recordGenAiSpan, ingestOtlpPayload, listSpans };
}
