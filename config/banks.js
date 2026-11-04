/**
 * 香港銀行與支付平台監測清單（組態驅動）
 *
 * - 由 Dashboard「⚙️ 管理監控平台」透過 GitHub Contents API 寫入，或直接在 GitHub 編輯本檔。
 * - url：官方優惠總覽頁。爬蟲會再跟進 extraUrls，以及頁面上符合 follow.include 的真實 <a href>。
 * - extraUrls：已知的子頁（例如滙豐「最新優惠」）。
 * - follow.maxPages：每個平台最多再打開幾張子頁（避免 Actions 超時）。
 * - sourceHint=app：網站資訊有限，完整優惠多數只在 App 內。
 */
module.exports = [
  {
    "id": "hsbc",
    "name": "滙豐銀行",
    "nameEn": "HSBC",
    "url": "https://www.redhotoffers.hsbc.com.hk/tc/home/",
    "extraUrls": [
      "https://www.redhotoffers.hsbc.com.hk/tc/latest-offers/",
      "https://www.redhotoffers.hsbc.com.hk/tc/yro/"
    ],
    "allowedHosts": ["redhotoffers.hsbc.com.hk", "hsbc.com.hk"],
    "follow": {
      "enabled": true,
      "maxPages": 8,
      "include": ["latest-offers", "yro", "offer", "promo", "優惠"],
      "clickNames": ["最新優惠", "全年優惠", "Red Hot Offers"]
    },
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "hangseng",
    "name": "恒生銀行",
    "nameEn": "Hang Seng",
    "url": "https://www.hangseng.com/zh-hk/personal/cards/spending-privileges/offers-of-the-month-all/month-creditcard/",
    "follow": {
      "enabled": true,
      "maxPages": 5,
      "include": ["offer", "promo", "優惠", "spending-privileges"]
    },
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "boc",
    "name": "中銀香港",
    "nameEn": "BOCHK",
    "url": "https://www.bochk.com/tc/creditcard/promotions/offers.html",
    "follow": {
      "enabled": true,
      "maxPages": 5,
      "include": ["promotion", "offer", "優惠"]
    },
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "sc",
    "name": "渣打銀行",
    "nameEn": "Standard Chartered",
    "url": "https://www.sc.com/hk/zh/credit-cards/offers/",
    "follow": {
      "enabled": true,
      "maxPages": 5,
      "include": ["offer", "promo", "優惠"]
    },
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "mox",
    "name": "Mox Bank",
    "nameEn": "Mox",
    "url": "https://mox.com/zh/promotions/",
    "follow": {
      "enabled": true,
      "maxPages": 8,
      "include": ["/promotions/", "promo"]
    },
    "sourceHint": "app",
    "sourceNote": "Mox Earn 商戶優惠主要在 App 內；網站只公開部分推廣頁，爬蟲會跟進網站上的子頁，但無法進入 App。",
    "enabled": true
  },
  {
    "id": "bea",
    "name": "東亞銀行",
    "nameEn": "BEA",
    "url": "https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html",
    "follow": {
      "enabled": true,
      "maxPages": 5,
      "include": ["credit-card", "promo", "優惠", "offer"]
    },
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "alipayhk",
    "name": "AlipayHK",
    "nameEn": "AlipayHK",
    "url": "https://www.alipayhk.com/zh/promotion/",
    "extraUrls": [
      "https://www.alipayhk.com/zh/chilllife/"
    ],
    "follow": {
      "enabled": true,
      "maxPages": 5,
      "include": ["/promotion/", "chilllife", "優惠"]
    },
    "sourceHint": "app",
    "sourceNote": "AlipayHK 即減券、快閃優惠多數只在 App 領取；官網優惠專區資訊有限，無法代替打開 App。",
    "enabled": true
  }
];
