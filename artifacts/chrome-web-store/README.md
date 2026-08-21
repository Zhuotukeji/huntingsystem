# 觅才 Chrome Web Store 素材

本目录中的公开素材只使用合成候选人与虚构公司信息，不包含真实姓名、联系方式、API Key 或插件访问码。

| 文件 | 尺寸 | 建议用途 |
| --- | --- | --- |
| `store-icon-128.png` | 128 × 128 | 商店图标 |
| `01-search-workflow.png` | 1280 × 800 | 截图 1：AI 搜索任务与插件执行闭环 |
| `02-evidence-review.png` | 1280 × 800 | 截图 2：候选人证据、未知项与招呼语草稿 |
| `03-resume-graph-learning.png` | 1280 × 800 | 截图 3：简历扫描、结构化学习与人才图谱 |
| `small-promo-440x280.png` | 440 × 280 | 小宣传图 |

`source.html` 是可复现的素材源文件。需要预览时，在仓库根目录运行：

```powershell
node artifacts/chrome-web-store/serve.mjs
```

然后访问 `http://127.0.0.1:4179/source.html?asset=shot-1`。可选的 `asset` 值为 `shot-1`、`shot-2`、`shot-3`、`promo` 和 `icon`。
