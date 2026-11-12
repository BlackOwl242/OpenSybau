import assert from "node:assert/strict";
import { normalizeCodexQuotaWindows } from "../src/server/provider-quotas.mjs";
import { findQuotaPeriod, quotaWindowKind, quotaWindowsWithPeriods } from "../src/shared/quota-windows.js";

// Some accounts report only a weekly primary limit; it must never be called 5h.
const weeklyOnly = normalizeCodexQuotaWindows({ primary: { windowDurationMins: 10080, usedPercent: 14 } });
assert.equal(weeklyOnly[0].label, "7d");
assert.equal(weeklyOnly[0].remainingPercent, 86);
assert.equal(quotaWindowKind(weeklyOnly[0]), "7d");
assert.equal(quotaWindowsWithPeriods(weeklyOnly)[0].unavailable, true);

// Cover live and session-cache field names, including a missing weekly limit.
const both = normalizeCodexQuotaWindows({
  primary: { window_minutes: 300, used_percent: 22 },
  secondary: { window_minutes: 10080, used_percent: 37 },
});
assert.deepEqual(both.map((win) => [quotaWindowKind(win), win.remainingPercent]), [["5h", 78], ["7d", 63]]);
const missing = quotaWindowsWithPeriods([both[0]]);
assert.equal(missing[1].unavailable, true);
assert.equal(missing[1].remainingPercent, undefined);
assert.equal(quotaWindowKind({ label: "Sonnet 7d", windowMinutes: 10080 }), "7d");
assert.equal(findQuotaPeriod([{ label: "Sonnet 7d", windowMinutes: 10080 }], "7d"), undefined);
assert.equal(quotaWindowKind({ label: "weekly" }), "7d");
assert.equal(quotaWindowKind({ label: "other", windowMinutes: 60 }), "");
console.log("Quota window normalization and unavailable states passed.");
