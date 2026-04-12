const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 40" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="om-gradient" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#4f46e5" />
    </linearGradient>
  </defs>
  <g transform="translate(0, 2)">
    <path d="M18 2 L32 10 V26 L18 34 L4 26 V10 Z" fill="url(#om-gradient)" />
    <path d="M13 18 L17 22 L23 14" stroke="var(--bg-secondary, white)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </g>
  <text x="44" y="28" font-family="'Inter', -apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="700" fill="currentColor" letter-spacing="-0.03em">OpenMark</text>
</svg>`;

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="om-gradient-icon" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#4f46e5" />
    </linearGradient>
  </defs>
  <path d="M20 4 L34 12 V28 L20 36 L6 28 V12 Z" fill="url(#om-gradient-icon)" />
  <path d="M15 20 L19 24 L25 16" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenMark Router Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg-primary: #fafafa;
      --bg-secondary: #ffffff;
      --bg-card: #ffffff;
      --text-primary: #1a1a1a;
      --text-secondary: #6b7280;
      --border-color: #e5e7eb;
      --input-border: #e5e7eb;
      --shadow: rgba(0, 0, 0, 0.04);
      --shadow-md: rgba(0, 0, 0, 0.06);
      --code-bg: #f9fafb;
      --selection-bg: #bfdbfe;
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --success: #059669;
      --warning: #d97706;
      --error: #dc2626;
      --border: #e5e7eb;
      --table-header-bg: #f8fafc;
      --table-header-hover: #f1f5f9;
      --scrollbar-bg: #f3f4f6;
      --scrollbar-thumb: #d1d5db;
      --scrollbar-thumb-hover: #9ca3af;
    }

    body[data-theme="dark"] {
      color-scheme: dark;
      --bg-primary: #0a0a0a;
      --bg-secondary: #171717;
      --bg-card: #171717;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --border-color: #27272a;
      --input-border: #3f3f46;
      --shadow: rgba(0, 0, 0, 0.2);
      --shadow-md: rgba(0, 0, 0, 0.3);
      --code-bg: #18181b;
      --selection-bg: #312e81;
      --primary: #5b5bd6;
      --primary-hover: #6e6eef;
      --success: #0d9668;
      --warning: #d97706;
      --error: #dc2626;
      --border: #27272a;
      --table-header-bg: #1a1d23;
      --table-header-hover: #252a33;
      --scrollbar-bg: #171717;
      --scrollbar-thumb: #3f3f46;
      --scrollbar-thumb-hover: #52525b;
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      background: var(--bg-primary);
      color: var(--text-primary);
      transition: background-color 0.3s ease, color 0.3s ease;
    }

    ::selection {
      background: var(--selection-bg);
    }

    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    ::-webkit-scrollbar-track {
      background: var(--scrollbar-bg);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb);
      border-radius: 999px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover);
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      background: var(--bg-primary);
    }

    .sticky-shell {
      position: sticky;
      top: 0;
      z-index: 30;
      background: var(--bg-secondary);
      box-shadow: 0 2px 4px var(--shadow);
    }

    body[data-theme="dark"] .sticky-shell {
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 60px;
      padding: 0.75rem 1.5rem;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .brand-logo {
      display: block;
      width: 180px;
      max-width: 100%;
      color: var(--text-primary);
    }

    .brand-mark {
      display: none;
      width: 32px;
      height: 32px;
      color: var(--text-primary);
    }

    .topbar-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 3px 10px;
      border: 1px solid var(--border-color);
      border-radius: 20px;
      background: var(--bg-primary);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .badge.success {
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.3);
      color: var(--success);
    }

    .btn {
      padding: 0.625rem 1.25rem;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      box-shadow: 0 1px 2px var(--shadow);
    }

    .btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px var(--shadow-md);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background-color: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }

    .btn-primary:hover:not(:disabled) {
      background-color: var(--primary-hover);
      border-color: var(--primary-hover);
    }

    .btn-ghost {
      border-color: var(--border-color);
      background: var(--bg-secondary);
    }

    .theme-btn {
      min-width: 96px;
      justify-content: center;
    }

    .subnav {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      overflow-x: auto;
    }

    .subnav::-webkit-scrollbar {
      height: 6px;
    }

    .subnav-link {
      display: inline-flex;
      align-items: center;
      min-height: 48px;
      padding: 0 12px;
      color: var(--text-secondary);
      font-size: 1rem;
      font-weight: 600;
      border-bottom: 3px solid transparent;
      transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
      white-space: nowrap;
    }

    .subnav-link:hover {
      color: var(--text-primary);
      background: rgba(0, 0, 0, 0.03);
    }

    body[data-theme="dark"] .subnav-link:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .subnav-link.active {
      color: var(--primary);
      border-color: var(--primary);
      font-weight: 700;
      background: rgba(79, 70, 229, 0.05);
    }

    body[data-theme="dark"] .subnav-link.active {
      background: rgba(99, 102, 241, 0.1);
    }

    .content {
      width: min(1200px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 56px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.95fr);
      gap: 16px;
      margin-bottom: 16px;
    }

    .hero-panel,
    .panel,
    .metric-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 1px 2px var(--shadow);
      transition: all 0.15s ease;
    }

    .hero-panel {
      padding: 20px 22px;
    }

    .hero-panel h1 {
      margin: 0 0 8px;
      font-size: 1.65rem;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: -0.03em;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .hero-copy {
      color: var(--text-secondary);
      font-size: 0.95rem;
      max-width: 62ch;
    }

    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }

    .hero-side {
      display: grid;
      gap: 12px;
      padding: 16px 18px;
      align-content: start;
    }

    .hero-side-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
      margin: 0;
    }

    .hero-side-value {
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
    }

    .hero-side-copy {
      color: var(--text-secondary);
      font-size: 0.88rem;
      margin: 0;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .metric-card {
      padding: 16px;
    }

    .metric-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
      margin-bottom: 10px;
    }

    .metric-value {
      font-size: 1.4rem;
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .metric-subtext {
      margin-top: 6px;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .section-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
      gap: 16px;
      margin-bottom: 16px;
    }

    .stack {
      display: grid;
      gap: 16px;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .panel-header h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .panel-body {
      padding: 16px;
    }

    .panel-note,
    .muted {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .panel-note a {
      color: var(--primary);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip-region {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-width: 100%;
      align-items: flex-start;
      align-content: flex-start;
    }

    .provider-stack {
      display: grid;
      gap: 10px;
      width: 100%;
    }

    .provider-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 6px;
    }

    .provider-summary-copy {
      color: var(--text-secondary);
      font-size: 0.82rem;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 3px 10px;
      border-radius: 12px;
      border: 1px solid var(--border-color);
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 0.8rem;
      font-weight: 500;
    }

    .chip.good {
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.3);
      color: var(--success);
    }

    .chip.warn {
      background: rgba(217, 119, 6, 0.1);
      border-color: rgba(217, 119, 6, 0.3);
      color: var(--warning);
    }

    .chip.bad {
      background: rgba(220, 38, 38, 0.1);
      border-color: rgba(220, 38, 38, 0.3);
      color: var(--error);
    }

    .rows {
      display: grid;
      gap: 0;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 0;
      border-top: 1px solid var(--border-color);
    }

    .row:first-child {
      padding-top: 0;
      border-top: 0;
    }

    .key {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .value {
      text-align: right;
      word-break: break-word;
      font-size: 0.95rem;
    }

    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .field {
      display: grid;
      gap: 8px;
    }

    .field-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.9rem;
      font-weight: 500;
    }

    select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--input-border);
      border-radius: 8px;
      font-size: 0.95rem;
      transition: all 0.15s ease;
      background-color: var(--bg-secondary);
      color: var(--text-primary);
    }

    select:focus,
    .theme-btn:focus,
    .btn:focus,
    .toggle-input:focus + .toggle-slider {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--shadow-md);
    }

    body[data-theme="dark"] select:focus,
    body[data-theme="dark"] .theme-btn:focus,
    body[data-theme="dark"] .btn:focus,
    body[data-theme="dark"] .toggle-input:focus + .toggle-slider {
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0 4px;
    }

    .toggle-copy {
      display: grid;
      gap: 4px;
    }

    .toggle-copy strong {
      font-size: 0.95rem;
      font-weight: 600;
    }

    .toggle-copy span {
      color: var(--text-secondary);
      font-size: 0.82rem;
    }

    .toggle {
      position: relative;
      display: inline-flex;
      align-items: center;
      width: 36px;
      height: 20px;
      flex: 0 0 auto;
    }

    .toggle-input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      margin: 0;
    }

    .toggle-slider {
      width: 36px;
      height: 20px;
      background-color: var(--border-color);
      border-radius: 20px;
      transition: all 0.25s ease;
      position: relative;
    }

    .toggle-slider::before {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      background-color: #ffffff;
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
      transition: transform 0.25s ease;
    }

    .toggle-input:checked + .toggle-slider {
      background-color: var(--primary);
    }

    .toggle-input:checked + .toggle-slider::before {
      transform: translateX(16px);
    }

    .panel-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
      flex-wrap: wrap;
    }

    .file-input {
      display: none;
    }

    .import-box {
      margin-top: 18px;
      padding: 14px;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      background: var(--bg-primary);
      display: grid;
      gap: 10px;
    }

    .import-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .import-box-title {
      font-size: 0.95rem;
      font-weight: 600;
      margin: 0;
    }

    .import-box-copy {
      color: var(--text-secondary);
      font-size: 0.82rem;
      margin: 0;
    }

    .import-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .import-file-meta {
      color: var(--text-secondary);
      font-size: 0.82rem;
    }

    .status {
      min-height: 20px;
      font-size: 0.82rem;
    }

    .status.ok {
      color: var(--success);
    }

    .status.error {
      color: var(--error);
    }

    .status.warn {
      color: var(--warning);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }

    thead tr {
      background: var(--table-header-bg);
    }

    th,
    td {
      text-align: left;
      padding: 12px 10px;
      border-top: 1px solid var(--border-color);
      vertical-align: top;
    }

    th {
      color: var(--text-secondary);
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    tbody tr {
      transition: background 0.15s ease;
    }

    tbody tr:hover {
      background: var(--table-header-hover);
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    }

    .empty-state {
      padding: 18px 0 6px;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .table-action {
      white-space: nowrap;
      text-align: right;
    }

    .btn-linkish {
      border: 0;
      background: transparent;
      box-shadow: none;
      padding: 0;
      color: var(--primary);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-linkish:hover:not(:disabled) {
      transform: none;
      box-shadow: none;
      color: var(--primary-hover);
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    body[data-theme="dark"] .modal-backdrop {
      background: rgba(0, 0, 0, 0.7);
    }

    .modal-backdrop.open {
      display: flex;
    }

    .modal-content {
      background: var(--bg-primary);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      max-width: 720px;
      width: min(100%, 720px);
      max-height: 80vh;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }

    body[data-theme="dark"] .modal-content {
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
    }

    .modal-header {
      padding: 1rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .modal-title-wrap {
      display: grid;
      gap: 4px;
    }

    .modal-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
    }

    .modal-subtitle {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      color: var(--text-primary);
      white-space: pre-wrap;
    }

    .footer {
      margin-top: 16px;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }

    @media (max-width: 1080px) {
      .hero,
      .section-grid {
        grid-template-columns: 1fr;
      }

      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .topbar {
        padding: 0.75rem 1rem;
      }

      .content {
        width: min(100vw - 24px, 1200px);
        padding-top: 16px;
      }

      .brand-logo {
        display: none;
      }

      .brand-mark {
        display: block;
      }

      .metrics {
        grid-template-columns: 1fr;
      }

      .settings-grid {
        grid-template-columns: 1fr;
      }

      .row {
        flex-direction: column;
      }

      .value {
        text-align: left;
      }

      .subnav {
        padding: 0 12px;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="sticky-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-logo">${LOGO_SVG}</div>
          <div class="brand-mark">${ICON_SVG}</div>
          <div class="badge">Router Dashboard</div>
        </div>
        <div class="topbar-actions">
          <div class="badge success" id="healthBadge">Health: loading</div>
          <button id="themeToggle" type="button" class="btn btn-ghost theme-btn">Theme: Auto</button>
          <button id="refreshBtn" type="button" class="btn btn-primary">Refresh</button>
        </div>
      </header>

      <nav class="subnav" aria-label="Dashboard sections">
        <a class="subnav-link active" href="#overview">Overview</a>
        <a class="subnav-link" href="#controls">Controls</a>
        <a class="subnav-link" href="#providers">Providers</a>
        <a class="subnav-link" href="#benchmarks">Benchmarks</a>
      </nav>
    </div>

    <main class="content">
      <section class="hero" id="overview">
        <div class="hero-panel">
          <h1>OpenMark Router Control Center</h1>
          <div class="hero-copy">
            Local diagnostics and lightweight controls for the OpenMark AI Router.
            This dashboard stays close to the router itself: health, provider visibility,
            benchmark readiness, and a few practical controls.
          </div>
          <div class="hero-meta">
            <div class="chip" id="versionChip">Version -</div>
            <div class="chip" id="strategyChip">Strategy -</div>
            <div class="chip" id="routingCardChip">Routing card -</div>
          </div>
        </div>

        <aside class="hero-panel hero-side">
          <div>
            <div class="hero-side-title">Current Status</div>
            <p class="hero-side-value" id="heroStatus">Loading...</p>
          </div>
          <p class="hero-side-copy" id="heroSummary">
            Checking router health, providers, and benchmark data.
          </p>
          <div class="chips" id="heroBadges"></div>
        </aside>
      </section>

      <section class="metrics">
        <article class="metric-card">
          <div class="metric-label">Router Health</div>
          <div class="metric-value" id="healthValue">Loading...</div>
          <div class="metric-subtext">Local embedded router status</div>
        </article>
        <article class="metric-card">
          <div class="metric-label">Version</div>
          <div class="metric-value mono" id="versionValue">-</div>
          <div class="metric-subtext">Current plugin version</div>
        </article>
        <article class="metric-card">
          <div class="metric-label">Providers</div>
          <div class="metric-value" id="providersCountValue">-</div>
          <div class="metric-subtext">Configured and mapped providers</div>
        </article>
        <article class="metric-card">
          <div class="metric-label">Benchmark Categories</div>
          <div class="metric-value" id="categoriesCountValue">-</div>
          <div class="metric-subtext">Loaded OpenMark benchmark categories</div>
        </article>
      </section>

      <section class="section-grid" id="controls">
        <section class="panel">
          <div class="panel-header">
            <h2>Controls</h2>
            <div class="badge">v1 settings</div>
          </div>
          <div class="panel-body">
            <form id="settingsForm">
              <div class="settings-grid">
                <label class="field">
                  <span class="field-label">Routing Strategy</span>
                  <select id="routingStrategy" name="routing_strategy">
                    <option value="balanced">balanced</option>
                    <option value="best_score">best_score</option>
                    <option value="best_cost_efficiency">best_cost_efficiency</option>
                    <option value="best_under_budget">best_under_budget</option>
                    <option value="best_under_latency">best_under_latency</option>
                  </select>
                </label>
                <div class="field">
                  <div class="field-label">Routing Card</div>
                  <div class="toggle-row">
                    <div class="toggle-copy">
                      <strong>Show routing card</strong>
                      <span>Prepend routing context to routed replies.</span>
                    </div>
                    <label class="toggle" aria-label="Toggle routing card visibility">
                      <input id="showRoutingCard" name="show_routing_card" class="toggle-input" type="checkbox">
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="panel-actions">
                <button class="btn btn-primary" type="submit">Save Settings</button>
                <div class="panel-note">These controls update the local router config used by this plugin.</div>
              </div>
              <div id="saveStatus" class="status"></div>
            </form>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Config Summary</h2>
            <div class="badge">Source of truth: config.json</div>
          </div>
          <div class="panel-body">
            <div class="rows" id="configRows"></div>
          </div>
        </section>
      </section>

      <section class="section-grid" id="providers">
        <section class="panel">
          <div class="panel-header">
            <h2>Providers</h2>
            <div class="badge" id="providerSummaryBadge">Loading...</div>
          </div>
          <div class="panel-body">
            <div class="provider-summary">
              <div class="provider-summary-copy">Detected providers wrap within a bounded area so larger setups stay readable without breaking the panel layout.</div>
              <div class="badge" id="providerWrapBadge">Adaptive layout</div>
            </div>
            <div class="rows provider-stack">
              <div class="row">
                <div class="key">Detected providers</div>
                <div class="value">
                  <div class="chip-region" id="providersList"></div>
                </div>
              </div>
              <div class="row">
                <div class="key">Unmapped providers</div>
                <div class="value">
                  <div class="chip-region" id="unmappedProviders"></div>
                </div>
              </div>
              <div class="row">
                <div class="key">Detection notes</div>
                <div class="value" id="providerError">-</div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel" id="benchmarks">
          <div class="panel-header">
            <h2>Benchmark Summary</h2>
            <div class="badge" id="freshnessBadge">Loading...</div>
          </div>
          <div class="panel-body">
            <div class="rows">
              <div class="row">
                <div class="key">Freshness</div>
                <div class="value" id="freshnessSummary">Loading...</div>
              </div>
              <div class="row">
                <div class="key">Oldest export</div>
                <div class="value mono" id="oldestExport">-</div>
              </div>
              <div class="row">
                <div class="key">Newest export</div>
                <div class="value mono" id="newestExport">-</div>
              </div>
            </div>
            <div class="import-box">
              <div class="import-box-header">
                <div>
                  <p class="import-box-title">Import benchmark CSV</p>
                  <p class="import-box-copy">
                    Export benchmarks from <a href="https://openmark.ai" target="_blank" rel="noreferrer">OpenMark.ai</a>
                    on the Results tab using Export -> OpenClaw. The router imports them into the configured benchmark directory dynamically.
                  </p>
                </div>
                <div class="badge mono" id="benchmarkDirBadge">benchmarks</div>
              </div>
              <div class="import-actions">
                <input id="benchmarkFile" class="file-input" type="file" accept=".csv,text/csv">
                <button id="chooseBenchmarkBtn" type="button" class="btn btn-ghost">Choose CSV</button>
                <button id="importBenchmarkBtn" type="button" class="btn btn-primary" disabled>Import Benchmark</button>
                <div class="import-file-meta" id="importFileMeta">No file selected.</div>
              </div>
              <div class="panel-note" id="importHelpText">OpenMark Results tab -> Export -> OpenClaw</div>
              <div id="importStatus" class="status"></div>
            </div>
          </div>
        </section>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Categories</h2>
          <div class="badge" id="categoriesBadge">Loading...</div>
        </div>
        <div class="panel-body">
          <div class="panel-note" id="categoriesSubtitle">Loading...</div>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Display name</th>
                <th>Models</th>
                <th>Export date</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="categoriesTable"></tbody>
          </table>
          <div class="empty-state" id="categoriesEmpty" hidden>No benchmark categories detected yet.</div>
          <div class="footer">Served locally by the router on 127.0.0.1. This dashboard is intentionally lightweight and stays close to the plugin’s real runtime state.</div>
        </div>
      </section>
    </main>

    <div class="modal-backdrop" id="descriptionModal" role="dialog" aria-modal="true" aria-labelledby="descriptionModalTitle">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title-wrap">
            <h3 class="modal-title" id="descriptionModalTitle">Category description</h3>
            <p class="modal-subtitle mono" id="descriptionModalSubtitle">-</p>
          </div>
          <button id="closeDescriptionModal" type="button" class="btn btn-ghost">Close</button>
        </div>
        <div class="modal-body" id="descriptionModalBody">-</div>
      </div>
    </div>
  </div>
  <script>
    const STORAGE_KEY = 'openmark-router-dashboard-theme';
    let currentCategories = [];
    const els = {
      body: document.body,
      themeToggle: document.getElementById('themeToggle'),
      refreshBtn: document.getElementById('refreshBtn'),
      healthBadge: document.getElementById('healthBadge'),
      versionChip: document.getElementById('versionChip'),
      strategyChip: document.getElementById('strategyChip'),
      routingCardChip: document.getElementById('routingCardChip'),
      heroStatus: document.getElementById('heroStatus'),
      heroSummary: document.getElementById('heroSummary'),
      heroBadges: document.getElementById('heroBadges'),
      healthValue: document.getElementById('healthValue'),
      versionValue: document.getElementById('versionValue'),
      providersCountValue: document.getElementById('providersCountValue'),
      categoriesCountValue: document.getElementById('categoriesCountValue'),
      providerSummaryBadge: document.getElementById('providerSummaryBadge'),
      providerWrapBadge: document.getElementById('providerWrapBadge'),
      providersList: document.getElementById('providersList'),
      unmappedProviders: document.getElementById('unmappedProviders'),
      providerError: document.getElementById('providerError'),
      configRows: document.getElementById('configRows'),
      freshnessBadge: document.getElementById('freshnessBadge'),
      freshnessSummary: document.getElementById('freshnessSummary'),
      oldestExport: document.getElementById('oldestExport'),
      newestExport: document.getElementById('newestExport'),
      benchmarkDirBadge: document.getElementById('benchmarkDirBadge'),
      benchmarkFile: document.getElementById('benchmarkFile'),
      chooseBenchmarkBtn: document.getElementById('chooseBenchmarkBtn'),
      importBenchmarkBtn: document.getElementById('importBenchmarkBtn'),
      importFileMeta: document.getElementById('importFileMeta'),
      importHelpText: document.getElementById('importHelpText'),
      importStatus: document.getElementById('importStatus'),
      categoriesBadge: document.getElementById('categoriesBadge'),
      categoriesSubtitle: document.getElementById('categoriesSubtitle'),
      categoriesTable: document.getElementById('categoriesTable'),
      categoriesEmpty: document.getElementById('categoriesEmpty'),
      descriptionModal: document.getElementById('descriptionModal'),
      closeDescriptionModal: document.getElementById('closeDescriptionModal'),
      descriptionModalTitle: document.getElementById('descriptionModalTitle'),
      descriptionModalSubtitle: document.getElementById('descriptionModalSubtitle'),
      descriptionModalBody: document.getElementById('descriptionModalBody'),
      routingStrategy: document.getElementById('routingStrategy'),
      showRoutingCard: document.getElementById('showRoutingCard'),
      saveStatus: document.getElementById('saveStatus'),
      settingsForm: document.getElementById('settingsForm')
    };

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function createChip(text, kind) {
      return '<span class="chip' + (kind ? ' ' + kind : '') + '">' + escapeHtml(text) + '</span>';
    }

    function renderChipList(target, values, emptyText, kind) {
      const items = Array.isArray(values) ? values.filter(Boolean) : [];
      if (!items.length) {
        target.innerHTML = createChip(emptyText, kind || '');
        return;
      }
      target.innerHTML = items.map(function(value) {
        return createChip(value, kind || '');
      }).join('');
    }

    function setStatus(message, kind) {
      els.saveStatus.textContent = message || '';
      els.saveStatus.className = 'status' + (kind ? ' ' + kind : '');
    }

    function setImportStatus(message, kind) {
      els.importStatus.textContent = message || '';
      els.importStatus.className = 'status' + (kind ? ' ' + kind : '');
    }

    function resolveInitialTheme() {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }

    function applyTheme(theme) {
      els.body.setAttribute('data-theme', theme);
      els.themeToggle.textContent = theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
      localStorage.setItem(STORAGE_KEY, theme);
    }

    function toggleTheme() {
      const current = els.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    function renderConfigRows(config) {
      const rows = [
        ['classifier_model', config.classifier_model || '(user default)'],
        ['no_route_passthrough', config.no_route_passthrough || '(user default)'],
        ['routing_strategy', config.routing_strategy || '-'],
        ['show_routing_card', String(Boolean(config.show_routing_card))],
        ['restore_delay_s', String(config.restore_delay_s ?? '-')],
        ['gateway_port', String(config.gateway_port ?? '-')],
        ['benchmarks_dir', config.benchmarks_dir || 'benchmarks']
      ];
      els.configRows.innerHTML = rows.map(function(entry) {
        return '<div class="row"><div class="key mono">' +
          escapeHtml(entry[0]) +
          '</div><div class="value">' +
          escapeHtml(entry[1]) +
          '</div></div>';
      }).join('');
    }

    function renderCategories(categories) {
      const rows = Array.isArray(categories) ? categories : [];
      currentCategories = rows;
      els.categoriesSubtitle.textContent = rows.length
        ? 'Loaded benchmark categories from the local benchmarks directory.'
        : 'No benchmark categories detected yet.';
      els.categoriesBadge.textContent = rows.length + (rows.length === 1 ? ' category' : ' categories');
      els.categoriesEmpty.hidden = rows.length > 0;
      els.categoriesTable.innerHTML = rows.map(function(cat) {
        return '<tr>' +
          '<td class="mono">' + escapeHtml(cat.name || '-') + '</td>' +
          '<td>' + escapeHtml(cat.display_name || '-') + '</td>' +
          '<td>' + escapeHtml(String(cat.models ?? '-')) + '</td>' +
          '<td class="mono">' + escapeHtml(cat.export_date || '-') + '</td>' +
          '<td class="table-action"><button type="button" class="btn-linkish" data-category="' + escapeHtml(cat.name || '') + '">Description</button></td>' +
        '</tr>';
      }).join('');
    }

    function openDescriptionModal(categoryName) {
      const match = currentCategories.find(function(item) {
        return item && item.name === categoryName;
      });
      if (!match) {
        return;
      }
      els.descriptionModalTitle.textContent = match.display_name || match.name || 'Category description';
      els.descriptionModalSubtitle.textContent = match.name || '-';
      els.descriptionModalBody.textContent = match.description || 'No description was included in this benchmark export.';
      els.descriptionModal.classList.add('open');
    }

    function closeDescriptionModal() {
      els.descriptionModal.classList.remove('open');
    }

    function updateHero(state) {
      const providers = state.providers && Array.isArray(state.providers.providers)
        ? state.providers.providers.length
        : 0;
      const categories = state.categories && Array.isArray(state.categories.items)
        ? state.categories.items.length
        : 0;
      const freshness = state.categories && state.categories.freshness_summary
        ? state.categories.freshness_summary
        : 'unknown';
      els.heroStatus.textContent = state.health && state.health.status
        ? String(state.health.status).toUpperCase()
        : 'UNKNOWN';
      els.heroSummary.textContent = providers + ' provider' + (providers === 1 ? '' : 's') +
        ', ' + categories + ' benchmark categor' + (categories === 1 ? 'y' : 'ies') +
        ', freshness: ' + freshness + '.';
      els.heroBadges.innerHTML = [
        createChip('Providers: ' + providers, providers ? 'good' : 'warn'),
        createChip('Categories: ' + categories, categories ? 'good' : 'warn'),
        createChip('Freshness: ' + freshness, freshness.toLowerCase().indexOf('stale') >= 0 ? 'warn' : 'good')
      ].join('');
    }

    async function loadState() {
      setStatus('', '');
      const response = await fetch('/dashboard/api/state');
      if (!response.ok) {
        throw new Error('Dashboard state request failed');
      }

      const state = await response.json();
      const providerCount = state.providers && Array.isArray(state.providers.providers)
        ? state.providers.providers.length
        : 0;
      const categories = state.categories && Array.isArray(state.categories.items)
        ? state.categories.items
        : [];
      const routingStrategy = state.config && state.config.routing_strategy
        ? state.config.routing_strategy
        : 'balanced';
      const showRoutingCard = Boolean(state.config && state.config.show_routing_card);
      const freshnessSummary = state.categories && state.categories.freshness_summary
        ? state.categories.freshness_summary
        : '-';
      const healthStatus = state.health && state.health.status ? state.health.status : 'unknown';

      els.healthValue.textContent = healthStatus;
      els.versionValue.textContent = state.version || '-';
      els.providersCountValue.textContent = String(providerCount);
      els.categoriesCountValue.textContent = String(categories.length);
      els.healthBadge.textContent = 'Health: ' + healthStatus;
      els.versionChip.textContent = 'Version ' + (state.version || '-');
      els.strategyChip.textContent = 'Strategy ' + routingStrategy;
      els.routingCardChip.textContent = showRoutingCard ? 'Routing card on' : 'Routing card off';
      els.providerSummaryBadge.textContent = providerCount + ' detected';
      els.freshnessBadge.textContent = freshnessSummary;
      els.freshnessSummary.textContent = freshnessSummary;
      els.oldestExport.textContent = state.categories && state.categories.oldest_export_date || '-';
      els.newestExport.textContent = state.categories && state.categories.newest_export_date || '-';
      els.providerError.textContent = state.providers && state.providers.error ? state.providers.error : '-';
      els.providerWrapBadge.textContent = providerCount > 6 ? 'Wrapped chips' : 'Compact list';
      els.benchmarkDirBadge.textContent = state.import && state.import.benchmarks_dir
        ? state.import.benchmarks_dir
        : 'benchmarks';
      els.importHelpText.innerHTML = 'Grab benchmarks from <a href="' +
        escapeHtml(state.import && state.import.openmark_url || 'https://openmark.ai') +
        '" target="_blank" rel="noreferrer">OpenMark.ai</a> and use ' +
        escapeHtml(state.import && state.import.export_hint || 'OpenMark Results tab -> Export -> OpenClaw') + '.';

      renderChipList(els.providersList, state.providers && state.providers.providers, 'No mapped providers', providerCount ? 'good' : 'warn');
      renderChipList(els.unmappedProviders, state.providers && state.providers.unmapped, 'None', 'warn');
      renderConfigRows(state.config || {});
      renderCategories(categories);
      updateHero(state);

      els.routingStrategy.value = routingStrategy;
      els.showRoutingCard.checked = showRoutingCard;
    }

    async function importBenchmarkFile() {
      const file = els.benchmarkFile.files && els.benchmarkFile.files[0];
      if (!file) {
        setImportStatus('Choose a CSV file first.', 'warn');
        return;
      }
      setImportStatus('Importing benchmark CSV...', '');
      els.importBenchmarkBtn.disabled = true;
      const content = await file.text();
      const response = await fetch('/dashboard/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          content: content
        })
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'ok') {
        const errors = result.validation && Array.isArray(result.validation.errors) && result.validation.errors.length
          ? ' ' + result.validation.errors.join(' ')
          : '';
        setImportStatus((result.error || 'Failed to import benchmark CSV.') + errors, 'error');
        els.importBenchmarkBtn.disabled = false;
        return;
      }
      const warnings = result.validation && Array.isArray(result.validation.warnings) && result.validation.warnings.length
        ? ' Warnings: ' + result.validation.warnings.join(' ')
        : '';
      setImportStatus((result.message || 'Benchmark CSV imported.') + warnings, 'ok');
      els.importFileMeta.textContent = file.name + (result.replaced ? ' (replaced existing file)' : ' (imported)');
      els.importBenchmarkBtn.disabled = false;
      await loadState();
    }

    async function saveSettings(event) {
      event.preventDefault();
      setStatus('Saving...', '');
      const response = await fetch('/dashboard/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_strategy: els.routingStrategy.value,
          show_routing_card: els.showRoutingCard.checked
        })
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'ok') {
        setStatus(result.error || 'Failed to save dashboard settings.', 'error');
        return;
      }
      setStatus('Settings saved.', 'ok');
      await loadState();
    }

    document.querySelectorAll('.subnav-link').forEach(function(link) {
      link.addEventListener('click', function() {
        document.querySelectorAll('.subnav-link').forEach(function(item) {
          item.classList.remove('active');
        });
        link.classList.add('active');
      });
    });

    els.themeToggle.addEventListener('click', toggleTheme);
    els.chooseBenchmarkBtn.addEventListener('click', function() {
      els.benchmarkFile.click();
    });
    els.benchmarkFile.addEventListener('change', function() {
      const file = els.benchmarkFile.files && els.benchmarkFile.files[0];
      if (!file) {
        els.importFileMeta.textContent = 'No file selected.';
        els.importBenchmarkBtn.disabled = true;
        return;
      }
      els.importFileMeta.textContent = file.name + ' (' + Math.max(1, Math.round(file.size / 1024)) + ' KB)';
      els.importBenchmarkBtn.disabled = false;
      setImportStatus('', '');
    });
    els.importBenchmarkBtn.addEventListener('click', function() {
      importBenchmarkFile().catch(function(err) {
        setImportStatus(err.message || 'Failed to import benchmark CSV.', 'error');
        els.importBenchmarkBtn.disabled = false;
      });
    });
    els.categoriesTable.addEventListener('click', function(event) {
      const target = event.target;
      if (!target || !(target instanceof HTMLElement)) {
        return;
      }
      const categoryName = target.getAttribute('data-category');
      if (categoryName) {
        openDescriptionModal(categoryName);
      }
    });
    els.closeDescriptionModal.addEventListener('click', closeDescriptionModal);
    els.descriptionModal.addEventListener('click', function(event) {
      if (event.target === els.descriptionModal) {
        closeDescriptionModal();
      }
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && els.descriptionModal.classList.contains('open')) {
        closeDescriptionModal();
      }
    });
    els.refreshBtn.addEventListener('click', function() {
      loadState().catch(function(err) {
        setStatus(err.message || 'Failed to refresh dashboard.', 'error');
      });
    });
    els.settingsForm.addEventListener('submit', function(event) {
      saveSettings(event).catch(function(err) {
        setStatus(err.message || 'Failed to save dashboard settings.', 'error');
      });
    });

    applyTheme(resolveInitialTheme());
    loadState().catch(function(err) {
      setStatus(err.message || 'Failed to load dashboard state.', 'error');
    });
  </script>
</body>
</html>`;
}
