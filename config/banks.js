/**
 * 香港銀行與支付平台監測清單（組態驅動）
 * 由 Dashboard「管理監控平台」透過 GitHub Contents API 寫入。
 */
module.exports = [
  {
    "id": "hsbc",
    "name": "滙豐銀行",
    "nameEn": "HSBC",
    "url": "https://www.redhotoffers.hsbc.com.hk/tc/home/",
    "extraUrls": [
      "https://www.redhotoffers.hsbc.com.hk/tc/latest-offers/"
    ],
    "allowedHosts": [
      "redhotoffers.hsbc.com.hk",
      "www.hsbc.com.hk"
    ],
    "follow": {
      "enabled": true,
      "maxPages": 6,
      "include": ["latest-offers", "offer", "promo", "優惠", "獎賞"],
      "skip": ["login", "privacy", "cookie", "/en/", "personal-information"]
    },
    "sourceHint": "web",
    "enabled": true
  },
  {
    "id": "hangseng",
    "name": "恒生銀行",
    "nameEn": "Hang Seng",
    "url": "https://www.hangseng.com/zh-hk/personal/cards/spending-privileges/offers-of-the-month-all/month-creditcard/",
    "allowedHosts": [
      "www.hangseng.com",
      "hangseng.com"
    ],
    "follow": {
      "enabled": true,
      "maxPages": 5,
      "include": ["offers", "privileges", "promotion", "優惠", "獎賞"],
      "skip": ["prime-rates", "/en-hk/", "/zh-cn/", "login", "privacy"]
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
      "include": ["promotion", "offer", "優惠", "獎賞", "creditcard"],
      "skip": ["login", "privacy", "/en/", "corporate"]
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
      "include": ["credit-cards", "promotion", "offer", "優惠", "獎賞"],
      "skip": ["login", "privacy", "/en/", "mortgages", "deposits"]
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
      "maxPages": 5,
      "include": ["promotions", "promotion", "優惠"],
      "skip": ["category=", "login", "privacy", ".pdf"]
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
      "maxPages": 6,
      "include": ["credit-card", "welcome-offer", "promotion", "優惠"],
      "skip": ["login", "privacy", "mpf", "/en/", "bea-mpf-"]
    },
    "imageOffers": {
      "enabled": true,
      "maxOffers": 6,
      "maxImagesPerOffer": 4
    },
    "sourceHint": "web",
    "sourceNote": "信用卡「火熱優惠」要用類型下拉選單，詳情多為官網宣傳圖。爬蟲會讀取頁上的 <img src> 交 OpenRouter 做圖轉文，唔會用 Playwright 截圖。",
    "enabled": true
  },
  {
    "id": "alipayhk",
    "name": "AlipayHK",
    "nameEn": "AlipayHK",
    "url": "https://www.alipayhk.com/zh/promotion/",
    "waitMs": 5000,
    "follow": {
      "enabled": true,
      "maxPages": 4,
      "include": ["promotion", "promo", "優惠"],
      "skip": ["login", "privacy"]
    },
    "sourceHint": "app",
    "sourceNote": "AlipayHK 即減券、快閃優惠多數只在 App 領取；官網優惠專區資訊有限，無法代替打開 App。",
    "enabled": true
  }
];
