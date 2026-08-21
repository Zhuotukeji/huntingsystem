# GitHub Pages 发布隐私政策

仓库已经包含可直接发布的静态页面：

- `docs/index.html`：站点入口，自动跳转到隐私政策。
- `docs/privacy.html`：中英双语隐私政策。
- `docs/.nojekyll`：要求 GitHub Pages 原样发布静态文件。

## 首次启用

1. 将这些文件合并并推送到默认分支 `main`。
2. 打开仓库 [Settings → Pages](https://github.com/Zhuotukeji/huntingsystem/settings/pages)。
3. 在 **Build and deployment** 中将 **Source** 选择为 `Deploy from a branch`。
4. 在 **Branch** 中选择 `main`，目录选择 `/docs`，点击 **Save**。
5. 等待 GitHub 显示 `Your site is live`。首次发布通常需要几分钟。
6. 打开并检查：`https://zhuotukeji.github.io/huntingsystem/privacy.html`。

## Chrome Web Store

在 Chrome Web Store 的 **Privacy practices → Privacy policy URL** 中填写：

```text
https://zhuotukeji.github.io/huntingsystem/privacy.html
```

保存草稿后，用无痕窗口打开该地址，确认无需 GitHub 登录即可访问，再提交审核。

## 后续更新

修改 `docs/privacy.html` 中的内容和“最近更新”日期，提交并推送到 `main`。GitHub Pages 会自动重新发布，不需要再次配置。

发布者名称或联系渠道变化时，需要同时更新隐私政策和 Chrome Web Store 开发者资料。隐私请求通过商品详情页中已验证的发布者联系邮箱接收，避免在公开仓库中写入未经确认的个人邮箱。
