import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchNodes } from '../_shared/thornode.ts';
import {
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  parseIntegerParam,
  requireMethod
} from '../_shared/validation.ts';

type MaterializedRow = {
  node_address: string;
  as_of: string;
  computed_windows: number;
  per_window: Array<number | null>;
};

type BoundarySnapshotRow = {
  node_address: string;
  slash_points: number;
};

type RankedRow = {
  rank: number;
  node_address: string;
  per_window: Array<number | null>;
  total: number;
  avg_per_churn: number;
  participation: number;
};

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

function normalizePerWindow(row: MaterializedRow, windows: number): Array<number | null> {
  const input = Array.isArray(row.per_window) ? row.per_window : [];
  const output = Array(windows).fill(null) as Array<number | null>;

  for (let i = 0; i < windows; i += 1) {
    const value = input[i];
    if (value == null) {
      output[i] = null;
      continue;
    }

    const parsed = Number(value);
    output[i] = Number.isFinite(parsed) ? parsed : null;
  }

  return output;
}

function buildBoundarySlashMap(rows: BoundarySnapshotRow[]): Map<string, number> {
  const map = new Map<string, number>();

  for (const row of rows || []) {
    const address = String(row?.node_address || '');
    if (!address) continue;
    map.set(address, Number(row?.slash_points) || 0);
  }

  return map;
}

function buildCurrentDeltaByNode(
  currentNodes: any[],
  boundaryRows: BoundarySnapshotRow[]
): Map<string, number> {
  const boundarySlashMap = buildBoundarySlashMap(boundaryRows);
  const deltaMap = new Map<string, number>();

  for (const node of currentNodes || []) {
    const address = String(node?.node_address || '');
    if (!address) continue;

    const currentSlash = Number(node?.slash_points) || 0;
    const boundarySlash = boundarySlashMap.get(address) ?? 0;
    const delta = Math.max(0, currentSlash - boundarySlash);

    deltaMap.set(address, delta);
  }

  return deltaMap;
}

function buildWindowLabels(windows: number): string[] {
  return ['Current', ...Array.from({ length: windows }, (_, idx) => `C${idx + 1}`)];
}

function rankRows(rows: Array<Omit<RankedRow, 'rank'>>, minParticipation: number): RankedRow[] {
  return rows
    .filter((row) => row.participation >= minParticipation)
    .sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total;
      if (a.avg_per_churn !== b.avg_per_churn) return a.avg_per_churn - b.avg_per_churn;
      return a.node_address.localeCompare(b.node_address);
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1
    }));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const methodError = requireMethod(request, 'GET');
  if (methodError) {
    return errorResponse(methodError, 405);
  }

  try {
    const url = new URL(request.url);
    const windows = parseIntegerParam(url.searchParams.get('windows'), 10, { min: 1, max: 10 });
    const minParticipation = parseIntegerParam(url.searchParams.get('min_participation'), 3, {
      min: 1,
      max: windows + 1
    });

    const supabase = createAdminClient();
    const [materializedResult, latestChurnResult, currentNodes] = await Promise.all([
      supabase
        .from('nodeop_leaderboard_latest')
        .select('node_address,as_of,computed_windows,per_window')
        .order('rank', { ascending: true }),
      supabase
        .from('nodeop_churn_events')
        .select('height')
        .order('height', { ascending: false })
        .limit(1)
        .maybeSingle(),
      fetchNodes()
    ]);

    if (materializedResult.error) {
      throw new Error(materializedResult.error.message);
    }

    if (latestChurnResult.error) {
      throw new Error(latestChurnResult.error.message);
    }

    const latestChurnHeight = Number(latestChurnResult.data?.height) || 0;
    if (!latestChurnHeight) {
      throw new Error('No churn boundary available for current-window leaderboard.');
    }

    const { data: boundaryRowsRaw, error: boundaryError } = await supabase
      .from('nodeop_boundary_snapshots')
      .select('node_address,slash_points')
      .eq('height', latestChurnHeight);

    if (boundaryError) {
      throw new Error(boundaryError.message);
    }

    const boundaryRows = (boundaryRowsRaw || []) as BoundarySnapshotRow[];
    const currentDeltaByNode = buildCurrentDeltaByNode(currentNodes, boundaryRows);

    const materializedRows = (materializedResult.data || []) as MaterializedRow[];
    const asOf = materializedRows[0]?.as_of || new Date().toISOString();

    const rowMap = new Map<string, { node_address: string; per_window: Array<number | null> }>();

    for (const row of materializedRows) {
      const address = String(row.node_address || '');
      if (!address) continue;

      const historicalPerWindow = normalizePerWindow(row, windows);
      const currentDelta = currentDeltaByNode.has(address)
        ? currentDeltaByNode.get(address) ?? 0
        : null;

      rowMap.set(address, {
        node_address: address,
        per_window: [currentDelta, ...historicalPerWindow]
      });
    }

    for (const [address, currentDelta] of currentDeltaByNode.entries()) {
      if (rowMap.has(address)) {
        continue;
      }

      rowMap.set(address, {
        node_address: address,
        per_window: [currentDelta, ...Array(windows).fill(null)]
      });
    }

    const rowsToRank = Array.from(rowMap.values()).map((row) => {
      const participation = row.per_window.reduce((acc, value) => (value == null ? acc : acc + 1), 0);
      const total = row.per_window.reduce((acc, value) => (value == null ? acc : acc + value), 0);
      const avgPerChurn = participation > 0 ? total / participation : 0;

      return {
        node_address: row.node_address,
        per_window: row.per_window,
        total,
        avg_per_churn: avgPerChurn,
        participation
      };
    });

    const rows = rankRows(rowsToRank, minParticipation);

    const maxComputedWindows = materializedRows.reduce((acc, row) => {
      const parsed = Number(row.computed_windows) || 0;
      return Math.max(acc, parsed);
    }, 0);

    return jsonResponse(
      {
        as_of: asOf,
        requested_windows: windows,
        computed_windows: Math.min(windows, maxComputedWindows),
        window_labels: buildWindowLabels(windows),
        rows
      },
      200,
      {
        'Cache-Control': 'public, max-age=60'
      }
    );
  } catch (error) {
    console.error('nodeop-leaderboard failed:', error);
    return errorResponse((error as Error).message || 'Failed to load leaderboard', 500);
  }
});
