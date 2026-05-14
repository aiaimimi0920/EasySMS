import { beforeEach, describe, expect, it, vi } from "vitest";

const homepageHtml = `
  <a style="text-decoration: none;" href="/sms/13802603245/">
    <div class="number-boxes-item d-flex flex-column">
      <div class="number-boxes-itemm-number">+13802603245</div>
      <div class="number-boxes-item-country number-boxess-item-country">United States</div>
      <div class="row mt-auto">
        <a href="/sms/13802603245/" class="number-boxes1-item-button">Open</a>
      </div>
    </div>
  </a>
  <a style="text-decoration: none;" href="/sms/447538299689/">
    <div class="number-boxes-item d-flex flex-column">
      <div class="number-boxes-itemm-number">+447538299689</div>
      <div class="number-boxes-item-country number-boxess-item-country">United Kingdom</div>
      <div class="row mt-auto">
        <a href="/sms/447538299689/" class="number-boxes1-item-button">Open</a>
      </div>
    </div>
  </a>
`;

const inboxHtml = `
  <div class="row message_details">
    <div class="col-md-3 sender"><label>Sender</label><br><a href="/receive-sms-from-12029965612/">12029965612</a></div>
    <div class="col-md-6 msg"><label>Message</label><br><span>Your CloudSigma verification code for MIA is <b>154920</b></span></div>
    <div class="col-md-3 time"><label>Time</label><br>29 minutes ago</div>
  </div>
  <div class="row message_details">
    <div class="col-md-3 sender"><label>Sender</label><br><a href="/receive-sms-from-Loans4u/">Loans4u</a></div>
    <div class="col-md-6 msg"><label>Message</label><br><span>Your DENT code is: <b>842711</b></span></div>
    <div class="col-md-3 time"><label>Time</label><br>37 minutes ago</div>
  </div>
`;

vi.mock("../../../src/providers/receive_smss/session-helper.js", () => ({
  detectReceiveSmssAccessGateHtml: () => false,
  resolveReceiveSmssAuthConfig: () => ({ username: "vmjcv666", password: "Qq365210!@#$%^" }),
  fetchReceiveSmssHtml: async (url: string) => {
    if (url === "https://receive-smss.com/") {
      return homepageHtml;
    }
    if (url === "https://receive-smss.com/sms/13802603245/") {
      return inboxHtml;
    }
    if (url === "https://receive-smss.com/sms/447538299689/") {
      return `
        <div class="row message_details">
          <div class="col-md-3 sender"><label>Sender</label><br><a href="/receive-sms-from-SmartLeads/">SmartLeads</a></div>
          <div class="col-md-6 msg"><label>Message</label><br><span>Your LeetCode verification code is <b>740209</b></span></div>
          <div class="col-md-3 time"><label>Time</label><br>12 minutes ago</div>
        </div>
      `;
    }
    throw new Error(`Unexpected receive_smss fixture URL: ${url}`);
  },
}));

describe("Receive-SMSS provider runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("lists live public numbers from the homepage document", async () => {
    const { createReceiveSmssProvider } = await import("../../../src/providers/receive_smss/index.js");

    const provider = createReceiveSmssProvider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
      providers: {
        receiveSmss: {
          username: "vmjcv666",
          password: "Qq365210!@#$%^",
        },
      },
    } as never);

    const items = await provider.listPublicNumbers({ limit: 5 });

    expect(items.map((item) => item.phoneNumber)).toEqual([
      "+13802603245",
      "+447538299689",
    ]);
    expect(items[0]?.latestActivityText).toBe("29 minutes ago");
    expect(items[1]?.latestActivityText).toBe("12 minutes ago");
  });

  it("parses inbox messages from message_details rows", async () => {
    const { createReceiveSmssProvider } = await import("../../../src/providers/receive_smss/index.js");

    const provider = createReceiveSmssProvider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
      providers: {
        receiveSmss: {
          username: "vmjcv666",
          password: "Qq365210!@#$%^",
        },
      },
    } as never);

    const inbox = await provider.getInbox(
      "eyJwcm92aWRlcktleSI6InJlY2VpdmVfc21zcyIsInNvdXJjZVVybCI6Imh0dHBzOi8vcmVjZWl2ZS1zbXNzLmNvbS9zbXMvMTM4MDI2MDMyNDUvIiwicGhvbmVOdW1iZXIiOiIrMTM4MDI2MDMyNDUiLCJjb3VudHJ5TmFtZSI6IlVuaXRlZCBTdGF0ZXMiLCJjb3VudHJ5Q29kZSI6IisxIn0",
    );

    expect(inbox.messages).toHaveLength(2);
    expect(inbox.messages[0]?.content).toContain("154920");
    expect(inbox.messages[0]?.sender).toBe("12029965612");
    expect(inbox.messages[0]?.receivedAtText).toBe("29 minutes ago");
  });
});
