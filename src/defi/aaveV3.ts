import 'dotenv/config';
import fetch from 'cross-fetch';

const AAVE_URL = process.env.AAVE_V3_SUBGRAPH!;
type Gql = { query: string; variables?: Record<string, any> };

async function gql<T>(url: string, body: Gql): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Aave subgraph ${res.status}`);
  return res.json() as Promise<T>;
}

/** Fetches basic positions + recent credit events for a user */
export async function fetchAavePositions(user: string) {
  const q = /* GraphQL */ `
    query AaveUser($user: String!) {
      userReserves(where: { user: $user }) {
        scaledATokenBalance
        scaledVariableDebt
        reserve { symbol decimals liquidityRate variableBorrowRate usageAsCollateralEnabled }
      }
      borrows: borrows(where: { user: $user }, orderBy: timestamp, orderDirection: desc, first: 50) {
        amount timestamp reserve { symbol decimals }
      }
      repays: repays(where: { user: $user }, orderBy: timestamp, orderDirection: desc, first: 50) {
        amount timestamp reserve { symbol decimals }
      }
      liquidations: liquidationCalls(where: { user: $user }, orderBy: timestamp, orderDirection: desc, first: 20) {
        collateralAmount principalAmount timestamp
      }
    }
  `;
  const data = await gql<any>(AAVE_URL, { query: q, variables: { user: user.toLowerCase() } });
  return data.data;
}
