/**
 * AI 語意解析：Google Gemini（免費額度最高、支援 JSON Schema 結構化輸出）
 *
 * 預設模型 gemini-2.5-flash-lite（免費層、高吞吐、適合抽欄位）。
 * 可用 Secrets GEMINI_MODEL 覆寫；失敗時自動回退其他 Flash 模型。
 *
 * 嚴禁發明 url：只准使用爬蟲實際抓到的 <a href>。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
].filter((m, i, arr) => m && arr.indexOf(m) === i);

const OFFER_ITEM_SCHEMA = {
  type: "object",
  properties: {
    bank_name: { type: "string" },
    title: { type: "string" },
    rewards: { type: "string" },
    conditions: {
      type: "array",
      items: { type: "string" },
    },
    requires_registration: { type: "string", enum: ["Yes", "No"] },
    deadline: { type: "string" },
    url: { type: "string" },
  },
  required: [
    "bank_name",
    "title",
    "rewards",
    "conditions",
    "requires_registration",
    "deadline",
    "url",
  ],
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    offers: {
      type: "array",
      items: OFFER_ITEM_SCHEMA,
    },
  },
  required: ["offers"],
};

const SKIP_HREF_RE =
  /^(javascript:|mailto:|tel:|sms:|#)/i;
const SKIP_PATH_RE =
  /login|signin|privacy|cookie|terms|career|recruit|accessibility|facebook|instagram|youtube|linkedin|twitter|weibo/i;

function hongKongNow() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }),
  );
}

function hongKongDateStr(date = hongKongNow()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysUntil(deadline) {
  if (!deadline || deadline === "額滿即止") return null;
  const m = String(deadline).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const target = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
  const today = new Date(`${hongKongDateStr()}T00:00:00+08:00`);
  return Math.round((target - today) / 86400000);
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function offerId(bankName, title) {
  return crypto
    .createHash("sha256")
    .update(`${normalizeKey(bankName)}|${normalizeKey(title)}`)
    .digest("hex")
    .slice(0, 16);
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function canonicalizeUrl(href) {
  try {
    const u = new URL(href);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
      (k) => u.searchParams.delete(k),
    );
    return u.toString();
  } catch {
    return href;
  }
}

function filterHarvestedLinks(links, listingUrl) {
  const seen = new Set();
  const listingHost = (() => {
    try {
      return new URL(listingUrl).hostname;
    } catch {
      return "";
    }
  })();

  return (links || [])
    .map((item) => {
      const href = typeof item === "string" ? item : item.href;
      const text = typeof item === "string" ? "" : item.text || "";
      if (!href || SKIP_HREF_RE.test(href)) return null;
      if (!isHttpUrl(href)) return null;
      if (SKIP_PATH_RE.test(href)) return null;
      const canonical = canonicalizeUrl(href);
      if (seen.has(canonical)) return null;
      seen.add(canonical);
      return { href: canonical, text: String(text).trim().slice(0, 180) };
    })
    .filter(Boolean)
    .slice(0, 100)
    .concat(
      listingUrl
        ? [{ href: canonicalizeUrl(listingUrl), text: "listing" }]
        : [],
    )
    .filter((item, idx, arr) => arr.findIndex((x) => x.href === item.href) === idx);
}

function pickAllowedUrl(candidate, harvested, listingUrl) {
  const allowed = new Set(harvested.map((l) => canonicalizeUrl(l.href)));
  allowed.add(canonicalizeUrl(listingUrl));

  if (candidate && isHttpUrl(candidate)) {
    const canonical = canonicalizeUrl(candidate);
    if (allowed.has(canonical)) return canonical;
    const match = harvested.find(
      (l) =>
        canonical.startsWith(l.href) ||
        l.href.startsWith(canonical) ||
        l.href.split("?")[0] === canonical.split("?")[0],
    );
    if (match) return match.href;
  }
  return canonicalizeUrl(listingUrl);
}

function normalizeDeadline(raw) {
  if (!raw) return "額滿即止";
  const text = String(raw).trim();
  if (/額滿即止|先到先得|while stocks last|until further notice|直至另行通知/i.test(text)) {
    return "額滿即止";
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cn) {
    return `${cn[1]}-${String(cn[2]).padStart(2, "0")}-${String(cn[3]).padStart(2, "0")}`;
  }
  const slash = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return `${slash[3]}-${String(slash[2]).padStart(2, "0")}-${String(slash[1]).padStart(2, "0")}`;
  }
  return "額滿即止";
}

function buildPrompt(bank, scrapeResult, harvested) {
  const linkLines = harvested
    .map((l, i) => `${i + 1}. ${l.href}${l.text ? `  |  ${l.text}` : ""}`)
    .join("\n");

  return `你是香港銀行／支付平台優惠資訊抽取器。只根據「網頁純文字」與「已抓取超連結」抽取優惠，禁止臆測。

平台名稱：${bank.name}
總覽頁 URL：${scrapeResult.finalUrl || bank.url}

【硬性規則】
1. url 欄位必須是下列「已抓取超連結」清單中的原始 href 之一。若找不到對應連結，使用總覽頁 URL。禁止發明、改寫或拼接未出現的網址。
2. 忽略登入、私隱政策、Cookie、招聘、純品牌介紹、沒有實際獎賞的一般產品頁。
3. 最多抽出 12 個最重要、具時效或明確獎賞的優惠。
4. requires_registration 只能是 "Yes" 或 "No"。若文中提到須登記／報名／註冊，填 Yes。
5. deadline 用 YYYY-MM-DD；若沒有明確日期或寫額滿即止／先到先得，填 "額滿即止"。
6. conditions 為持卡人要完成的任務條件陣列（例如指定簽賬額、指定商戶、須於 App 登記）。沒有則給空陣列。
7. rewards 用一句話說明獎賞（現金回贈、里數、折扣、禮品等）。
8. title 精煉，不要整段條款。
9. bank_name 固定為「${bank.name}」。
10. 回傳 JSON 物件：{"offers":[...]}。

【已抓取超連結】
${linkLines || "(無)"}

【網頁純文字】
${(scrapeResult.text || "").slice(0, 80000)}
`;
}

async function callGemini(model, prompt, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`Gemini ${model} HTTP ${res.status}: ${raw.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }

  const json = JSON.parse(raw);
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
    "";
  if (!text) {
    throw new Error(`Gemini ${model} 回傳空白（可能被安全過濾）`);
  }
  return text;
}

function parseJsonPayload(text) {
  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.offers)) return parsed.offers;
  return [];
}

async function extractOffersWithAi(bank, scrapeResult) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("未設定 GEMINI_API_KEY，略過 AI 解析");
  }

  const harvested = filterHarvestedLinks(scrapeResult.links, scrapeResult.finalUrl || bank.url);
  const prompt = buildPrompt(bank, scrapeResult, harvested);

  let lastError;
  for (const model of DEFAULT_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[ai] ${bank.name} → ${model} (attempt ${attempt})`);
        const text = await callGemini(model, prompt, apiKey);
        const items = parseJsonPayload(text);
        return items
          .filter((item) => item && item.title)
          .map((item) => {
            const title = String(item.title).trim().slice(0, 180);
            const deadline = normalizeDeadline(item.deadline);
            const url = pickAllowedUrl(
              item.url,
              harvested,
              scrapeResult.finalUrl || bank.url,
            );
            const registration = /yes|是|須|需要/i.test(
              String(item.requires_registration || ""),
            )
              ? "Yes"
              : "No";
            return {
              id: offerId(bank.name, title),
              bank_id: bank.id,
              bank_name: bank.name,
              title,
              rewards: String(item.rewards || "").trim().slice(0, 500),
              conditions: Array.isArray(item.conditions)
                ? item.conditions.map((c) => String(c).trim()).filter(Boolean).slice(0, 12)
                : [],
              requires_registration: registration,
              deadline,
              url,
            };
          });
      } catch (err) {
        lastError = err;
        const retryable = err.status === 429 || err.status === 503 || err.status === 404;
        if (err.status === 404) break;
        if (retryable && attempt < 3) {
          const wait = 1500 * 2 ** (attempt - 1);
          console.warn(`[ai] ${bank.name} 重試 ${model}，等待 ${wait}ms：${err.message}`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!retryable) break;
      }
    }
  }
  throw lastError || new Error("Gemini 解析失敗");
}

function mergeOffers({ previous = {}, incomingByBank, errors, banks }) {
  const today = hongKongDateStr();
  const prevOffers = Array.isArray(previous.offers) ? previous.offers : [];
  const prevMap = new Map(prevOffers.map((o) => [o.id, o]));
  const next = [];
  const seenIds = new Set();

  for (const bank of banks) {
    const scrapeFailed = errors.some((e) => e.bank_id === bank.id);
    const incoming = incomingByBank.get(bank.id) || [];

    if (scrapeFailed) {
      for (const old of prevOffers.filter((o) => o.bank_id === bank.id)) {
        next.push({ ...old, isNew: isStillNew(old, today) });
        seenIds.add(old.id);
      }
      continue;
    }

    for (const offer of incoming) {
      const old = prevMap.get(offer.id);
      const firstSeenDate = old?.firstSeenDate || today;
      const merged = {
        ...offer,
        firstSeenDate,
        lastSeenDate: today,
        isNew: !old || daysBetween(firstSeenDate, today) <= 7,
        status: isExpired(offer.deadline, today) ? "expired" : "active",
      };
      if (merged.status === "expired") merged.isNew = false;
      next.push(merged);
      seenIds.add(offer.id);
    }

    for (const old of prevOffers.filter((o) => o.bank_id === bank.id)) {
      if (seenIds.has(old.id)) continue;
      next.push({
        ...old,
        isNew: false,
        status: "expired",
        expiredDate: old.expiredDate || today,
      });
      seenIds.add(old.id);
    }
  }

  for (const old of prevOffers) {
    if (!seenIds.has(old.id)) {
      next.push({ ...old, isNew: false, status: old.status || "expired" });
    }
  }

  next.sort((a, b) => {
    if (Boolean(b.isNew) - Boolean(a.isNew)) return Boolean(b.isNew) - Boolean(a.isNew);
    if ((a.status === "expired") !== (b.status === "expired")) {
      return a.status === "expired" ? 1 : -1;
    }
    return String(a.deadline).localeCompare(String(b.deadline));
  });

  return next;
}

function daysBetween(fromYmd, toYmd) {
  const a = new Date(`${fromYmd}T00:00:00+08:00`);
  const b = new Date(`${toYmd}T00:00:00+08:00`);
  return Math.round((b - a) / 86400000);
}

function isStillNew(offer, today) {
  if (!offer?.firstSeenDate) return false;
  if (offer.status === "expired") return false;
  return daysBetween(offer.firstSeenDate, today) <= 7;
}

function isExpired(deadline, today) {
  const left = daysUntil(deadline);
  return left !== null && left < 0;
}

function loadPreviousData(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { offers: [], errors: [] };
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn("[ai] 無法讀取舊 data.json，視為空白：", err.message);
    return { offers: [], errors: [] };
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

function formatOfferLine(offer, tag) {
  return [
    `${tag} ${offer.bank_name}｜${offer.title}`,
    `🎁 ${offer.rewards || "詳見官網"}`,
    `📅 截止：${offer.deadline}`,
    offer.url ? `🔗 ${offer.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendNotifications(offers) {
  const today = hongKongDateStr();
  const fresh = offers.filter((o) => o.status === "active" && o.isNew);
  const expiring = offers.filter((o) => {
    if (o.status !== "active") return false;
    const left = daysUntil(o.deadline);
    return left !== null && left >= 0 && left <= 7;
  });

  if (!fresh.length && !expiring.length) {
    console.log("[notify] 無新優惠或 7 天內到期項目，略過推播");
    return;
  }

  const chunks = [];
  for (const offer of fresh.slice(0, 8)) {
    chunks.push(formatOfferLine(offer, "🆕 新優惠"));
  }
  if (fresh.length > 8) {
    chunks.push(`🆕 另有 ${fresh.length - 8} 個新優惠，請開啟 Dashboard 查看。`);
  }
  for (const offer of expiring.slice(0, 8)) {
    const left = daysUntil(offer.deadline);
    chunks.push(formatOfferLine(offer, `🔴 ${left} 天內到期`));
  }

  const header = `🇭🇰 香港銀行優惠情報（${today} HKT）\n新優惠 ${fresh.length} 則 · 7 天內到期 ${expiring.length} 則`;
  const messages = [header, ...chunks];

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChat = process.env.TELEGRAM_CHAT_ID;
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;

  if (telegramToken && telegramChat) {
    for (const text of messages) {
      try {
        await postJson(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChat,
          text,
          disable_web_page_preview: true,
        });
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        console.warn("[notify] Telegram 失敗：", err.message);
      }
    }
  }

  if (discordUrl) {
    try {
      await postJson(discordUrl, {
        content: messages.join("\n\n").slice(0, 1900),
      });
    } catch (err) {
      console.warn("[notify] Discord 失敗：", err.message);
    }
  }

  if (!telegramToken && !discordUrl) {
    console.log("[notify] 未設定 Telegram / Discord Webhook，略過推播");
  }
}

function buildDashboardPayload({ banks, offers, errors, startedAt }) {
  return {
    lastUpdated: hongKongNow().toISOString(),
    lastUpdatedHkt: hongKongNow().toLocaleString("zh-HK", {
      timeZone: "Asia/Hong_Kong",
      hour12: false,
    }),
    generatedBy: "scripts/scraper.js + Gemini",
    banks: banks.map((b) => ({
      id: b.id,
      name: b.name,
      nameEn: b.nameEn,
      url: b.url,
      enabled: b.enabled !== false,
    })),
    errors,
    stats: {
      total: offers.length,
      active: offers.filter((o) => o.status === "active").length,
      isNew: offers.filter((o) => o.isNew && o.status === "active").length,
      expiring7d: offers.filter((o) => {
        const left = daysUntil(o.deadline);
        return o.status === "active" && left !== null && left >= 0 && left <= 7;
      }).length,
      durationMs: Date.now() - startedAt,
    },
    offers,
  };
}

function injectEmbeddedData(html, data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const replaced = html.replace(
    /<script type="application\/json" id="embedded-data">[\s\S]*?<\/script>/,
    `<script type="application/json" id="embedded-data">${json}</script>`,
  );
  if (replaced === html) {
    throw new Error("index.html 缺少 embedded-data 標記，無法寫入最新資料");
  }
  return replaced.replace(
    /<meta name="last-updated" content="[^"]*">/,
    `<meta name="last-updated" content="${data.lastUpdatedHkt || data.lastUpdated || ""}">`,
  );
}

function writeOutputs(data) {
  const root = path.join(__dirname, "..");
  const dataPath = path.join(root, "data.json");
  const htmlPath = path.join(root, "index.html");
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");
  fs.writeFileSync(htmlPath, injectEmbeddedData(html, data), "utf8");
  console.log(`[out] 已寫入 data.json（${data.offers.length} 則）與 index.html`);
}

module.exports = {
  extractOffersWithAi,
  mergeOffers,
  loadPreviousData,
  sendNotifications,
  buildDashboardPayload,
  writeOutputs,
  daysUntil,
  hongKongDateStr,
};
