import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import { extractQuackrBrowserGateMessage } from "../../../src/providers/quackr/index.js";

describe("Quackr browser fallback", () => {
  it("detects the browser-rendered register-or-login gate", () => {
    const $ = load(`
      <div>
        <p>
          Unfortunately due to new regulations, Netherlands virtual numbers are required to register
          or log in before accessing our content. We apologize for any inconvenience and appreciate
          your understanding.
        </p>
      </div>
    `);

    expect(extractQuackrBrowserGateMessage($)).toContain(
      "required to register or log in before accessing our content",
    );
  });
});
