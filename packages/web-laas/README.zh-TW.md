# web-laas — 瀏覽器擴充功能

在網頁上使用 Emacs [laas](https://github.com/tecosaur/LaTeX-auto-activating-snippets) 風格的 LaTeX auto-activating snippets。這是 Chrome 擴充功能（MV3），引擎使用 [`web-laas-engine`](../web-laas-engine)。

支援的編輯器：

| 編輯器 | 網站 |
|---|---|
| CodeMirror 6 | Overleaf、JupyterLab 4 / Notebook 7 |
| CodeMirror 5 | HackMD、classic Jupyter Notebook |
| ProseMirror / contenteditable | ChatGPT、Claude、Notion |
| `<textarea>` / `<input>` | GitHub、StackExchange 等一般輸入框 |

## 安裝

```sh
# 在 repo 根目錄
npm install
npm run build
```

在 Chrome 開啟 `chrome://extensions`，打開「開發人員模式」，按「載入未封裝項目」並選擇 `packages/web-laas/dist/`。

- 快捷鍵 **Alt+Shift+L** 可以切換全域開關，也可以到 `chrome://extensions/shortcuts` 修改。
- 工具列 popup 可以單獨停用目前網站。
- 「擴充功能選項」頁可以編輯自己的 snippet，右側的試玩區可以立刻測試。

## 快捷鍵

| 按鍵 | 作用 |
|---|---|
| `Alt+Shift+K` | 在目前頁面開／關 **cheat sheet**（可搜尋，公式以 MathML 預覽；只列這個網站可用的 snippet） |
| `Alt+Shift+L` | 全域開關自動展開 |
| `Tab` | 展開非自動 snippet，否則跳到下一個 tabstop，否則在數學模式中跳出括號／`$` |
| `Shift+Tab` | 回到上一個 tabstop |
| `Backspace` | 展開後立刻按，還原成原本打的字 |

全域快捷鍵可以在 `chrome://extensions/shortcuts` 修改。

- 按下快捷鍵時，頁面上方會顯示通知，例如「LaTeX 自動展開已暫停」。`chrome://` 這類無法注入的頁面改用系統通知。工具列圖示停用時會變灰，並顯示 `OFF`。
- 除了瀏覽器的快捷鍵，content script 也會在頁面內監聽預設的 `Alt+Shift+K`／`Alt+Shift+L`，以及瀏覽器實際指派的組合（例如改成 `⌘K`）。這樣即使在 **Arc** 這類不會轉交擴充功能快捷鍵的瀏覽器，或 Chrome 沒有指派新快捷鍵時，一般網頁上仍然可以使用。瀏覽器自己處理的按鍵不會傳到頁面；background 也會忽略 400ms 內重複送來的同一個指令，所以不會觸發兩次。
- 擴充功能安裝或更新後，已經開著的分頁會自動注入 content script，不必手動重新整理。每次 build 都有版本 ID；新版注入時會卸下頁面裡的舊版引擎再接手（MAIN world 的程式在擴充功能重新載入後不會自己消失）。更早的版本無法卸下，會透過舊的事件名稱收到 `enabled: false` 而停用。

權限：`storage`（設定）、`scripting`＋`<all_urls>`（把 content script 注入已開啟的分頁）、`notifications`（無法顯示頁面通知時使用）、`activeTab`。

## 設定頁

| 分頁 | 內容 |
|---|---|
| 一般 | 行為開關（Tab 跳格、cdlatex 式 Tab 移動、簡化上下標、自動配對、Backspace 還原、自動空白）、snippet 組合（laas／cdlatex／Web 擴充）、cheat sheet |
| Snippet 編輯器 | 文字設定（像 Emacs 設定檔）＋即時驗證＋試玩區 |
| Cheat sheet | 完整清單，可以搜尋、篩選，並切換「一般網站／Overleaf」 |
| 快捷鍵 | 目前的全域快捷鍵，以及編輯器裡的按鍵說明 |
| 網站 | 停用的網站清單（也可以在 popup 一鍵切換） |

內建 snippet 和 laas.el 的對照請看 [engine README](../web-laas-engine/README.md#內建-snippet)。

- 數學模式判斷：`$…$`、`$$…$$`、`\(…\)`、`\[…\]`，以及 `equation`／`align` 等環境；`\text{…}` 內視為文字模式。
- 輸入法：組字中不會觸發。注音／拼音等輸入法常以組字或 `insertText` 送出 `` ` `` `'` `[` 這類標點（keydown 是 229），這些送進來的 ASCII 字元也會拿來比對 trigger，中文字不受影響。
- Overleaf 等編輯器的自動完成選單開著時，Tab 交給編輯器處理。

## 設定語法

請參考 [`web-laas-engine` 的說明](../web-laas-engine/README.md#設定語言)。設定頁的「恢復範本」會帶出有註解的範例。

## 架構

```
src/content/main.ts      MAIN world：建立 web-laas-engine 的 LaasController（可以直接拿到 CodeMirror instance）
src/content/isolated.ts  isolated world：讀取 chrome.storage，再用 CustomEvent 把設定傳給 main.ts
src/options/             設定頁（編輯器、驗證、試玩區），試玩區也是 LaasController
src/popup/、background.ts 開關、單一網站停用、Alt+Shift+L／Alt+Shift+K
src/cheatsheet/           cheat sheet 元件（KaTeX → MathML）與頁面浮窗（closed shadow DOM）；
                          打包成 cheatsheet.js，按下快捷鍵時才注入最上層頁面，KaTeX 不會載入每個 iframe
```

build 時透過 esbuild 的 `source` condition 直接打包 engine 的 TypeScript 原始碼，所以修改 engine 後不需要先另外 build engine。

## 測試

```sh
npm run serve:preview    # http://localhost:8766/test/preview/{options,popup,overlay}-preview.html（使用假的 chrome.*）
```

編輯器行為的測試放在 engine 套件（`packages/web-laas-engine/test/`）。

## 已知限制

- Monaco（Colab、VS Code web）目前不支援。
- 不支援 mirror tabstop：同一個編號出現兩次時，只有第一個是 tabstop。
- contenteditable 的位置是用線性化文字計算的。遇到很特殊的 DOM 結構（例如嵌入式公式方塊）時，位置可能會偏移。
- 會把 `'` 自動轉成 `’` 的編輯器（smart quotes）會讓 `x'.` 這類 accent snippet 失效。
