<script>
  import { onMount } from 'svelte';
  import { DataCard, PageHeader } from '$lib/components';
  import { formatNumber, formatUSD, formatUSDCompact } from '$lib/utils/formatting';
  import { fromBaseUnit, normalizeAsset } from '$lib/utils/blockchain';
  import {
    fetchLiveRapidSwaps,
    fetchRapidSwapsDashboard,
    getRapidSwapsApiConfigError
  } from './rapid-swaps/api.js';

  const REFRESH_INTERVAL_MS = 60000;

  let loading = true;
  let refreshing = false;
  let dashboard = null;
  let liveRapidSwaps = [];
  let dashboardError = '';
  let liveError = '';
  let refreshInterval;

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
    return `${formatAsset(row?.source_asset)} -> ${formatAsset(row?.target_asset)}`;
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

  function getTxUrl(txId) {
    return `https://thorchain.net/tx/${txId}`;
  }

  async function loadData(showLoading = true) {
    if (showLoading) {
      loading = true;
    } else {
      refreshing = true;
    }

    const [liveResult, dashboardResult] = await Promise.allSettled([
      fetchLiveRapidSwaps(),
      fetchRapidSwapsDashboard()
    ]);

    if (liveResult.status === 'fulfilled') {
      liveRapidSwaps = liveResult.value;
      liveError = '';
    } else {
      liveRapidSwaps = [];
      liveError = liveResult.reason?.message || 'Failed to load live rapid swaps';
    }

    if (dashboardResult.status === 'fulfilled') {
      dashboard = dashboardResult.value;
      dashboardError = '';
    } else {
      dashboard = null;
      dashboardError = dashboardResult.reason?.message || 'Failed to load recorded rapid swaps';
    }

    loading = false;
    refreshing = false;
  }

  onMount(() => {
    loadData(true);
    refreshInterval = setInterval(() => {
      loadData(false);
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(refreshInterval);
  });
</script>

<div class="rapid-swaps-page">
  <PageHeader
    title="Rapid Swaps"
    subtitle="Live rapid streams plus recorded top-20 and rolling 24-hour activity."
  >
    <div slot="actions" class="header-actions">
      {#if refreshing}
        <span class="refreshing">Refreshing...</span>
      {:else if backendMeta?.last_run_at}
        <span class="refreshing">Recorder {formatRelative(backendMeta.last_run_at)}</span>
      {/if}
    </div>
  </PageHeader>

  <div class="metrics-grid">
    <DataCard title="Live Active" height="130px">
      <div class="metric-value">{formatNumber(liveRapidSwaps.length, { maximumFractionDigits: 0 })}</div>
      <div class="metric-label">interval = 0 streams right now</div>
    </DataCard>

    <DataCard title="Recorded 24h" height="130px">
      <div class="metric-value">{formatNumber(dashboard?.recent_24h_count || 0, { maximumFractionDigits: 0 })}</div>
      <div class="metric-label">rapid swaps captured in the last 24 hours</div>
    </DataCard>

    <DataCard title="24h Volume" height="130px">
      <div class="metric-value">{formatUSDCompact(dashboard?.recent_24h_volume_usd || 0)}</div>
      <div class="metric-label">estimated source-side USD volume</div>
    </DataCard>

    <DataCard title="Largest Recorded" height="130px">
      <div class="metric-value">{formatUSDCompact(topSwaps[0]?.input_estimated_usd || 0)}</div>
      <div class="metric-label">{topSwaps[0] ? formatPair(topSwaps[0]) : 'Waiting for first recorded rapid swap'}</div>
    </DataCard>
  </div>

  <div class="tracker-banner" class:warning={Boolean(dashboardError)}>
    {#if dashboard}
      <strong>Recorder status:</strong>
      {backendMeta?.last_run_status || 'unknown'} | {formatFreshness(backendMeta?.freshness_seconds)}
      {#if trackerStart}
        | tracking since {formatDateTime(trackerStart)}
      {/if}
      {#if !dashboard?.tracker_warmup_complete}
        | 24h history is still warming up
      {/if}
    {:else if dashboardError}
      <strong>Recorder unavailable:</strong> {dashboardError}
    {/if}
  </div>

  {#if backendConfigError}
    <div class="notice-card">
      <strong>Backend note:</strong> the live section works without extra config, but recorded rapid swaps need the Supabase endpoint configured. Reuse `VITE_NODEOP_API_BASE` and `VITE_NODEOP_API_KEY`, or set the rapid-swaps-specific env vars.
    </div>
  {/if}

  <section class="panel">
    <div class="panel-header">
      <div>
        <h3>Live Active Rapid Swaps</h3>
        <p>Current streaming swaps where `interval = 0`.</p>
      </div>
    </div>

    {#if loading}
      <div class="empty-state">Loading live rapid swaps...</div>
    {:else if liveError}
      <div class="empty-state error">{liveError}</div>
    {:else if liveRapidSwaps.length === 0}
      <div class="empty-state">No active rapid swaps at the moment.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Input</th>
              <th>Est. USD</th>
              <th>Progress</th>
              <th>Last Height</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {#each liveRapidSwaps as row}
              <tr>
                <td>{formatPair(row)}</td>
                <td>{formatAmount(row.input_amount_base)} {formatAsset(row.source_asset)}</td>
                <td>{formatUSD(row.input_estimated_usd || 0)}</td>
                <td>{row.streaming_count}/{row.streaming_quantity}</td>
                <td>{formatNumber(row.last_height || 0, { maximumFractionDigits: 0 })}</td>
                <td><a href={getTxUrl(row.tx_id)} target="_blank" rel="noreferrer">{row.tx_id.slice(0, 10)}...</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="panel">
    <div class="panel-header">
      <div>
        <h3>Top 20 Largest Recorded Rapid Swaps</h3>
        <p>Ranked by estimated source-side USD size from the recorder dataset.</p>
      </div>
    </div>

    {#if loading && !dashboard}
      <div class="empty-state">Loading recorded rapid swaps...</div>
    {:else if dashboardError}
      <div class="empty-state error">{dashboardError}</div>
    {:else if topSwaps.length === 0}
      <div class="empty-state">No rapid swaps have been recorded yet. The tracker starts filling after the scheduler runs.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Pair</th>
              <th>Input</th>
              <th>Est. USD</th>
              <th>Subs</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {#each topSwaps as row, index}
              <tr>
                <td>{index + 1}</td>
                <td>{formatDateTime(row.action_date)}</td>
                <td>{formatPair(row)}</td>
                <td>{formatAmount(row.input_amount_base)} {formatAsset(row.source_asset)}</td>
                <td>{formatUSD(row.input_estimated_usd || 0)}</td>
                <td>{row.streaming_count}/{row.streaming_quantity}</td>
                <td><a href={getTxUrl(row.tx_id)} target="_blank" rel="noreferrer">{row.tx_id.slice(0, 10)}...</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="panel">
    <div class="panel-header">
      <div>
        <h3>Recorded Rapid Swaps in the Past 24 Hours</h3>
        <p>Newest first. This window becomes complete after the recorder has been running for 24 hours.</p>
      </div>
    </div>

    {#if loading && !dashboard}
      <div class="empty-state">Loading the 24-hour feed...</div>
    {:else if dashboardError}
      <div class="empty-state error">{dashboardError}</div>
    {:else if recentSwaps.length === 0}
      <div class="empty-state">No rapid swaps have been recorded in the rolling 24-hour window yet.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Pair</th>
              <th>Input</th>
              <th>Est. USD</th>
              <th>Interval</th>
              <th>Subs</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {#each recentSwaps as row}
              <tr>
                <td>{formatDateTime(row.action_date)}</td>
                <td>{formatPair(row)}</td>
                <td>{formatAmount(row.input_amount_base)} {formatAsset(row.source_asset)}</td>
                <td>{formatUSD(row.input_estimated_usd || 0)}</td>
                <td>{row.streaming_interval}</td>
                <td>{row.streaming_count}/{row.streaming_quantity}</td>
                <td><a href={getTxUrl(row.tx_id)} target="_blank" rel="noreferrer">{row.tx_id.slice(0, 10)}...</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  @import '$lib/styles/variables.css';

  .rapid-swaps-page {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .header-actions {
    color: rgba(255, 255, 255, 0.9);
    font-size: 13px;
    font-weight: 600;
  }

  .refreshing {
    white-space: nowrap;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .metric-value {
    font-size: 28px;
    font-weight: 800;
    color: var(--text-primary);
    margin-bottom: 8px;
    letter-spacing: -0.03em;
  }

  .metric-label {
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.4;
  }

  .tracker-banner,
  .notice-card,
  .panel {
    background: var(--gradient-card);
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-card);
    border-radius: var(--radius-lg);
  }

  .tracker-banner,
  .notice-card {
    padding: 14px 16px;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.5;
  }

  .tracker-banner.warning {
    border-color: rgba(255, 111, 97, 0.45);
  }

  .notice-card {
    border-color: rgba(102, 126, 234, 0.45);
  }

  .panel {
    overflow: hidden;
  }

  .panel-header {
    padding: 18px 20px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 18px;
    color: var(--text-primary);
  }

  .panel-header p {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 760px;
  }

  th,
  td {
    text-align: left;
    padding: 14px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 14px;
    vertical-align: middle;
  }

  th {
    color: var(--text-muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  td {
    color: var(--text-secondary);
  }

  tbody tr:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  a {
    color: #8fb8ff;
    text-decoration: none;
    font-weight: 600;
  }

  a:hover {
    text-decoration: underline;
  }

  .empty-state {
    padding: 24px 20px;
    color: var(--text-muted);
    font-size: 14px;
  }

  .empty-state.error {
    color: #ff8b8b;
  }

  @media (max-width: 1100px) {
    .metrics-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .metrics-grid {
      grid-template-columns: 1fr;
    }

    .panel-header,
    th,
    td {
      padding-left: 14px;
      padding-right: 14px;
    }

    .metric-value {
      font-size: 24px;
    }
  }
</style>
