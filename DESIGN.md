# 象棋 AI 桥接控制台 Design System

> 项目代号：xiangqi-bridge — 一个本地 Web 控制台，用于启动/停止象棋 AI 自动对弈桥接，实时查看局面与引擎日志。

## Visual Theme & Atmosphere
- Mood: professional_minimal
- Feel: Clean, confident, restrained —— 一个「打开就能用」的工具台，不花哨、不干扰，把注意力留给棋盘与日志。
- References: 开发者工具控制台（Vercel / Linear / Raycast 式的克制面板），无装饰性阴影，靠留白与排版建立层级。

## Color Palette & Roles
- Background: #FFFFFF
- Surface: #F8FAFC
- Text primary: #0F172A
- Text secondary: #64748B
- Accent: #3B82F6
- Accent hover: #2563EB

## Typography Rules
- Display: Inter (same as body), 600, clamp(2rem, 5vw, 3.5rem)
- Body: Inter, 400, 1rem/1.6
- Mono: JetBrains Mono, 400, 0.875rem —— 用于日志控制台、FEN 字符串与数值显示。

## Component Stylings
- Buttons: rounded-md, accent bg, contrast text；次要按钮用 surface bg + 1px 边框。
- Cards: surface bg (#F8FAFC), subtle border, 12px radius。
- Inputs: transparent bg, bottom border（底部一条 1px 分隔线，聚焦时变为 accent）。

## Layout Principles
- Max width: 1200px
- Grid: single_column（控制面板自上而下：状态栏 → 配置 → 棋盘 → 日志）
- Section spacing: 72px
- Content padding: 24px/40px

## Depth & Elevation
- Shadows: none（professional_minimal，不用投影建立层级）。
- Borders: 1px solid rgba(15, 23, 42, 0.08)

## Do's and Don'ts
- DO use the declared color tokens exclusively.
- DO maintain consistent section spacing.
- DO ensure all text meets WCAG AA contrast ratio.
- DON'T invent colors outside the palette.
- DON'T add decorative shadows unless Depth & Elevation allows them.
- DON'T use more than 2 display/body typefaces (monospace is a utility face for code and data — it does not count toward this limit).

## Responsive Behavior
- Breakpoints: 640px (sm), 768px (md), 1024px (lg), 1280px (xl)
- Mobile: single column, stack all sections vertically
- Tablet: allow 2-column feature grids
- Desktop: full layout with max-width constraint
- Images: fluid, max-width 100%, maintain aspect ratio

## Agent Prompt Guide
- Do NOT invent colors outside this palette.
- Do NOT add box-shadows unless specified above.
- Accent color appears maximum 3 times per viewport.
- All interactive elements need :focus-visible outline.
