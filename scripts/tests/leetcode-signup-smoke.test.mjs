import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseClickableTextCandidate,
  chooseLeetCodeCountryOption,
  deriveLocalNumber,
  errorMessageFromUnknown,
  extractNewMessages,
  filterNumbersByCountryCode,
  getLeetCodeCountryOptionPrefix,
  normalizeDigits,
  resolveBrowserConnectionMode,
} from "../lib/leetcode-signup-smoke.mjs";

test("normalizeDigits strips non-digits", () => {
  assert.equal(normalizeDigits("+44 7308 892741"), "447308892741");
});

test("deriveLocalNumber removes country prefix from phone number", () => {
  assert.equal(
    deriveLocalNumber({
      phoneNumber: "+447308892741",
      countryCode: "+44",
    }),
    "7308892741",
  );
});

test("chooseLeetCodeCountryOption maps supported country codes", () => {
  assert.equal(
    chooseLeetCodeCountryOption({
      countryCode: "+44",
      countryName: "Britain",
    }),
    "(+44) 英国",
  );
  assert.equal(
    chooseLeetCodeCountryOption({
      countryCode: "+49",
      countryName: "Germany",
    }),
    "(+49) 德国",
  );
  assert.equal(
    chooseLeetCodeCountryOption({
      countryCode: "+1",
      countryName: "United States",
    }),
    "(+1) 美国",
  );
});

test("chooseLeetCodeCountryOption rejects unsupported country codes", () => {
  assert.throws(
    () =>
      chooseLeetCodeCountryOption({
        countryCode: "+353",
        countryName: "Ireland",
      }),
    /Unsupported LeetCode signup country/,
  );
});

test("getLeetCodeCountryOptionPrefix keeps only the dial-code portion needed for DOM matching", () => {
  assert.equal(getLeetCodeCountryOptionPrefix("+44"), "(+44)");
  assert.equal(getLeetCodeCountryOptionPrefix("+49"), "(+49)");
});

test("extractNewMessages returns only messages outside the baseline set", () => {
  const messages = [
    { id: "old-1", content: "old" },
    { id: "new-1", content: "new one" },
    { id: "new-2", content: "new two" },
  ];
  const baselineIds = new Set(["old-1"]);

  assert.deepEqual(extractNewMessages(messages, baselineIds), [
    { id: "new-1", content: "new one" },
    { id: "new-2", content: "new two" },
  ]);
});

test("extractNewMessages ignores older backfilled provider rows when ids move backwards", () => {
  const baselineIds = new Set(["21300918", "21300914"]);
  const messages = [
    { id: "21300859", content: "older backlog row" },
    { id: "21300857", content: "older backlog row 2" },
  ];

  assert.deepEqual(extractNewMessages(messages, baselineIds), []);
});

test("chooseClickableTextCandidate prefers the deepest pointer-like match", () => {
  const candidate = chooseClickableTextCandidate([
    { marker: "a", cursor: "auto", role: null, tagName: "DIV", depth: 1 },
    { marker: "b", cursor: "auto", role: null, tagName: "DIV", depth: 2 },
    { marker: "c", cursor: "pointer", role: null, tagName: "SPAN", depth: 3 },
  ]);

  assert.equal(candidate?.marker, "c");
});

test("resolveBrowserConnectionMode defaults to launched browser", () => {
  assert.deepEqual(resolveBrowserConnectionMode(undefined), {
    connection: "launch",
    headless: false,
    remoteDebuggingPort: null,
  });
});

test("resolveBrowserConnectionMode supports headless launch", () => {
  assert.deepEqual(resolveBrowserConnectionMode("headless"), {
    connection: "launch",
    headless: true,
    remoteDebuggingPort: null,
  });
});

test("resolveBrowserConnectionMode supports attach syntax", () => {
  assert.deepEqual(resolveBrowserConnectionMode("attach:9224"), {
    connection: "attach",
    headless: false,
    remoteDebuggingPort: 9224,
  });
});

test("resolveBrowserConnectionMode treats a bare port as attach mode", () => {
  assert.deepEqual(resolveBrowserConnectionMode("9224"), {
    connection: "attach",
    headless: false,
    remoteDebuggingPort: 9224,
  });
});

test("filterNumbersByCountryCode keeps only matching dial codes when a filter is provided", () => {
  const numbers = [
    { phoneNumber: "+34690124664", countryCode: "+34" },
    { phoneNumber: "+4915511267525", countryCode: "+49" },
  ];

  assert.deepEqual(filterNumbersByCountryCode(numbers, "+34"), [
    { phoneNumber: "+34690124664", countryCode: "+34" },
  ]);
  assert.deepEqual(filterNumbersByCountryCode(numbers, undefined), numbers);
});

test("errorMessageFromUnknown normalizes Error and non-Error throw values", () => {
  assert.equal(errorMessageFromUnknown(new Error("boom")), "boom");
  assert.equal(errorMessageFromUnknown("plain-text"), "plain-text");
});
