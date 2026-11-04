# 香港銀行與支付優惠自動搜集 Dashboard

完全運行於 **GitHub 免費生態** 的靜態情報系統：GitHub Actions 定時／按需爬蟲、OpenRouter（香港可用）語意抽取、GitHub Pages 發布。不使用外部資料庫、不使用 Vercel／Supabase，**0 成本**。

整個生命週期由前端 Dashboard 主導：在網頁輸入 PAT、增刪監測平台、啟動／監控／終止 GitHub Actions Worker。

## 系統架構

```text
使用者瀏覽器 (index.html)
        │  GitHub REST API（PAT 只存 LocalStorage）
        ├─ PUT config/banks.js          更新監測清單
        ├─ POST /dispatches             啟動爬蟲
        ├─ GET  /actions/.../runs       即時監控
        └─ POST /actions/runs/{id}/cancel  終止 Worker
                    │
                    ▼
GitHub Actions (.github/workflows/scrape.yml)
        │  每日 08:00 HKT 或手動／Dispatch
        ├─ Playwright Chromium（headless，零截圖／零錄影）
        ├─ 各銀行獨立 try/catch，失敗只記 log 並繼續
        ├─ OpenRouter / Groq / Gemini 抽取 JSON（香港預設 OpenRouter）
        ├─ 與舊 data.json 去重（isNew / Expired）
        ├─ Telegram / Discord Webhook 推播新優惠與 7 天內到期
        └─ commit data.json + 回寫 index.html 內嵌資料
                    │
                    ▼
GitHub Pages  →  任何人打開網址即可閱讀
```

## 香港申請唔到 Gemini／Groq 怎麼辦

香港常見兩件事：Google AI Studio 開唔到 key，Groq 連 IP 都 block。**請用 OpenRouter**（本專案而家預設）。

