# Chrome Web Store 审核说明

以下内容可直接填写到 Chrome Web Store 的审核备注中。

## 中文

本扩展主要连接企业本地运行的招聘后台。为了让审核员无需访问企业内网、无需 BOSS 账号，也能验证全部核心交互，V0.6.10 内置了完全离线的“商店审核模式”。

测试步骤：

1. 安装扩展，点击工具栏图标打开侧边栏。
2. 在首次连接页点击“进入商店审核演示”，无需填写邮箱或访问码。
3. 在“任务”页领取任一合成任务。可以复制搜索词；点击“打开演示页”会打开扩展内置的合成长简历。
4. 保持演示页可见，返回侧边栏点击“分析当前演示页”，确认截图提示后可看到合成候选人的评分、可见证据和未知项。
5. 点击“生成招呼语草稿”，可验证草稿生成和复制；扩展不会自动发送消息。
6. 切换到“扫描简历”，点击“开始扫描”。扩展会按标签页 ID 定向捕获当前演示页，不会弹出屏幕共享选择器；随后每滚动到一个需要保留的位置，点击侧边栏中的“截取当前帧”，再点击“完成扫描并识别”。侧边栏会显示关键帧数量和本地合成识别结果。
7. 在“设置”页可以看到“商店审核演示 / 无需后台 / 本地合成结果 / 仅限内置演示页”等状态。点击“退出商店审核演示”可返回正式登录入口。

审核模式中的公司、人才、任务、截图判断和招呼语均为内置合成数据。该模式不会连接企业后台或 AI 服务，不允许分析真实 BOSS 页面，截图和关键帧只在扩展内存中短暂处理，不上传、不保存、不写入简历库。

## English

This extension normally connects to an employer-operated recruitment backend on localhost. Version 0.6.10 includes a fully offline Chrome Web Store Review Mode so reviewers can verify every core interaction without access to the employer network, a BOSS account, credentials, or real candidate data.

Review steps:

1. Install the extension and click its toolbar icon to open the side panel.
2. On the initial connection screen, click “进入商店审核演示” (Enter Web Store Review Demo). No email or access code is required.
3. On the Tasks tab, claim either synthetic task. Search terms can be copied. “打开演示页” opens the bundled synthetic long-form resume page.
4. Keep the synthetic page visible, return to the side panel, and click “分析当前演示页”. After confirming the visible-page capture, the extension shows a synthetic score, visible evidence, and unknown items.
5. Click “生成招呼语草稿” to verify greeting draft generation and copy. The extension never sends messages automatically.
6. Open the Resume Scan tab and click “开始扫描”. The extension targets the current demo tab by tab ID and does not open a screen-sharing picker. At each scroll position you want to capture, click “截取当前帧” in the side panel, then click “完成扫描并识别”. The side panel displays the keyframe count and a local synthetic extraction result.
7. The Settings tab shows Review Demo, No Backend Required, Local Synthetic Result, and Bundled Demo Page Only. Click “退出商店审核演示” to return to the production login screen.

All companies, people, tasks, screenshot assessments, and greeting drafts in Review Mode are bundled synthetic fixtures. Review Mode does not contact the employer backend or any AI service, cannot analyze a real BOSS page, and keeps captured screenshots/keyframes only briefly in extension memory. Nothing is uploaded, stored, or written to the resume database.
