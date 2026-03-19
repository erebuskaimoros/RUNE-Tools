import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  requireMethod
} from '../_shared/validation.ts';

function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

const RAPID_SWAP_COLUMNS = [
  'tx_id',
  'action_date',
  'observed_at',
  'memo',
  'tx_status',
  'source_asset',
  'target_asset',
  'input_amount_base',
  'output_amount_base',
  'input_estimated_usd',
  'output_estimated_usd',
  'liquidity_fee_base',
  'swap_slip_bps',
  'is_limit_order',
  'streaming_interval',
  'streaming_quantity',
  'streaming_count',
  'affiliate',
  'source_address',
  'destination_address'
].join(',');

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const methodError = requireMethod(request, 'GET');
  if (methodError) {
    return errorResponse(methodError, 405);
  }

  try {
    const supabase = createAdminClient();
    const recentWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [recentResult, topResult, startResult, lastRunResult, countResult] = await Promise.all([
      supabase
        .from('rapid_swaps')
        .select(RAPID_SWAP_COLUMNS)
        .gte('action_date', recentWindowStart)
        .order('action_date', { ascending: false })
        .limit(500),
      supabase
        .from('rapid_swaps')
        .select(RAPID_SWAP_COLUMNS)
        .order('input_estimated_usd', { ascending: false })
        .order('action_date', { ascending: false })
        .limit(20),
      supabase
        .from('rapid_swaps')
        .select('observed_at')
        .order('observed_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('rapid_swap_job_runs')
        .select('finished_at,status,stats_json')
        .eq('job_name', 'rapid-swaps-recent-actions')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('rapid_swaps')
        .select('tx_id', { count: 'exact', head: true })
    ]);

    for (const result of [recentResult, topResult, startResult, lastRunResult, countResult]) {
      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    const trackerStartedAt = startResult.data?.observed_at || null;
    const recentRows = recentResult.data || [];
    const topRows = topResult.data || [];
    const lastRunAt = lastRunResult.data?.finished_at || null;
    const freshnessSeconds = lastRunAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(lastRunAt)) / 1000))
      : -1;

    return jsonResponse(
      {
        as_of: new Date().toISOString(),
        tracker_started_at: trackerStartedAt,
        tracker_warmup_complete: trackerStartedAt
          ? (Date.now() - Date.parse(trackerStartedAt)) >= 24 * 60 * 60 * 1000
          : false,
        recent_window_started_at: recentWindowStart,
        total_tracked: countResult.count || 0,
        recent_24h_count: recentRows.length,
        recent_24h_volume_usd: recentRows.reduce((sum, row: any) => sum + (Number(row.input_estimated_usd) || 0), 0),
        top_20: topRows,
        recent_24h: recentRows,
        backend: {
          last_run_at: lastRunAt,
          last_run_status: lastRunResult.data?.status || 'unknown',
          freshness_seconds: freshnessSeconds,
          last_run_stats: lastRunResult.data?.stats_json || {}
        }
      },
      200,
      {
        'Cache-Control': 'public, max-age=30'
      }
    );
  } catch (error) {
    console.error('rapid-swaps failed:', error);
    return errorResponse((error as Error).message || 'Failed to load rapid swaps', 500);
  }
});
