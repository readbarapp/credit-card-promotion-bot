/**
 * AI 語意解析（香港可用）
 *
 * 香港常見情況：Gemini 開唔到 key、Groq 連 IP 都 block。
 * 因此預設優先 OpenRouter（香港可申請），再 Groq / Gemini。
 *
 * 優先次序（有金鑰先用）：
 *   1. OpenRouter  OPENROUTER_API_KEY  香港可用、免費 :free 模型
 *   2. Groq        GROQ_API_KEY        部分網絡會 block IP
 *   3. Gemini      GEMINI_API_KEY      香港帳戶通常開唔到
 *   4. 規則抽取     無金鑰時仍可產出卡片（品質較低）
 *
 * 可用 AI_PROVIDER=groq|openrouter|gemini 強制指定。
 * 可用 AI_MODEL 覆寫模型名稱。
 *
 * 嚴禁發明 url：只准使用爬蟲實際抓到的 <a href>。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { fetchImageDataUrl, pickOfferImages } = require("./offer-images");

let lastAiBackend = "heuristic";

function uniq(values) {
  return values.filter((item, index, arr) => item && arr.indexOf(item) === index);
}

function envKey(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

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

const UNKNOWN_DEADLINE = "未註明";

const SKIP_HREF_RE =
  /^(javascript:|mailto:|tel:|sms:|#)/i;
const SKIP_PATH_RE =
  /login|signin|privacy|cookie|terms|career|recruit|accessibility|facebook|instagram|youtube|linkedin|twitter|weibo|whatsapp|wa\.me|\/security\?/i;
const SOCIAL_URL_RE =
  /whatsapp|wa\.me|facebook\.com\/sharer|twitter\.com\/intent|x\.com\/intent|linkedin\.com\/share|t\.me\//i;
const LISTING_URL_RE =
  /\/personal\/offers\/?$|\/credit-card-hot-promotions\.html|\/latest-offers\/?$/i;
const JUNK_TITLE_RE =
  /skip to (content|main)|個人e-?banking|查看全部|了解更多|^home$|^首頁$|^登入$|^搜尋$|^(invest|insure|spend|save)$|cookie settings|privacy policy|whatsapp|在 WhatsApp 上分享|^用戶名稱$|同 H A R O 輕鬆/i;
const FAQ_CONDITION_RE =
  /嗎[？?]|甚麼是|什麼是|你需要注意|以上案例|只供參考|金融糾紛|不保事項|貸款計算機|結果只供參考|分享到|點擊這裡|立即申請|立即登記|查看更多|前往保安|定義見/;
const BEA_HUB_TAGS = /^(餐飲優惠|購物優惠|旅遊優惠|娛樂優惠|奬賞及消費優惠)$/;

let lastAiAt = 0;
let aiCallsThisRun = 0;

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
  if (!deadline || deadline === "額滿即止" || deadline === UNKNOWN_DEADLINE || deadline === "先到先得") return null;
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

function unwrapOfferUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (SOCIAL_URL_RE.test(`${u.hostname}${u.pathname}?${u.search}`)) {
      const blob = `${u.searchParams.get("text") || ""} ${u.searchParams.get("u") || ""} ${u.searchParams.get("url") || ""}`;
      const decoded = decodeURIComponent(blob);
      const found = decoded.match(/https?:\/\/(?:www\.)?(?:hangseng|hkbea|hsbc|bochk|sc|mox|alipayhk)\.[^\s"'<>]+/i)
        || decoded.match(/https?:\/\/[^\s"'<>]+/i);
      if (!found) return "";
      return unwrapOfferUrl(found[0].replace(/[:.,;]+$/, ""));
    }
  } catch {
    /* keep going */
  }
  return raw
    .replace(/:social:.*$/i, "")
    .replace(/\$\{media\}/g, "")
    .replace(/&amp;/g, "&");
}

function isBadOfferUrl(href) {
  const value = String(href || "");
  if (!value || SKIP_HREF_RE.test(value)) return true;
  if (SOCIAL_URL_RE.test(value)) return true;
  if (SKIP_PATH_RE.test(value)) return true;
  if (/\/security\?/i.test(value)) return true;
  return false;
}

function isListingUrl(href) {
  try {
    const u = new URL(href);
    return LISTING_URL_RE.test(`${u.pathname}${u.search}`);
  } catch {
    return LISTING_URL_RE.test(String(href || ""));
  }
}

