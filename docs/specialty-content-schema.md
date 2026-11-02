# 跨科別教材與題庫資料規格（`content/<s>/`）

本文件說明全部 26 個非眼科臨床科別（`ent` 耳鼻喉科、`rad` 放射診斷科、`radonc` 放射腫瘤科、`nm` 核子醫學科、`neuro` 神經內科、`gs` 一般外科、`prs` 整形外科、`ortho` 骨科、`uro` 泌尿外科、`ns` 神經外科、`gm` 一般內科、`cv` 心臟內科、`pulm` 胸腔內科、`gi` 胃腸肝膽科、`nephro` 腎臟內科、`endo` 內分泌新陳代謝科、`hemeonc` 血液腫瘤內科、`id` 感染科、`rheu` 風濕免疫科、`ped` 小兒科、`obgyn` 婦產科、`derm` 皮膚科、`psych` 精神科、`pmr` 復健科、`anes` 麻醉科、`fm` 家庭醫學科；連同眼科 `oph` 共 27 科）各科教材資料夾 `content/<s>/` 的 JSON 規格、欄位驗證規則與建置流程。

- **建置工具**：`scripts/apply-specialty.py`
- **目標區塊**：`<script type="application/json" id="course-data-<s>">`（位於 `index.html`）
- **不變量**：眼科 `<script type="application/json" id="course-data">` 絕不被 `apply-specialty.py` 觸碰，建置前後皆強制驗證 `course-data` 之 SHA-256 不變。
- **內容規範**：所有教材文字、選擇題、口試題與流程均須為繁體中文原創重述，並逐筆附上經核對之真實來源（`source`）。不得逐字貼上共筆或教科書原文；缺圖或原檔模糊之影像題不得臆測補造答案。

---

## 1. 指令用法

```bash
# 驗證並嵌入全部 26 個非眼科科別（ent, rad, radonc, nm, neuro, gs, prs, ortho, uro, ns, gm, cv, pulm, gi, nephro, endo, hemeonc, id, rheu, ped, obgyn, derm, psych, pmr, anes, fm）
python3 scripts/apply-specialty.py

# 只建置單一科別（可重複指定 --s）
python3 scripts/apply-specialty.py --s nm

# CI / 本地檢查模式（驗證 JSON 規格且確認 index.html 內嵌資料已同步，不寫入檔案）
python3 scripts/apply-specialty.py --check
python3 scripts/apply-specialty.py --s nm --check

# 指定測試 fixture 目錄與暫存 index.html（供自動化測試使用）
python3 scripts/apply-specialty.py --s nm --content-root /tmp/fixtures --index /tmp/index.html
```

完整網站建置順序（含眼科與共用模組）建議將 `apply-specialty.py` 置於 `apply-enrichment.py` 之後（或最後一步）：

```bash
python3 scripts/apply-enrichment.py
python3 scripts/apply-specialty.py
python3 scripts/apply-textbook.py
python3 scripts/apply-learning-project.py
python3 scripts/apply-advanced-training.py
python3 scripts/apply-exam-schedule.py
python3 scripts/apply-app-install.py
```

（`apply-enrichment.py` 會保留已存在的 `course-data-<s>` 區塊；當 `content/<s>/` 內容有更新時，執行 `python3 scripts/apply-specialty.py` 即可更新對應區塊。）

---

## 2. 目錄結構與可選檔案

每個科別 `<s>`（`NON_OPH_SPECIALTIES` 所列 26 個非眼科科別代碼）對應 `content/<s>/`。若該目錄不存在或尚無檔案，建置會維持預設空殼，前端對應頁面顯示「內容待補」。

支援的頂層 JSON 檔案如下（皆為選用；頂層若出現未列於下表且非 `_` 開頭的 `.json` 檔會直接報錯，避免檔名拼字錯誤被忽略）：

