# FreeMind v2.0 项目约定

## 工作流约定

- **每次代码修改完成且需要用户验证时，主动启动应用供用户自测**（`npm run tauri dev`，后台运行）。不要等到用户要求才启动。

## 验证要求

- 改动完成后必须通过：`npx tsc --noEmit`、`npm run build`
- 功能改动需配套 puppeteer 自测脚本（根目录 `verify_*.mjs`，连 http://localhost:1420），并回归既有脚本：
  - `verify_stickywall.mjs`（便签，30 条断言）
  - `verify_freelayout.mjs`（自由布局，16 条断言）
  - `verify_layout_opt.mjs`（布局优化，12 条断言）
  - `verify_copypaste.mjs`（复制粘贴，22 条断言）
- 浏览器环境下 `@tauri-apps/api` 的 `transformCallback` 报错属预期，忽略

## 代码约定

- 注释使用中文，遵循现有文件风格
- 数据层一律不可变更新（写时复制），历史快照与当前数据共享对象，原地修改会污染撤销/重做
- `useMindMap.ts` 中 copy/paste 遗留的 console.log 保留不动