1. 打開 [https://openrouter.ai/keys](https://openrouter.ai/keys) 用 email 註冊
2. Create API Key，複製金鑰（通常以 `sk-or-` 開頭）
3. GitHub 倉庫 **Settings → Secrets and variables → Actions** 新增 **`OPENROUTER_API_KEY`**（名稱必須一模一樣）
4. 在 Dashboard 再跑一次爬蟲

免費層約 20 次／分鐘、50 次／日。腳本會用 `openrouter/free`，失敗則改打 `nvidia/nemotron-3.5-lightning:free`（舊的 `gpt-oss-20b:free` 已 404，不要再用）。

**不要**在 OpenRouter 請求裡一次塞超過 3 個 `models` 後備；超過會 HTTP 400，整次爬蟲會跌去規則抽取，結果只剩優惠名稱、任務條件全空。本專案已改為逐個優惠詳情頁分析，並限制每輪 AI 呼叫次數以遷就免費額度。

| 選項 | 香港 | 免費 | Secret 名稱 |
|---|---|---|---|
| **OpenRouter（建議）** | ✅ | ✅ `:free` 模型 | `OPENROUTER_API_KEY` |
| Groq | 部分網絡 block IP | ✅ | `GROQ_API_KEY` |
| Gemini | ❌ 帳戶通常開唔到 | ✅ | `GEMINI_API_KEY` |
| 規則抽取 | 不需金鑰 | ✅ | （沒有任何 Key 時自動用） |

可選 `AI_PROVIDER=openrouter|groq|gemini`、`AI_MODEL` 覆寫模型。有多把金鑰時優先順序為 OpenRouter → Groq → Gemini。

## 專案檔案

| 檔案 | 職責 |
|---|---|
| `config/banks.js` | 7 大初始平台與官方總覽 URL（組態驅動） |
| `.github/workflows/scrape.yml` | Cron 08:00 HKT、Playwright、Secrets、自動 commit |
| `scripts/scraper.js` | 通用爬蟲：UA、Cookie 彈窗、Auto-scroll、跟進子頁、單平台容錯 |
| `scripts/ai-parser.js` | Groq／OpenRouter／Gemini 抽取、真實 href 綁定、去重、Webhook |
| `index.html` | 響應式 Dashboard + 管理面板 + Worker 控制台 |
| `data.json` | 最新優惠資料（Pages 與前端皆讀此檔） |

Dashboard 以**列表**顯示每一則優惠，欄位為：`bank_name`（平台名稱）、`title`（優惠主題）、`rewards`（獎賞詳情）、`conditions`（任務條件）、`requires_registration`（需否登記 Yes/No）、`deadline`（YYYY-MM-DD 或「額滿即止」）、`url`（官網原始連結）。

`url` **只會是爬蟲在頁面上抓到的 `<a href>`**（相對路徑已拼成絕對 URL）。AI 若回傳清單以外的網址，會被強制改回該優惠詳情頁或總覽頁，禁止臆造連結。爬蟲會跟進各平台子頁，AI 會逐頁抽出任務條件；若當日額度用盡，會改讀詳情頁正文做規則抽取，而不是只抄連結標題。

東亞「火熱優惠」詳情多數係官網 `<img>`。爬蟲會展開類型下拉、跟進優惠卡連結，然後把頁上的宣傳圖（不是 Playwright 截圖／錄影）交 OpenRouter 視覺模型做圖轉文，再用同一套欄位抽出 `rewards` / `conditions` / `deadline`。可選 Secret：`AI_VISION_MODEL`。

## 初始 7 大平台（官方總覽頁）

1. 滙豐銀行 — https://www.redhotoffers.hsbc.com.hk/tc/home/（會跟進最新優惠等子頁）
2. 恒生銀行 — https://www.hangseng.com/zh-hk/personal/cards/spending-privileges/offers-of-the-month-all/month-creditcard/
3. 中銀香港 — https://www.bochk.com/tc/creditcard/promotions/offers.html
4. 渣打銀行 — https://www.sc.com/hk/zh/credit-cards/offers/
5. Mox Bank — https://mox.com/zh/promotions/
6. 東亞銀行 — https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html（類型下拉選單 + 官網優惠圖轉文；**不是**強積金新聞頁）
7. AlipayHK — https://www.alipayhk.com/zh/promotion/

## Step-by-step 設定

### 1. 推上 GitHub 並開 GitHub Pages

1. 將本倉庫設為 **Public**（免費 Pages 需要公開庫；Private Pages 要付費方案）。
2. 進入 **Settings → Pages**。
3. Source 選 **Deploy from a branch**。
4. Branch 選 `main`，資料夾選 `/ (root)`，Save。
5. 數分鐘後網址為：
   `https://<你的帳號>.github.io/credit-card-promotion-bot/`

### 2. 設定 Actions Secrets

進入 **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 必填 | 說明 |
|---|---|---|
| `OPENROUTER_API_KEY` | 香港用戶建議必填 | [OpenRouter Keys](https://openrouter.ai/keys)，名稱必須是這個 |
| `GROQ_API_KEY` | 否 | Groq；若你屋企 IP 被封可唔使填 |
| `GEMINI_API_KEY` | 否 | 僅在你已有海外 Gemini 帳戶時使用 |
| `AI_PROVIDER` | 否 | `groq` / `openrouter` / `gemini` |
| `AI_MODEL` | 否 | 覆寫模型名稱 |
| `GEMINI_MODEL` | 否 | 只影響 Gemini 回退清單 |
| `TELEGRAM_BOT_TOKEN` | 否 | Telegram BotFather 的 token |
| `TELEGRAM_CHAT_ID` | 否 | 你的 chat id |
| `DISCORD_WEBHOOK_URL` | 否 | Discord 頻道 Webhook |

Telegram：跟 [@BotFather](https://t.me/BotFather) 建立 bot，再跟 [@userinfobot](https://t.me/userinfobot) 查 chat id。Discord：頻道設定 → 整合 → Webhook。

### 3. 允許 Actions 寫回倉庫

**Settings → Actions → General**：

- Workflow permissions 選 **Read and write permissions**
- 勾選 **Allow GitHub Actions to create and approve pull requests**（可選）
- 存檔

沒有寫入權限時，爬蟲會跑完但無法 commit `data.json`。

### 4. 前端控制台要用的 GitHub PAT（點樣搵、要開咩權限）

Dashboard 要替你改 `config/banks.js`、啟動／終止 Actions，需要 **Personal Access Token**。Token **只存在你瀏覽器 LocalStorage**，只會打去 `api.github.com`，唔會寫進倉庫。

介面「⚙️ 管理監控平台」入面都有同一份教學。

**建議：Fine-grained token（權限最細）**

1. 登入 GitHub，撳右上角頭像 → **Settings**
2. 左欄滾落最底 → **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**  
   直接開：[建立 Fine-grained token](https://github.com/settings/personal-access-tokens/new)
4. Token name：例如 `hk-promo-dashboard`；Expiration：建議 90 日
5. Resource owner：選你自己（或 repo 所屬 org）
6. Repository access：選 **Only select repositories**，只勾 `credit-card-promotion-bot`
7. Repository permissions 只開呢兩項，其他保持 **No access**：

   | Permission | Access | 用途 |
   |---|---|---|
   | **Contents** | **Read and write** | 讀／寫 `config/banks.js` |
   | **Actions** | **Read and write** | 睇 run、啟動、終止爬蟲 |

   **Metadata** 會自動變 Read-only，唔使改。唔好開 Administration。

8. Generate token，複製 `github_pat_…`（只顯示一次）
9. 打開 Dashboard → ⚙️ 管理監控平台 → 貼上 PAT → 「只儲存連線設定」

**備選：Classic token（權限較闊）**

1. 開 [Classic token 頁](https://github.com/settings/tokens/new)
2. Note 填名稱，Expiration 自訂
3. 只勾 **`repo`**（包含 private；若倉庫是 public，理論上 `public_repo` 都得，但 `repo` 最穩）
4. Generate token，複製 `ghp_…`

唔使勾 `workflow`（嗰個係改 workflow 檔案，唔係觸發爬蟲）。

### 5. 第一次跑爬蟲

合併本 PR 到 `main` 之後：

1. 打開 GitHub Pages 網址
2. 填 PAT、Owner、Repo 並儲存
3. 按 **🚀 立即執行一次爬蟲**
4. 控制台會輪詢 Actions 狀態；成功後重新整理頁面即可看到優惠
5. 之後每天 **香港時間 08:00** 自動跑一次

也可在 GitHub：**Actions → Scrape HK Bank Promos → Run workflow**。

### 6. 本機試跑（可選）

```bash
npm ci
npx playwright install chromium
export OPENROUTER_API_KEY=你的金鑰
node scripts/scraper.js
```

腳本**不會**截圖或錄影。單一銀行失敗只會寫入 `data.json.errors` 並繼續其餘平台。

## 前端功能對照

- 🆕 New 專區：`firstSeenDate` 起 7 天內的新優惠
- 搜尋 + 平台 + 到期日篩選；7 天內到期紅字 🔴
- 任務條件 Checklist，狀態寫入 LocalStorage
- 管理面板：增刪改監測清單，`PUT /repos/{owner}/{repo}/contents/config/banks.js`
- 控制台：`POST /dispatches` 啟動、`POST /actions/runs/{id}/cancel` 終止

## 子頁同 App 限定優惠

- **滙豐**：總覽改為 [Red Hot Offers](https://www.redhotoffers.hsbc.com.hk/tc/home/)。爬蟲會再開「最新優惠」「全年優惠」等子頁（`extraUrls` + 頁面上真實連結，每間銀行有 `follow.maxPages` 上限），唔會估網址。
- **Mox / AlipayHK**：商戶即減、券、Earn 專區多數只在 App。爬蟲可以跟進官網已公開的 `/promotions/` 子頁，但**入唔到 App**。Dashboard 會標「詳情主要在 App」。
- 若要加其他子頁：編輯 `config/banks.js` 的 `extraUrls`，或用管理面板更新後再跑一次爬蟲。

## 注意事項

- 銀行網站可能有反爬、地區限制或登入牆。失敗不中斷整體流程，錯誤顯示在側欄。
- OpenRouter 免費層約 50 次／日；腳本遇 429 會重試並換仍然免費的模型。
- 優惠內容由模型抽取，**請以官網／App 條款為準**。
- GitHub 免費 Actions 分鐘數對 Public 倉庫通常足夠；請勿打開 headed 瀏覽器或截圖，以免浪費時間與儲存空間。