function canonicalizeUrl(href) {
  try {
    const u = new URL(unwrapOfferUrl(href) || href);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "cid"].forEach(
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
      const href = unwrapOfferUrl(typeof item === "string" ? item : item.href);
      const text = typeof item === "string" ? "" : item.text || "";
      if (!href || SKIP_HREF_RE.test(href) || isBadOfferUrl(href)) return null;
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
  const cleanedCandidate = unwrapOfferUrl(candidate || "");
  const fallback = unwrapOfferUrl(listingUrl || "");
  const allowed = harvested
    .map((l) => unwrapOfferUrl(l.href))
    .filter((href) => href && isHttpUrl(href) && !isBadOfferUrl(href));

  const score = (href) => {
    if (!href || !isHttpUrl(href) || isBadOfferUrl(href)) return -1;
    if (isListingUrl(href)) return 1;
    return 3;
  };

  if (cleanedCandidate && isHttpUrl(cleanedCandidate) && !isBadOfferUrl(cleanedCandidate)) {
    const canonical = canonicalizeUrl(cleanedCandidate);
    if (allowed.some((href) => canonicalizeUrl(href) === canonical)) return canonical;
    const match = allowed.find(
      (href) =>
        canonical.split("?")[0] === canonicalizeUrl(href).split("?")[0],
    );
    if (match) return canonicalizeUrl(match);
    if (score(cleanedCandidate) >= 3) return canonical;
  }

  const bestHarvested = allowed
    .map((href) => ({ href: canonicalizeUrl(href), score: score(href) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (fallback && !isBadOfferUrl(fallback) && !isListingUrl(fallback)) {
    return canonicalizeUrl(fallback);
  }
  if (bestHarvested && bestHarvested.score >= 3) return bestHarvested.href;
  if (fallback && isHttpUrl(fallback) && !isBadOfferUrl(fallback)) return canonicalizeUrl(fallback);
  return canonicalizeUrl(listingUrl);
}

function isJunkTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 4) return true;
  if (JUNK_TITLE_RE.test(t)) return true;
  if (/^https?:/i.test(t)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function aiBudgetLeft() {
  return Math.max(0, Number(process.env.AI_MAX_CALLS || 48) - aiCallsThisRun);
}

async function pacedCall(fn) {
  const gap = Math.max(0, Number(process.env.AI_CALL_GAP_MS || 3500));
  const wait = lastAiAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  aiCallsThisRun += 1;
  lastAiAt = Date.now();
  return fn();
}

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function deadlineFromCountdown(text, today = hongKongDateStr()) {
  const m = String(text || "").match(/(\d+)\s*天/);
  if (!m) return "";
  const days = Number(m[1]);
  if (!Number.isFinite(days) || days < 0 || days > 400) return "";
  const [y, mo, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function normalizeDeadline(raw) {
  if (!raw) return UNKNOWN_DEADLINE;
  const text = String(raw).trim();
  if (/未註明|未注明|見官網|不詳|unknown/i.test(text)) return UNKNOWN_DEADLINE;
  if (/額滿即止/.test(text)) return "額滿即止";
  if (/先到先得/.test(text)) return "先到先得";
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cn) return ymd(cn[1], cn[2], cn[3]);
  const slash = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return ymd(slash[3], slash[2], slash[1]);
  return UNKNOWN_DEADLINE;
}

function extractDeadlineFromText(text) {
  const t = String(text || "");
  if (!t.trim()) return UNKNOWN_DEADLINE;

  const range = [
    ...t.matchAll(
      /由\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日.{0,12}至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
    ),
  ];
  if (range.length) {
    const last = range[range.length - 1];
    return ymd(last[4], last[5], last[6]);
  }

  const before = [
    ...t.matchAll(
      /(?:於|在|直至|截止|有效至|推廣期至|優惠期至|或之前)[^\d]{0,10}(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:或之前)?/g,
    ),
  ];
  if (before.length) {
    const last = before[before.length - 1];
    return ymd(last[1], last[2], last[3]);
  }

  const iso = t.match(/(?:截止|有效至|推廣期至|直至|或之前)[^\d]{0,12}(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  if (/額滿即止/.test(t)) return "額滿即止";
  if (/先到先得/.test(t)) return "先到先得";
  return UNKNOWN_DEADLINE;
}

function extractRewardsFromText(text, title = "") {
  const lines = String(text || "")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const re =
    /回贈|獎賞錢|里數|亞洲萬里通|現金券|現金|折扣|免年費|Cash\s*Back|迎新禮遇|迎新|積分|\d+\s*%|HK\$\s*\d+/i;
  for (const line of lines) {
    if (title && line === title) continue;
    if (line.length >= 6 && line.length <= 180 && re.test(line) && !isJunkTitle(line)) {
      return line;
    }
  }
  return "";
}

function extractConditionsFromText(text, skipLines = []) {
  const chunks = String(text || "")
    .split(/\n+|[。；;]/)
    .map((s) => s.replace(/\s+/g, " ").trim());
  const skipExact = new Set(skipLines.filter(Boolean));
  const hits = [];
  const re =
    /須|需|必須|登記|報名|註冊|申請|投保|簽賬|消費|滿\s*HK|指定|持有.{0,12}卡|合資格|優惠碼|於推廣期|成功登記|完成指定|不包括|經.{0,8}App|不得/;
  const skip = /cookie|javascript|skip to|版權|copyright|關注我們|分享到/i;
  for (const line of chunks) {
    if (line.length < 8 || line.length > 180) continue;
    if (skipExact.has(line) || skip.test(line) || FAQ_CONDITION_RE.test(line) || isJunkTitle(line)) continue;
    if (re.test(line)) hits.push(line.replace(/^[•·\-、\d.\s]+/, "").trim());
    if (hits.length >= 8) break;
  }
  return uniq(hits);
}

function extractMerchantNames(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const names = [];
  for (const line of lines) {
    if (line.length < 2 || line.length > 24) continue;
    if (/優惠|條款|細則|信用卡|東亞|登記|熱線|客戶服務|按此|詳情/.test(line)) continue;
    if (/^[A-Za-z0-9&.' +\-／/()\u4e00-\u9fff]+$/.test(line) && /[A-Za-z\u4e00-\u9fff]/.test(line)) {
      names.push(line);
    }
    if (names.length >= 16) break;
  }
  return uniq(names);
}

function isBeaMerchantHub(section) {
  const tag = String(section && section.category || "");
  const url = String(section && section.url || "");
  if (!BEA_HUB_TAGS.test(tag)) return false;
  if (/welcome-offer|cash-in-hand|cashadvance|entertainment-offer-20|gigi|sammi|concert/i.test(url)) {
    return false;
  }
  return /yro|dining-offer|shopping-offer|travel-offer|rewards-and-spending/i.test(url);
}

function extractBeaHubOffer(bank, section) {
  const title = String(section.category || "").trim() || titleFromSection(section);
  const merchants = extractMerchantNames(section.text);
  const rewards = merchants.length
    ? `指定合作商戶折扣，包括：${merchants.slice(0, 12).join("、")}${merchants.length > 12 ? " 等" : ""}。個別折扣以官網為準。`
    : "指定合作商戶折扣；因商戶眾多、折扣及有效期各有不同，獎賞詳情以官網優惠圖／商戶名單為準。";
  return {
    bank_name: bank.name,
    title,
    rewards,
    conditions: [
      "以指定東亞信用卡於指定合作商戶消費",
      "個別商戶折扣、最低消費及有效期各有不同，以官網及商戶公布為準",
    ],
    requires_registration: detectRegistration(section.text),
    deadline: extractDeadlineFromText(section.text),
    url: section.url || bank.url,
  };
}

function titleFromSection(section) {
  const pageTitle = String(section.title || "")
    .split(/[|｜–—]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (pageTitle && !isJunkTitle(pageTitle) && pageTitle.length <= 90) return pageTitle;
  const firstLine = String(section.text || "")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .find((s) => s.length >= 6 && s.length <= 90 && !isJunkTitle(s));
  return firstLine || pageTitle || "";
}

function detectRegistration(text) {
  return /須登[記記]|必須登[記記]|預先登[記記]|登記參加|網上登記|於\s*App\s*登[記記]|須報名|必須註冊|成功登記/.test(
    String(text || ""),
  )
    ? "Yes"
    : "No";
}

function extractFromSectionText(bank, section) {
  if (isBeaMerchantHub(section)) return extractBeaHubOffer(bank, section);
  const listingTitle = String(section.listingTitle || "").replace(/\s+/g, " ").trim();
  const listingDesc = String(section.listingDescription || "").replace(/\s+/g, " ").trim();
  const title = (!isJunkTitle(listingTitle) && listingTitle) || titleFromSection(section);
  if (!title || isJunkTitle(title)) return null;
  const text = [listingDesc, section.text || ""].filter(Boolean).join("\n");
  const rewards = listingDesc && listingDesc !== title
    ? listingDesc.slice(0, 500)
    : extractRewardsFromText(text, title) || title;
  let conditions = extractConditionsFromText(text, [title, rewards]);
  if (!conditions.length && listingDesc) {
    conditions = extractConditionsFromText(listingDesc, [title]);
  }
  const fromText = extractDeadlineFromText(text);
  const deadline = fromText !== UNKNOWN_DEADLINE
    ? fromText
    : normalizeDeadline(section.listingDeadline || UNKNOWN_DEADLINE);
  return {
    bank_name: bank.name,
    title,
    rewards,
    conditions,
    requires_registration: detectRegistration(text),
    deadline,
    url: section.url || bank.url,
  };
}

function buildPrompt(bank, scrapeResult, harvested, maxChars = 14000, maxLinks = 40) {
  const linkLines = harvested
    .slice(0, maxLinks)
    .map((l, i) => `${i + 1}. ${l.href}${l.text ? `  |  ${l.text}` : ""}`)
    .join("\n");

  return `你是香港銀行／支付平台優惠資訊抽取器。只根據「網頁純文字」與「已抓取超連結」抽取優惠，禁止臆測。

平台名稱：${bank.name}
總覽頁 URL：${scrapeResult.finalUrl || bank.url}

【硬性規則】
1. url 欄位必須是下列「已抓取超連結」清單中的原始 href 之一。若找不到對應連結，使用總覽頁 URL。禁止發明、改寫或拼接未出現的網址。
2. 忽略登入、私隱政策、Cookie、招聘、Skip to content、語言切換、WhatsApp／Facebook 分享連結、純品牌介紹。url 禁止用 api.whatsapp.com 或總覽頁。
3. 最多抽出 10 個最重要、具時效或明確獎賞的優惠。每一則都要獨立分析，不要只抄標題。
4. requires_registration 只能是 "Yes" 或 "No"。若文中提到須登記／報名／註冊，填 Yes。
5. deadline 用 YYYY-MM-DD。只有官網寫「額滿即止」才填 "額滿即止"；寫「先到先得」就填 "先到先得"。找不到明確截止日期就填 "未註明"，禁止把開始日期、倒數「剩餘 N 天」、或估出來的額滿當作截止。
6. conditions 必須從條款抽出持卡人要完成的獨立任務（指定信用卡、最低簽賬、指定商戶、須於 App 登記、推廣期內消費）。有編號或項目符號就逐條放入陣列。禁止 FAQ、案例、免責、分享按鈕。沒有明確任務才給空陣列。
7. rewards 用一句話說明獎賞（現金回贈、里數、折扣、禮品等），不要只重複 title。
8. title 精煉，不要整段條款。
9. bank_name 固定為「${bank.name}」。
10. 每則優惠必須填齊：bank_name, title, rewards, conditions, requires_registration, deadline, url。
11. 回傳 JSON 物件：{"offers":[...]}。

【已抓取超連結】
${linkLines || "(無)"}

【網頁純文字】
${(scrapeResult.text || "").slice(0, maxChars)}
`;
}

function buildSectionPrompt(bank, section, harvested, maxChars = 9000) {
  const linkLines = harvested
    .slice(0, 20)
    .map((l, i) => `${i + 1}. ${l.href}${l.text ? `  |  ${l.text}` : ""}`)
    .join("\n");
  const listingHint = [
    section.category ? `分類／下拉類型：${section.category}` : "",
    section.listingTitle ? `總覽卡標題：${section.listingTitle}` : "",
    section.listingDescription ? `總覽卡簡介：${section.listingDescription}` : "",
  ].filter(Boolean).join("\n");
  const hubHint = isBeaMerchantHub(section)
    ? `此頁是「${section.category}」全年合作商戶折扣總覽。title 必須用分類名「${section.category}」。rewards 用一句概括指定商戶折扣，不要把每個商戶拆成獨立優惠。conditions 只寫共通任務（指定信用卡、指定商戶消費），不要虛構統一截止日期。`
    : bank.id === "hangseng"
      ? "conditions 只抽持卡人要做的獨立任務，忽略 FAQ（嗎？）、案例、免責、計算機說明。url 必須是本頁，禁止 WhatsApp 分享連結。"
      : "";

  return `你是香港銀行／支付平台優惠資訊抽取器。以下是「單一優惠詳情頁」的純文字，請分析這一頁。

平台名稱：${bank.name}
本頁 URL：${section.url}
${listingHint}

【硬性規則】
1. 若本頁只描述一個推廣，offers 只放 1 則。若本頁列出多個獨立推廣，最多 6 則。
2. 每一則必須填齊：bank_name, title, rewards, conditions, requires_registration, deadline, url。
3. bank_name 固定為「${bank.name}」。
4. url 必須是本頁 URL（${section.url}）。禁止 WhatsApp／社交分享連結，禁止改用總覽頁。
5. rewards 說明實際獎賞，不要只抄標題。
6. conditions 必須是獨立任務條件陣列（登記、指定卡、最低簽賬、指定商戶、優惠碼）。禁止 FAQ、案例、免責聲明。
7. requires_registration 只能 Yes 或 No。
8. deadline 用 YYYY-MM-DD；只有官網寫額滿即止才填 "額滿即止"；否則無日期就填 "未註明"。不要把開始日期當成截止。
9. 忽略 Skip to content、導航、語言切換、私隱政策。
10. ${hubHint || "只輸出這一頁的優惠。"}
11. 只輸出 JSON：{"offers":[...]}。

【已抓取超連結】
${linkLines || "(無)"}

【本頁純文字】
${String(section.text || "").slice(0, maxChars)}
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

function extractOpenAiText(json) {
  const msg = json?.choices?.[0]?.message || {};
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((part) => part.text || part.content || "").join("");
  }
  return msg.reasoning || "";
}

async function callOpenAiCompat({
  baseUrl,
  apiKey,
  model,
  prompt,
  userContent,
  headers = {},
  extraBody = {},
  jsonMode = true,
}) {
  const body = {
    model,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: '只輸出合法 JSON 物件，格式必須是 {"offers":[...]}，不要 markdown、不要解說。',
      },
      { role: "user", content: userContent || prompt },
    ],
    ...extraBody,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    const shouldRetryWithoutJson =
      jsonMode && (res.status === 400 || /response_format|json_object|unsupported/i.test(raw));
    if (shouldRetryWithoutJson) {
      return callOpenAiCompat({
        baseUrl,
        apiKey,
        model,
        prompt,
        userContent,
        headers,
        extraBody,
        jsonMode: false,
      });
    }
    const err = new Error(`${model} HTTP ${res.status}: ${raw.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }

  const json = JSON.parse(raw);
  const text = extractOpenAiText(json);
  if (!text) {
    throw new Error(`${model} 回傳空白`);
  }
  return text;
}

function listProviders() {
  const preferred = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const catalog = [];
  const groqKey = envKey("GROQ_API_KEY");
  const openRouterKey = envKey("OPENROUTER_API_KEY", "OPENROUTER_KEY");
  const geminiKey = envKey("GEMINI_API_KEY");

  if (openRouterKey) {
    catalog.push({
      id: "openrouter",
      maxChars: 12000,
      maxLinks: 40,
      // 舊 :free slug（gpt-oss / llama-3.3）喺 2026-11 已 404，改用現時仍然免費嘅模型
      models: uniq([
        process.env.AI_MODEL,
        "openrouter/free",
        "nvidia/nemotron-3.5-lightning:free",
      ]),
      call: (model, prompt) =>
        callOpenAiCompat({
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: openRouterKey,
          model,
          prompt,
          headers: {
            "HTTP-Referer": "https://github.com/readbarapp/credit-card-promotion-bot",
            "X-Title": "HK Bank Promo Dashboard",
          },
          // OpenRouter 規定 extraBody.models 最多 3 項；先前放 4 項會 HTTP 400，
          // 整次爬蟲跌去規則抽取。模型回退改由下方 models 陣列逐個試。
        }),
    });
  }

  if (groqKey) {
    catalog.push({
      id: "groq",
      maxChars: 3500,
      maxLinks: 25,
      models: uniq([
        process.env.AI_MODEL,
        "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
        "qwen/qwen3.6-27b",
      ]),
      call: (model, prompt) =>
        callOpenAiCompat({
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey,
          model,
          prompt,
        }),
    });
  }

  if (geminiKey) {
    catalog.push({
      id: "gemini",
      maxChars: 80000,
      maxLinks: 80,
      models: uniq([
        process.env.AI_MODEL,
        process.env.GEMINI_MODEL,
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.5-flash",
      ]),
      call: (model, prompt) => callGemini(model, prompt, geminiKey),
    });
  }

  if (preferred) {
    const hit = catalog.filter((p) => p.id === preferred);
    if (hit.length) return hit;
    console.warn(`[ai] AI_PROVIDER=${preferred} 但未找到對應金鑰，改用已設定的供應商`);
  }
  return catalog;
}

function listVisionProviders() {
  const openRouterKey = envKey("OPENROUTER_API_KEY", "OPENROUTER_KEY");
  if (!openRouterKey) return [];
  return [
    {
      id: "openrouter-vision",
      models: uniq([
        process.env.AI_VISION_MODEL,
        "nvidia/nemotron-3.5-super-vl:free",
        "google/gemma-4-26b-a4b-it:free",
      ]),
      call: (model, userContent) =>
        callOpenAiCompat({
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: openRouterKey,
          model,
          prompt: "",
          userContent,
          headers: {
            "HTTP-Referer": "https://github.com/readbarapp/credit-card-promotion-bot",
            "X-Title": "HK Bank Promo Dashboard",
          },
        }),
    },
  ];
}

function buildVisionPrompt(bank, section) {
  return `你是香港銀行優惠圖轉文抽取器。以下圖片是官網優惠詳情頁上的官方 <img>（不是瀏覽器截圖）。請讀圖中的繁體中文，抽出優惠。

平台名稱：${bank.name}
本頁 URL：${section.url}
分類：${section.category || "未標示"}
頁面標題：${section.title || ""}

【硬性規則】
1. 若圖中只描述一個推廣，offers 只放 1 則。
2. 每一則必須填齊：bank_name, title, rewards, conditions, requires_registration, deadline, url。
3. bank_name 固定為「${bank.name}」。
4. url 必須是本頁 URL（${section.url}）。禁止發明網址。
5. rewards 說明實際獎賞。
6. conditions 從圖中條款抽出任務條件陣列。
7. requires_registration 只能 Yes 或 No。
8. deadline 用 YYYY-MM-DD；只有圖中寫額滿即止才填 "額滿即止"；無日期填 "未註明"。
9. 若圖中是多個合作商戶折扣總覽，title 用分類名「${section.category || "指定商戶優惠"}」，rewards 概括商戶折扣，不要拆成多則又冇任務條件的優惠。
10. 只輸出 JSON：{"offers":[...]}。`;
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

function toOffers(bank, items, harvested, scrapeResult) {
  return (items || [])
    .filter((item) => item && item.title && !isJunkTitle(item.title))
    .map((item) => {
      const title = String(item.title).replace(/\s+/g, " ").trim().slice(0, 180);
      const deadline = normalizeDeadline(item.deadline);
      const url = pickAllowedUrl(
        item.url,
        harvested,
        scrapeResult.finalUrl || bank.url,
      );
      if (isBadOfferUrl(url) || isJunkTitle(title)) return null;
      const registration = /yes|是|須|需要/i.test(String(item.requires_registration || ""))
        ? "Yes"
        : "No";
      const rewards = String(item.rewards || title).replace(/\s+/g, " ").trim().slice(0, 500);
      const conditions = Array.isArray(item.conditions)
        ? uniq(
            item.conditions
              .map((c) => String(c).trim())
              .filter((c) => c && c.length <= 180 && !FAQ_CONDITION_RE.test(c) && !isJunkTitle(c)),
          ).slice(0, 8)
        : [];
      return {
        id: offerId(bank.name, title),
        bank_id: bank.id,
        bank_name: bank.name,
        title,
        rewards: rewards || title,
        conditions,
        requires_registration: registration,
        deadline,
        url,
      };
    })
    .filter(Boolean);
}

function preferListingMeta(section, offers) {
  if (!section || !Array.isArray(offers)) return offers;
  return offers.map((offer) => {
    const next = { ...offer };
    if (section.listingTitle && !isJunkTitle(section.listingTitle)) {
      next.title = section.listingTitle;
    }
    if (section.listingDescription && (!next.rewards || next.rewards === next.title || next.rewards.length < 10)) {
      next.rewards = String(section.listingDescription).replace(/\s+/g, " ").trim().slice(0, 500);
    }
    if ((!next.conditions || !next.conditions.length) && section.listingDescription) {
      next.conditions = extractConditionsFromText(section.listingDescription, [next.title, next.rewards]);
    }
    if ((!next.deadline || next.deadline === UNKNOWN_DEADLINE) && section.listingDeadline) {
      next.deadline = normalizeDeadline(section.listingDeadline);
    }
    if (isBeaMerchantHub(section)) {
      const hub = extractBeaHubOffer({ name: next.bank_name, url: section.url }, section);
      next.title = hub.title;
      if (!next.rewards || next.rewards === next.title) next.rewards = hub.rewards;
      if (!next.conditions.length) next.conditions = hub.conditions;
    }
    next.id = offerId(next.bank_name, next.title);
    return next;
  });
}

function harvestWindow(sectionText, needle) {
  const text = String(sectionText || "");
  const key = String(needle || "").slice(0, 16);
  if (!key) return text.slice(0, 1600);
  const idx = text.indexOf(key);
  if (idx < 0) return text.slice(0, 1600);
  const start = Math.max(0, idx - 80);
  return text.slice(start, start + 1600);
}

function extractOffersHeuristic(bank, scrapeResult, harvested) {
  const keywords = /優惠|回贈|迎新|獎賞|折扣|現金|里數|免年費|簽賬|miles|cashback|rebate|reward|offer|promo/i;
  const skip = /登入|私隱|cookie|招聘|關於|聯絡|條款及細則|privacy|login|career|about|prime-rates/i;
  const sections = Array.isArray(scrapeResult.sections) && scrapeResult.sections.length
    ? scrapeResult.sections
    : [{
        kind: "listing",
        url: scrapeResult.finalUrl || bank.url,
        title: scrapeResult.title || bank.name,
        text: scrapeResult.text || "",
      }];
  const details = sections.filter(
    (s) => s.kind === "detail" && String(s.text || "").trim().length >= 40,
  );
  const seen = new Set();
  const items = [];

  const source = details.length
    ? details
    : sections.filter((s) => String(s.text || "").trim().length >= 40);

  for (const section of source) {
    if (details.length) {
      const item = extractFromSectionText(bank, section);
      if (!item) continue;
      const key = normalizeKey(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      continue;
    }

    for (const link of harvested) {
      const text = String(link.text || "").replace(/\s+/g, " ").trim();
      if (!text || text === "listing") continue;
      if (text.length < 6 || text.length > 90) continue;
      if (isJunkTitle(text) || skip.test(text) || skip.test(link.href)) continue;
      if (/\.pdf(\?|$)/i.test(link.href)) continue;
      if (!keywords.test(text) && !keywords.test(link.href)) continue;
      const key = normalizeKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      const window = harvestWindow(section.text, text);
      const rewards = extractRewardsFromText(window, text) || text;
      items.push({
        title: text,
        rewards,
        conditions: extractConditionsFromText(window, [text, rewards]),
        requires_registration: detectRegistration(window),
        deadline: extractDeadlineFromText(window),
        url: link.href,
      });
      if (items.length >= 10) break;
    }
  }

  if (!items.length) {
    for (const section of source) {
      const item = extractFromSectionText(bank, section);
      if (!item) continue;
      items.push(item);
      break;
    }
  }

  if (!items.length) {
    for (const link of harvested) {
      const text = String(link.text || "").replace(/\s+/g, " ").trim();
      if (!text || text === "listing" || isJunkTitle(text)) continue;
      if (text.length < 6 || text.length > 90) continue;
      if (skip.test(text) || skip.test(link.href) || /\.pdf(\?|$)/i.test(link.href)) continue;
      if (!keywords.test(text) && !keywords.test(link.href)) continue;
      const key = normalizeKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title: text,
        rewards: text,
        conditions: [],
        requires_registration: detectRegistration(text),
        deadline: UNKNOWN_DEADLINE,
        url: link.href,
      });
      if (items.length >= 10) break;
    }
  }

  return toOffers(bank, items, harvested, scrapeResult);
}

function compactScrapedText(text, maxChars) {
  const parts = String(text || "").split(/\n{2,}(?=【)/);
  if (parts.length <= 1) return String(text || "").slice(0, maxChars);
  const per = Math.max(800, Math.floor(maxChars / parts.length));
  return parts.map((part) => part.slice(0, per)).join("\n\n").slice(0, maxChars);
}

async function callModelOnce(provider, model, prompt, bank, harvested, listingUrl) {
  if (aiBudgetLeft() <= 0) {
    throw Object.assign(new Error("已達本輪 AI 呼叫上限"), { status: 429 });
  }
  const text = await pacedCall(() => provider.call(model, prompt));
  const offers = toOffers(bank, parseJsonPayload(text), harvested, {
    finalUrl: listingUrl,
  });
  if (!offers.length) {
    throw new Error("模型沒有抽出任何優惠");
  }
  return offers;
}

async function tryProviders(providers, bank, prompt, harvested, listingUrl) {
  let lastError;
  for (const provider of providers) {
    for (const model of provider.models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[ai] ${bank.name} → ${provider.id}/${model} (attempt ${attempt})`);
          const offers = await callModelOnce(
            provider,
            model,
            prompt,
            bank,
            harvested,
            listingUrl,
          );
          lastAiBackend = provider.id;
          return offers;
        } catch (err) {
          lastError = err;
          const retryable = err.status === 429 || err.status === 503 || err.status === 404;
          if (err.status === 404) break;
          if (retryable && attempt < 2) {
            const wait = 2000 * attempt;
            console.warn(`[ai] ${bank.name} 重試 ${provider.id}/${model}，等待 ${wait}ms：${err.message}`);
            await sleep(wait);
            continue;
          }
          if (!retryable) break;
        }
      }
    }
  }
  if (lastError) throw lastError;
  return [];
}

function pushUniqueOffers(bucket, seen, offers) {
  for (const offer of offers || []) {
    if (!offer || isJunkTitle(offer.title)) continue;
    const key = normalizeKey(offer.title);
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.push(offer);
  }
}

async function extractFromOfferImages(bank, section, harvested) {
  const visionProviders = listVisionProviders();
  const images = pickOfferImages(section.images || [], Number(process.env.AI_MAX_IMAGES_PER_OFFER || 4));
  if (!visionProviders.length || !images.length) return [];

  const dataUrls = [];
  for (const img of images) {
    try {
      const dataUrl = await fetchImageDataUrl(img.src, section.url || bank.url);
      dataUrls.push(dataUrl);
    } catch (err) {
      console.warn(`[ai] ${bank.name} 讀取官網優惠圖失敗：${img.src} → ${err.message}`);
    }
  }
  if (!dataUrls.length) return [];

  const userContent = [
    { type: "text", text: buildVisionPrompt(bank, section) },
    ...dataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  let lastError;
  for (const provider of visionProviders) {
    for (const model of provider.models) {
      try {
        if (aiBudgetLeft() <= 0) break;
        console.log(`[ai] ${bank.name} 圖轉文 → ${provider.id}/${model}（${dataUrls.length} 張官網圖）`);
        const text = await pacedCall(() => provider.call(model, userContent));
        const offers = toOffers(bank, parseJsonPayload(text), harvested, {
          finalUrl: section.url || bank.url,
        });
        if (offers.length) {
          lastAiBackend = provider.id;
          return offers;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[ai] ${bank.name} 圖轉文失敗 ${provider.id}/${model}：${err.message}`);
        if (err.status === 404) continue;
      }
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function extractOffersWithAi(bank, scrapeResult) {
  const harvestedAll = filterHarvestedLinks(
    scrapeResult.links,
    scrapeResult.finalUrl || bank.url,
  );
  const providers = listProviders();
  const sections = Array.isArray(scrapeResult.sections) ? scrapeResult.sections : [];
  const details = sections.filter(
    (s) =>
      s.kind === "detail" &&
      (String(s.text || "").trim().length >= 40 || (s.images || []).length > 0),
  );
  const collected = [];
  const seen = new Set();
  let usedAi = false;
  let lastError;

  const maxSections = Math.max(
    1,
    Number(bank.maxAiSections || process.env.AI_MAX_SECTIONS_PER_BANK || 40),
  );

  if (providers.length && details.length) {
    for (const section of details.slice(0, maxSections)) {
      const harvested = filterHarvestedLinks(
        scrapeResult.links,
        section.url || scrapeResult.finalUrl || bank.url,
      );
      if ((section.images || []).length) {
        try {
          const visionOffers = await extractFromOfferImages(bank, section, harvested);
          if (visionOffers.length) {
            usedAi = true;
            pushUniqueOffers(collected, seen, preferListingMeta(section, visionOffers));
            continue;
          }
        } catch (err) {
          lastError = err;
          console.warn(`[ai] ${bank.name} 官網圖轉文失敗，改試頁面文字：${section.url} → ${err.message}`);
        }
      }

      const prompt = buildSectionPrompt(
        bank,
        {
          ...section,
          text: String(section.text || "").slice(0, providers[0].maxChars || 9000),
        },
        harvested,
        providers[0].maxChars || 9000,
      );
      try {
        const offers = await tryProviders(
          providers,
          bank,
          prompt,
          harvested,
          section.url || scrapeResult.finalUrl || bank.url,
        );
        if (offers.length) {
          usedAi = true;
          pushUniqueOffers(collected, seen, preferListingMeta(section, offers));
          continue;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[ai] ${bank.name} 詳情頁失敗，改用該頁規則抽取：${section.url} → ${err.message}`);
      }
      pushUniqueOffers(
        collected,
        seen,
        preferListingMeta(
          section,
          toOffers(
            bank,
            [extractFromSectionText(bank, section)].filter(Boolean),
            harvested,
            { finalUrl: section.url || bank.url },
          ),
        ),
      );
    }
  } else if (providers.length) {
    const prompt = buildPrompt(
      bank,
      {
        ...scrapeResult,
        text: compactScrapedText(scrapeResult.text, providers[0].maxChars),
      },
      harvestedAll,
      providers[0].maxChars,
      providers[0].maxLinks,
    );
    try {
      const offers = await tryProviders(
        providers,
        bank,
        prompt,
        harvestedAll,
        scrapeResult.finalUrl || bank.url,
      );
      if (offers.length) {
        usedAi = true;
        pushUniqueOffers(collected, seen, offers);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[ai] ${bank.name} 總覽分析失敗：${err.message}`);
    }
  }

  if (!collected.length) {
    console.warn(
      `[ai] ${bank.name} ${providers.length ? "模型未能逐頁抽出優惠" : "未設定 AI 金鑰"}，改用規則抽取`,
      lastError ? lastError.message : "",
    );
    pushUniqueOffers(
      collected,
      seen,
      extractOffersHeuristic(bank, scrapeResult, harvestedAll),
    );
  }

  lastAiBackend = usedAi ? lastAiBackend || (providers[0] && providers[0].id) : "heuristic";

  if (!collected.length) {
    throw lastError || new Error("沒有可用的 AI 金鑰，且規則抽取為空");
  }
  return collected;
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
      if (String(old.id).startsWith("demo-") && incoming.length) continue;
      if (isJunkTitle(old.title) || isBadOfferUrl(old.url || "") || isListingUrl(old.url || "")) continue;
      next.push({
        ...old,
        isNew: false,
        status: "expired",
        expiredDate: old.expiredDate || today,
      });
      seenIds.add(old.id);
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
    generatedBy: `scripts/scraper.js + ${lastAiBackend}`,
    banks: banks.map((b) => ({
      id: b.id,
      name: b.name,
      nameEn: b.nameEn,
      url: b.url,
      extraUrls: b.extraUrls || [],
      follow: b.follow || null,
      sourceHint: b.sourceHint || "web",
      sourceNote: b.sourceNote || "",
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
  extractOffersHeuristic,
  mergeOffers,
  loadPreviousData,
  sendNotifications,
  buildDashboardPayload,
  writeOutputs,
  daysUntil,
  hongKongDateStr,
  isJunkTitle,
  unwrapOfferUrl,
  isBadOfferUrl,
  isListingUrl,
  pickAllowedUrl,
  normalizeDeadline,
  deadlineFromCountdown,
  extractConditionsFromText,
  extractDeadlineFromText,
  extractRewardsFromText,
  extractFromSectionText,
  UNKNOWN_DEADLINE,
};