| 檔案名稱（支援別名） | 型別 | 用途 |
|---|---|---|
| `meta.json` | `object` | 覆寫科別標題、`exam`、`plan`、`notes`、考前清單、故事／證據卡種子、`notebook` 說明 |
| `topics.json` | `array` | 章節／主題教材（對應「章節教材」與「主動複習」） |
| `questions.json` | `array` | 單選題庫（對應「筆試練習」與「今日複習」SRS） |
| `past-exam-questions.json` | `array` | 選用；歷屆考點改寫單選題（每題須設 `"pastExam": true`，亦可直接放在 `questions.json`） |
| `interview.json` | `array` | 通用面試與臨床口試題組（對應「面試演練」） |
| `interviewSamples.json`（或 `interview-samples.json`） | `object` | 3 位示範者回答對照 |
| `interviewDetailed.json`（或 `interview-detailed.json`） | `object` | 詳細口述參考答案、追問回答與考官重點 |
| `workflows.json`（或 `clinical-workflows.json`） | `object` | 臨床處置與操作安全流程（含排序練習） |
| `pbl.json`（或 `pbl-cases.json`） | `object` | 多幕式 PBL 臨床情境討論 |
| `enrichment.json`（或 `study-enrichment.json`） | `object` | 章節延伸資源、深入解析、口述挑戰與整合式學習單元 |

---

## 3. 全域驗證鐵律

1. **必填 `source`（來源依據）**：
   - `topics.json`、`questions.json`（含 `past-exam-questions.json`）、`interview.json`、`workflows.json`（每條流程）、`pbl.json`（每個個案）及 `enrichment.json`（每章）的每個項目**都必須包含非空白 `source`**。
   - `source` 可為單一非空字串（例如 `"SNMMI Procedure Standard for Thyroid Scintigraphy 4.0 (2019)"`）或非空字串陣列（例如 `["ICRP Publication 105", "核子醫學專科醫師甄審歷屆考點整理"]`）。缺少或空白一律拒絕建置。
2. **選擇題必須具備有效正解與解析**：
   - 每題必須提供 `correctIndex`（整數 `0 <= correctIndex < len(options)`，不可為 `bool`）或 `answer`（與 `options` 其中一個選項完全相符的字串）；若兩者同時提供，必須一致（`options[correctIndex] == answer`），建置後統一輸出 `correctIndex`。
   - 正解不可靠長度猜出：全題庫中正解是最長選項（含並列最長）的比例不得超過 40%（機率約 25%），`scripts/test-specialty.cjs` 會檢查。
   - 缺少正解、索引越界、選項重複或缺少 `explanation` 一律拒絕建置。
3. **科別 ID 命名空間前綴**：
   - `topics.json`、`questions.json`、`interview.json`、`enrichment.json` 資源 ID：必須符合 `^<s>-[a-z0-9-]+$`（例如 `nm-thyroid`、`nm-q001`、`nm-iv-01`）。
   - `workflows.json` 流程 ID：必須符合 `^wf-<s>-[a-z0-9-]+$`（例如 `wf-nm-fdg-prep`，配合 `#wf-...` 路由）。
   - `pbl.json` 個案 ID：必須符合 `^pbl-<s>-[a-z0-9-]+$`（例如 `pbl-nm-dtc-i131`，配合 `#pbl-...` 路由）。
4. **參照完整性（Referential Integrity）**：
   - `questions[*].topicId`、`workflows[*].topicIds`、`pbl[*].topicIds`、臨床 `interview[*].topicId` 必須存在於該科 `topics.json`。
   - `pbl[*].workflowIds` 必須存在於該科 `workflows.json`。
   - `interviewSamples.answers` 與 `interviewDetailed.answers` 的鍵必須存在於該科 `interview.json`。

---

## 4. 各檔案欄位規格與範例

### 4.1 `topics.json`

```json
[
  {
    "id": "nm-thyroid",
    "chapter": 1,
    "title": "甲狀腺核醫診斷與放射碘治療：攝取機轉與適應症",
    "summary": "整合 NIS 轉運機轉、放射碘攝取率（RAIU）與掃描型態鑑別甲狀腺毒症。",
    "source": "SNMMI Procedure Standard for Thyroid Scintigraphy 4.0",
    "sourceUrl": "https://www.snmmi.org/",
    "sections": [
      {
        "title": "放射碘攝取率與掃描判讀",
        "points": [
          "瀰漫性高攝取支持 Graves 病；極低攝取合併甲狀腺毒症優先考慮破壞性甲狀腺炎或外源性甲狀腺素／含碘顯影劑干擾。"
        ],
        "recall": "甲狀腺毒症合併低攝取時，應先排除哪些原因？",
        "ref": "Section III"
      }
    ],
    "compare": [
      ["Graves 病 vs 亞急性甲狀腺炎", "前者雙側瀰漫性高攝取；後者攝取顯著受抑", "治療策略完全不同，不可對甲狀腺炎投予抗甲狀腺藥或碘-131"]
    ],
    "cases": [
      {
        "prompt": "年輕女性心悸、TSH 受抑、Free T4 升高，安排核醫檢查前必問哪些項目？",
        "answer": "先確認是否懷孕或哺乳（絕對／相對禁忌）、近期是否接受含碘顯影劑或服用抗甲狀腺藥物與含碘補充品。"
      }
    ],
    "notes": "懷孕為放射碘檢查與治療之絕對禁忌。"
  }
]
```

