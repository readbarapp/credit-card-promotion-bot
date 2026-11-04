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

免費層約 20 次／分鐘、50 次／日，每日爬 7 間銀行夠用。腳本會用 `openrouter/free`，失敗則自動改打仍然免費的 Nemotron / Gemma 模型（舊的 `gpt-oss-20b:free` 已 404，不要再用）。

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
| `scripts/scraper.js` | 通用爬蟲：UA、Cookie 彈窗、Auto-scroll、單平台容錯 |
| `scripts/ai-parser.js` | Groq／OpenRouter／Gemini 抽取、真實 href 綁定、去重、Webhook |
| `index.html` | 響應式 Dashboard + 管理面板 + Worker 控制台 |
| `data.json` | 最新優惠資料（Pages 與前端皆讀此檔） |

優惠卡片上的 `url` **只會是爬蟲在頁面上抓到的 `<a href>`**（相對路徑已拼成絕對 URL）。AI 若回傳清單以外的網址，會被強制改回總覽頁，禁止臆造連結。

## 初始 7 大平台（官方總覽頁）

1. 滙豐銀行 — https://www.hsbc.com.hk/zh-hk/credit-cards/
2. 恒生銀行 — https://www.hangseng.com/zh-hk/personal/cards/spending-privileges/offers-of-the-month-all/month-creditcard/
3. 中銀香港 — https://www.bochk.com/tc/creditcard/promotions/offers.html
4. 渣打銀行 — https://www.sc.com/hk/zh/credit-cards/offers/
5. Mox Bank — https://mox.com/zh/promotions/
6. 東亞銀行 — https://www.hkbea.com/html/tc/bea-credit-card-hot-promotions.html
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

### 4. 前端控制台（PAT）

Dashboard 要替你 commit 清單並觸發／取消 Actions，需要 **Personal Access Token**：

建議使用 Fine-grained token：

- Repository access：只選這個倉庫
- Permissions：
  - **Contents**: Read and write（改 `config/banks.js`）
  - **Actions**: Read and write（觸發與取消 workflow）

Classic token 則需要 `repo` 權限。

在 Dashboard 按「⚙️ 管理監控平台」貼上 token。Token **只存在你的瀏覽器 LocalStorage**，不會寫進倉庫。

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

## 注意事項

- 銀行網站可能有反爬、地區限制或登入牆。失敗不中斷整體流程，錯誤顯示在側欄。
- OpenRouter 免費層約 50 次／日；腳本遇 429 會重試並換仍然免費的模型。
- 優惠內容由模型抽取，**請以官網條款為準**。
- GitHub 免費 Actions 分鐘數對 Public 倉庫通常足夠；請勿打開 headed 瀏覽器或截圖，以免浪費時間與儲存空間。
