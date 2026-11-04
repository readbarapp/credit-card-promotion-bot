/**
 * 官網優惠圖處理：只用頁面上真實 <img src>，禁止 Playwright screenshot。
 */

const SKIP_IMAGE_RE =
  /logo|favicon|icon|solar|facebook|instagram|youtube|wechat|dars-|hotline|apple-touch|search-icon|lock-icon|dps-member|black-cross|menu-tax|menu-wealth|menu-wholesale|menu-travel|menu-investment/i;

function isOfferImageSrc(src) {
  const value = String(src || "");
  if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(value)) return false;
  if (SKIP_IMAGE_RE.test(value)) return false;
  return /\/images\//i.test(value);
}

function rankOfferImage(src) {
  const s = String(src || "").toLowerCase();
  if (/landing|edm|1240|detail|tnc/.test(s)) return 6;
  if (/banner/.test(s) && !/350x234|307x260/.test(s)) return 5;
  if (/350x234|307x260/.test(s)) return 1;
  return 3;
}

function pickOfferImages(images, max = 4) {
  const seen = new Set();
  return (images || [])
    .map((item) => {
      if (!item) return null;
      const src = typeof item === "string" ? item : item.src || item.url || "";
      return {
        src,
        alt: typeof item === "string" ? "" : item.alt || "",
      };
    })
    .filter((item) => item && isOfferImageSrc(item.src))
    .sort((a, b) => rankOfferImage(b.src) - rankOfferImage(a.src))
    .filter((item) => {
      if (seen.has(item.src)) return false;
      seen.add(item.src);
      return true;
    })
    .slice(0, max);
}

function extractListingOfferCards(html, baseUrl) {
  const cards = [];
  const seen = new Set();
  const sources = String(html || "").split(/update-discover-offer-list-source/);
  for (const chunk of sources.slice(1)) {
    const tagMatch = chunk.match(/^[^>]*(?:data-tag|class)[^>]*data-tag="([^"]+)"/) ||
      chunk.match(/data-tag="([^"]+)"/);
    const tag = tagMatch ? tagMatch[1] : "";
    const re = /<a href="([^"]+)"[\s\S]{0,400}?<img src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(chunk))) {
      let href;
      try {
        href = new URL(m[1], baseUrl).href;
      } catch {
        continue;
      }
      if (seen.has(href) || /javascript:/i.test(href)) continue;
      seen.add(href);
      let src = m[2];
      try {
        src = new URL(src, baseUrl).href;
      } catch {
        /* keep relative */
      }
      cards.push({ href, tag, thumb: src });
    }
  }
  return cards;
}

async function fetchImageDataUrl(src, referer) {
  const res = await fetch(src, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: referer || src,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 4_500_000) {
    throw new Error(`圖片大小不適合（${buf.length} bytes）`);
  }
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!/^image\//i.test(mime)) {
    throw new Error(`不是圖片：${mime}`);
  }
  return `data:${mime};base64,${buf.toString("base64")}`;
}

module.exports = {
  isOfferImageSrc,
  rankOfferImage,
  pickOfferImages,
  extractListingOfferCards,
  fetchImageDataUrl,
};