### 4.2 `questions.json`

```json
[
  {
    "id": "nm-q001",
    "topicId": "nm-thyroid",
    "stem": "35 歲女性出現頸部壓痛、心悸與手抖，TSH < 0.01 mIU/L、Free T4 升高，24 小時放射碘攝取率為 1%。最可能的診斷為何？",
    "options": [
      "Graves 病",
      "亞急性肉芽腫性甲狀腺炎",
      "毒性多結節性甲狀腺腫",
      "自主功能性甲狀腺腺瘤"
    ],
    "correctIndex": 1,
    "explanation": "考點：甲狀腺毒症合併極低放射碘攝取率代表濾泡破壞釋放預存荷爾蒙或碘池干擾，頸部壓痛支持亞急性甲狀腺炎。\n\n常見陷阱：誤將所有檢驗呈甲狀腺毒症者皆當作功能亢進而開立抗甲狀腺藥物。",
    "source": "SNMMI Procedure Standard for Thyroid Scintigraphy 4.0",
    "pastExam": true,
    "safety": true
  }
]
```

### 4.3 `interview.json`

- `rubric` **固定為 5 個自評字串**（與前端進度驗證對齊）。
- `clinical: true` 時（若 `topics.json` 非空）必填存在的 `topicId`。

```json
[
  {
    "id": "nm-iv-01",
    "title": "放射碘治療前妊娠與哺乳安全核對",
    "question": "育齡女性擬接受碘-131 治療，你在門診衛教與給藥前會如何完成安全確認？",
    "durationSeconds": 180,
    "clinical": true,
    "topicId": "nm-thyroid",
    "answer": "第一時間確認妊娠排除流程、停止哺乳時程與居家輻射防護規範，並留存書面與檢驗紀錄。",
    "followups": [
      "若病人仍在哺乳，為何不能只暫停數天就恢復哺乳？"
    ],
    "rubric": [
      "第一句直接說明妊娠屬於絕對禁忌與檢驗時效",
      "清楚區分檢查與治療後對哺乳的處置差異",
      "具體說明居家距離、時間與衛浴防護原則",
      "使用病人聽得懂且不引發過度恐慌的語言",
      "交代不確定情境下向主治醫師與輻防人員確認的步驟"
    ],
    "source": "ICRP Publication 105; ATA Management Guidelines"
  }
]
```

### 4.4 `workflows.json` 與 `pbl.json`

- `workflows.json`：頂層含 `reviewedDate`、`intro`、`disclaimer`、`categories`（可省略以套用預設四分類：`emergency`、`same-day`、`safety`、`screening`）與 `workflows` 陣列。每筆流程 ID 為 `wf-<s>-<slug>`，含 `source`、`category`、`title`、`urgency`、`trigger`、`topicIds`、`steps`（`2–12` 步，`title` 不可重複，至少一步 `critical: true`）、`redFlags`、`pitfalls`、`examQuestions`（`[{q, a}]`）與 `handoff`。
- `pbl.json`：頂層含 `reviewedDate`、`intro`、`disclaimer`、`method`（可省略以套用預設五步）與 `cases` 陣列。每筆個案 ID 為 `pbl-<s>-<slug>`，含 `source`、`title`、`theme`、`trigger`、`topicIds`、`workflowIds`（選用）、`stages`（`2–5` 幕，每幕含 `title`、`info`、`prompts`、`facts`、`hypotheses`、`needToKnow`、`discussion`）、`learningIssues`（`[{issue, why}]`）、`humanities`（`{title, points}`）、`examinerFollowups`（`[{q, a}]`）與 `takeaway`。
