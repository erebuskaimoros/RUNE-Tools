<script>
  import { onMount } from 'svelte';
  import { formatNumber, formatUSD, formatUSDCompact } from '$lib/utils/formatting';
  import { fromBaseUnit, normalizeAsset } from '$lib/utils/blockchain';
  import {
    fetchRapidSwapsDashboard,
    getRapidSwapsApiConfigError
  } from './rapid-swaps/api.js';

  const REFRESH_INTERVAL_MS = 120000;
  const RPC_WS_URL = 'wss://rpc.thorchain.network/websocket';
  const RECONNECT_BASE_MS = 2000;
  const RECONNECT_MAX_MS = 30000;
  const REFRESH_DEBOUNCE_MS = 8000; // Wait for server-side listener to process + Midgard

  let loading = true;
  let refreshing = false;
  let dashboard = null;
  let dashboardError = '';
  let refreshInterval;
  let rpcWs = null;
  let rpcReconnectAttempt = 0;
  let rpcConnected = false;
  let rpcLastBlock = 0;
  let pendingRefreshTimer = null;

  $: topSwaps = dashboard?.top_20 || [];
  $: recentSwaps = dashboard?.recent_24h || [];
  $: trackerStart = dashboard?.tracker_started_at || null;
  $: backendMeta = dashboard?.backend || null;
  $: backendConfigError = getRapidSwapsApiConfigError();

  function formatAsset(asset) {
    if (!asset) return '-';
    return normalizeAsset(asset);
  }

  function formatPair(row) {
    return `${formatAsset(row?.source_asset)} → ${formatAsset(row?.target_asset)}`;
  }

  function formatAmount(amountBase, maxFractionDigits = 4) {
    return formatNumber(fromBaseUnit(amountBase || 0), {
      maximumFractionDigits: maxFractionDigits
    });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '-';

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function formatRelative(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '-';

    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  function formatTimeSaved(seconds) {
    const s = Number(seconds) || 0;
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function formatFreshness(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return 'No runs yet';
    }

    if (numeric < 60) {
      return `${numeric}s old`;
    }

    if (numeric < 3600) {
      return `${Math.floor(numeric / 60)}m old`;
    }

    return `${Math.floor(numeric / 3600)}h old`;
  }

  function swapPctFaster(row) {
    const subs = Number(row?.streaming_count) || 0;
    const blocks = Number(row?.blocks_used) || 0;
    if (subs <= 0 || blocks <= 0) return 0;
    return Math.round((1 - blocks / subs) * 100);
  }

  function swapTimeSaved(row) {
    const subs = Number(row?.streaming_count) || 0;
    const blocks = Number(row?.blocks_used) || 0;
    return Math.max(0, subs - blocks) * 6;
  }

  function getTxUrl(txId) {
    return `https://thorchain.net/tx/${txId}`;
  }

  async function loadData(showLoading = true) {
    if (showLoading) {
      loading = true;
    } else {
      refreshing = true;
    }

    try {
      dashboard = await fetchRapidSwapsDashboard();
      dashboardError = '';
    } catch (err) {
      dashboard = null;
      dashboardError = err?.message || 'Failed to load recorded rapid swaps';
    }

    loading = false;
    refreshing = false;
  }

  function tryDecodeAttr(val) {
    if (!val) return '';
    try {
      if (/^[A-Za-z0-9+/]+=*$/.test(val) && val.length > 1) {
        const decoded = atob(val);
        if (/^[\x20-\x7E]*$/.test(decoded) && decoded.length > 0) return decoded;
      }
    } catch (_) {}
    return val;
  }

  function checkBlockForRapidSwaps(msg) {
    try {
      const data = msg.result?.data?.value;
      if (!data) return;

      const blockHeight = Number(data.block?.header?.height) || 0;
      if (blockHeight > 0) rpcLastBlock = blockHeight;

      const events = data.result_finalize_block?.events || data.result_end_block?.events || [];

      for (const event of events) {
        if (event.type !== 'streaming_swap') continue;

        const attrs = {};
        for (const attr of event.attributes || []) {
          attrs[tryDecodeAttr(attr.key)] = tryDecodeAttr(attr.value);
        }

        const interval = Number(attrs.interval);
        const quantity = Number(attrs.quantity);
        const count = Number(attrs.count);

        if (interval === 0 && quantity > 1 && count > 0) {
          // Rapid swap detected — debounce a refresh to let the server-side
          // listener process it and write to Supabase first
          scheduleRefresh();
          return;
        }
      }
    } catch (_) {}
  }

  function scheduleRefresh() {
    // Debounce: if multiple rapid swaps in quick succession, only refresh once
    clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = setTimeout(() => {
      loadData(false);
    }, REFRESH_DEBOUNCE_MS);
  }

  function connectRpcWs() {
    try {
      rpcWs = new WebSocket(RPC_WS_URL);

      rpcWs.onopen = () => {
        rpcConnected = true;
        rpcReconnectAttempt = 0;
        rpcWs.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 1,
          params: { query: "tm.event='NewBlock'" }
        }));
      };

      rpcWs.onmessage = (e) => {
        try {
          checkBlockForRapidSwaps(JSON.parse(e.data));
        } catch (_) {}
      };

      rpcWs.onclose = () => {
        rpcConnected = false;
        reconnectRpcWs();
      };

      rpcWs.onerror = () => {
        rpcConnected = false;
      };
    } catch (_) {
      rpcConnected = false;
      reconnectRpcWs();
    }
  }

  function reconnectRpcWs() {
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, rpcReconnectAttempt), RECONNECT_MAX_MS);
    rpcReconnectAttempt++;
    setTimeout(connectRpcWs, delay);
  }

  function disconnectRpcWs() {
    if (rpcWs) {
      rpcWs.onclose = null; // Prevent reconnect
      rpcWs.close();
      rpcWs = null;
    }
    rpcConnected = false;
  }

  onMount(() => {
    loadData(true);
    connectRpcWs();
    refreshInterval = setInterval(() => {
      loadData(false);
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(refreshInterval);
      clearTimeout(pendingRefreshTimer);
      disconnectRpcWs();
    };
  });
</script>

<div class="rs">
  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-left">
      {#if dashboard}
        <span class="status-dot" class:ok={backendMeta?.last_run_status === 'success'} class:err={backendMeta?.last_run_status !== 'success'}></span>
        RECORDER {backendMeta?.last_run_status === 'success' ? 'OK' : 'ERR'}
        <span class="sep">|</span>
        {formatFreshness(backendMeta?.freshness_seconds)}
        {#if trackerStart}
          <span class="sep">|</span>
          since {formatDateTime(trackerStart)}
        {/if}
        {#if !dashboard?.tracker_warmup_complete}
          <span class="sep">|</span>
          <span class="warn-text">warming up</span>
        {/if}
      {:else if dashboardError}
        <span class="status-dot err"></span>
        RECORDER OFFLINE
      {:else}
        <span class="status-dot"></span>
        CONNECTING...
      {/if}
    </span>
    <span class="status-right">
      <span class="ws-badge" class:ws-ok={rpcConnected} class:ws-down={!rpcConnected}>
        <span class="ws-dot"></span>
        {rpcConnected ? 'LIVE' : 'CONNECTING'}
        {#if rpcConnected && rpcLastBlock}
          <span class="sep">|</span>
          BLK {rpcLastBlock.toLocaleString()}
        {/if}
      </span>
      {#if refreshing}
        <span class="sep">|</span> REFRESHING...
      {/if}
    </span>
  </div>

  <!-- Metrics strip -->
  <div class="metrics">
    <div class="metric">
      <div class="metric-val">{formatNumber(dashboard?.recent_24h_count || 0, { maximumFractionDigits: 0 })}</div>
      <div class="metric-key">24H COUNT</div>
    </div>
    <div class="metric">
      <div class="metric-val">{formatUSDCompact(dashboard?.recent_24h_volume_usd || 0)}</div>
      <div class="metric-key">24H VOLUME</div>
    </div>
    <div class="metric">
      <div class="metric-val accent">{formatUSDCompact(dashboard?.cumulative_volume_usd || 0)}</div>
      <div class="metric-key">ALL-TIME VOLUME</div>
    </div>
    <div class="metric">
      <div class="metric-val">{topSwaps[0] ? formatUSDCompact(topSwaps[0]?.input_estimated_usd || 0) : '--'}</div>
      <div class="metric-key">LARGEST SWAP</div>
    </div>
    <div class="metric">
      <div class="metric-val amber">{formatTimeSaved(dashboard?.time_saved_seconds || 0)}</div>
      <div class="metric-key">TIME SAVED</div>
      <div class="metric-sub">{formatTimeSaved(dashboard?.baseline_seconds || 0)} at interval=1</div>
    </div>
    <div class="metric">
      <div class="metric-val amber">{dashboard?.pct_faster || 0}%</div>
      <div class="metric-key">FASTER</div>
      <div class="metric-sub">{formatTimeSaved(dashboard?.actual_seconds || 0)} actual vs {formatTimeSaved(dashboard?.baseline_seconds || 0)}</div>
    </div>
  </div>

  <!-- Top 20 table -->
  <section class="data-section">
    <div class="section-head">
      <h3>TOP RECORDED</h3>
      <span class="section-sub">Ranked by estimated USD size</span>
    </div>

    {#if loading && !dashboard}
      <div class="empty">Loading...</div>
    {:else if dashboardError}
      <div class="empty err-text">{dashboardError}</div>
    {:else if topSwaps.length === 0}
      <div class="empty">No rapid swaps recorded yet.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-rank">#</th>
              <th class="col-when">WHEN</th>
              <th class="col-pair">PAIR</th>
              <th class="col-input">INPUT</th>
              <th class="col-usd right">USD</th>
              <th class="col-subs right">SUBS</th>
              <th class="col-blocks right">BLOCKS</th>
              <th class="col-saved right">SAVED</th>
              <th class="col-tx">TX</th>
            </tr>
          </thead>
          <tbody>
            {#each topSwaps as row, index}
              {@const pct = swapPctFaster(row)}
              {@const saved = swapTimeSaved(row)}
              <tr>
                <td class="col-rank mono dim">{index + 1}</td>
                <td class="col-when mono">{formatDateTime(row.action_date)}</td>
                <td class="col-pair">{formatPair(row)}</td>
                <td class="col-input mono">{formatAmount(row.input_amount_base)} <span class="dim">{formatAsset(row.source_asset)}</span></td>
                <td class="col-usd mono right accent">{formatUSD(row.input_estimated_usd || 0)}</td>
                <td class="col-subs mono right">{row.streaming_count}/{row.streaming_quantity}</td>
                <td class="col-blocks mono right">{row.blocks_used || '-'}</td>
                <td class="col-saved mono right">{#if saved > 0}<span class="amber">{formatTimeSaved(saved)} ({pct}%)</span>{:else}<span class="dim">--</span>{/if}</td>
                <td class="col-tx"><a href={getTxUrl(row.tx_id)} target="_blank" rel="noreferrer">{row.tx_id.slice(0, 8)}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- 24h feed -->
  <section class="data-section">
    <div class="section-head">
      <h3>LAST 24 HOURS</h3>
      <span class="section-sub">Newest first</span>
    </div>

    {#if loading && !dashboard}
      <div class="empty">Loading...</div>
    {:else if dashboardError}
      <div class="empty err-text">{dashboardError}</div>
    {:else if recentSwaps.length === 0}
      <div class="empty">No rapid swaps in the rolling 24h window.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-when">WHEN</th>
              <th class="col-pair">PAIR</th>
              <th class="col-input">INPUT</th>
              <th class="col-usd right">USD</th>
              <th class="col-subs right">SUBS</th>
              <th class="col-blocks right">BLOCKS</th>
              <th class="col-saved right">SAVED</th>
              <th class="col-tx">TX</th>
            </tr>
          </thead>
          <tbody>
            {#each recentSwaps as row}
              {@const pct = swapPctFaster(row)}
              {@const saved = swapTimeSaved(row)}
              <tr>
                <td class="col-when mono">{formatDateTime(row.action_date)}</td>
                <td class="col-pair">{formatPair(row)}</td>
                <td class="col-input mono">{formatAmount(row.input_amount_base)} <span class="dim">{formatAsset(row.source_asset)}</span></td>
                <td class="col-usd mono right accent">{formatUSD(row.input_estimated_usd || 0)}</td>
                <td class="col-subs mono right">{row.streaming_count}/{row.streaming_quantity}</td>
                <td class="col-blocks mono right">{row.blocks_used || '-'}</td>
                <td class="col-saved mono right">{#if saved > 0}<span class="amber">{formatTimeSaved(saved)} ({pct}%)</span>{:else}<span class="dim">--</span>{/if}</td>
                <td class="col-tx"><a href={getTxUrl(row.tx_id)} target="_blank" rel="noreferrer">{row.tx_id.slice(0, 8)}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');

  .rs {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0;
    font-family: 'DM Sans', -apple-system, sans-serif;
    color: #c8c8c8;
  }

  /* ---- STATUS BAR ---- */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: #666;
    border-bottom: 1px solid #1a1a1a;
    background: #0a0a0a;
  }

  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #333;
    margin-right: 6px;
    vertical-align: middle;
  }

  .status-dot.ok {
    background: #00cc66;
    box-shadow: 0 0 6px #00cc6644;
  }

  .status-dot.err {
    background: #cc3333;
    box-shadow: 0 0 6px #cc333344;
  }

  .sep {
    color: #333;
    margin: 0 6px;
  }

  .warn-text {
    color: #b8860b;
  }

  .status-right {
    color: #555;
    display: flex;
    align-items: center;
    gap: 0;
  }

  .ws-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .ws-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #333;
  }

  .ws-ok .ws-dot {
    background: #00cc66;
    box-shadow: 0 0 4px #00cc6644;
    animation: pulse-dot 2s infinite;
  }

  .ws-ok {
    color: #00cc66;
  }

  .ws-down .ws-dot {
    background: #cc3333;
  }

  .ws-down {
    color: #cc3333;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ---- METRICS ---- */
  .metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    border-bottom: 1px solid #1a1a1a;
    background: #0d0d0d;
  }

  .metric {
    padding: 20px 16px;
    border-right: 1px solid #1a1a1a;
    text-align: center;
  }

  .metric:last-child {
    border-right: none;
  }

  .metric-val {
    font-family: 'JetBrains Mono', monospace;
    font-size: 26px;
    font-weight: 700;
    color: #e0e0e0;
    letter-spacing: -0.02em;
    line-height: 1;
    margin-bottom: 8px;
  }

  .metric-val.accent {
    color: #00cc66;
  }

  .metric-val.amber {
    color: #d4a017;
  }

  .metric-key {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: #555;
    text-transform: uppercase;
  }

  .metric-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: #444;
    margin-top: 4px;
  }

  /* ---- DATA SECTIONS ---- */
  .data-section {
    border-bottom: 1px solid #1a1a1a;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 14px 16px 10px;
    background: #0a0a0a;
    border-bottom: 1px solid #141414;
  }

  .section-head h3 {
    margin: 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #888;
  }

  .section-sub {
    font-size: 11px;
    color: #444;
  }

  /* ---- TABLES ---- */
  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 700px;
  }

  th {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #444;
    text-align: left;
    padding: 8px 16px;
    border-bottom: 1px solid #1a1a1a;
    background: #0a0a0a;
    position: sticky;
    top: 0;
  }

  th.right {
    text-align: right;
  }

  td {
    padding: 10px 16px;
    font-size: 13px;
    border-bottom: 1px solid #111;
    color: #aaa;
    vertical-align: middle;
  }

  .mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }

  .dim {
    color: #555;
  }

  .right {
    text-align: right;
  }

  .accent {
    color: #00cc66;
  }

  tbody tr {
    background: #0d0d0d;
    transition: background 0.1s;
  }

  tbody tr:hover {
    background: #141414;
  }

  a {
    color: #5588cc;
    text-decoration: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }

  a:hover {
    color: #77aaee;
    text-decoration: underline;
  }

  /* ---- EMPTY / ERROR ---- */
  .empty {
    padding: 24px 16px;
    color: #444;
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
  }

  .err-text {
    color: #cc4444;
  }

  /* ---- RESPONSIVE ---- */
  @media (max-width: 900px) {
    .metrics {
      grid-template-columns: repeat(3, 1fr);
    }

    .metric:nth-child(4),
    .metric:nth-child(5) {
      border-top: 1px solid #1a1a1a;
    }
  }

  @media (max-width: 600px) {
    .metrics {
      grid-template-columns: repeat(2, 1fr);
    }

    .metric {
      padding: 14px 12px;
    }

    .metric-val {
      font-size: 20px;
    }

    .status-bar {
      font-size: 10px;
      flex-wrap: wrap;
      gap: 4px;
    }

    th, td {
      padding: 8px 10px;
    }
  }
</style>
