import { fetchThorchain } from './thornode.ts';
import {
  buildAssetUsdIndex,
  normalizeRapidSwapAction
} from '../../../src/lib/rapid-swaps/model.js';

const MIDGARD_ACTIONS_URL = 'https://midgard.ninerealms.com/v2/actions';
const ACTION_PAGE_LIMIT = 50;

function isChallengeResponse(response: Response): boolean {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const cfMitigated = response.headers.get('cf-mitigated');
  return contentType.includes('text/html') || Boolean(cfMitigated);
}

async function fetchMidgardActionPage(nextPageToken = ''): Promise<{ actions: any[]; nextPageToken: string }> {
  const params = new URLSearchParams({
    type: 'swap',
    limit: String(ACTION_PAGE_LIMIT)
  });

  if (nextPageToken) {
    params.set('nextPageToken', nextPageToken);
  }

  const response = await fetch(`${MIDGARD_ACTIONS_URL}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'x-client-id': 'RuneTools'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Midgard actions (${response.status})`);
  }

  if (isChallengeResponse(response)) {
    throw new Error('Midgard returned challenge response');
  }

  const payload = await response.json();
  return {
    actions: Array.isArray(payload?.actions) ? payload.actions : [],
    nextPageToken: String(payload?.meta?.nextPageToken || '')
  };
}

export async function fetchRapidSwapRows(
  options: { maxPages?: number } = {}
): Promise<{ rows: Record<string, unknown>[]; scannedPages: number; scannedActions: number; observedAt: string }> {
  const maxPages = Math.max(1, Math.trunc(options.maxPages || 20));
  const observedAt = new Date().toISOString();

  const [network, pools] = await Promise.all([
    fetchThorchain('/thorchain/network'),
    fetchThorchain('/thorchain/pools')
  ]);

  const priceIndex = buildAssetUsdIndex(network, Array.isArray(pools) ? pools : []);
  const rowsByTxId = new Map<string, Record<string, unknown>>();

  let nextPageToken = '';
  let scannedPages = 0;
  let scannedActions = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchMidgardActionPage(nextPageToken);
    const actions = payload.actions || [];

    scannedPages += 1;
    scannedActions += actions.length;

    for (const action of actions) {
      const row = normalizeRapidSwapAction(action, {
        observedAt,
        priceIndex
      });

      if (row?.tx_id) {
        rowsByTxId.set(String(row.tx_id), row);
      }
    }

    if (!payload.nextPageToken) {
      break;
    }

    nextPageToken = payload.nextPageToken;
  }

  return {
    rows: [...rowsByTxId.values()],
    scannedPages,
    scannedActions,
    observedAt
  };
}
