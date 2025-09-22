import 'dotenv/config';
import fetch from 'cross-fetch';
const COMP_URL = process.env.COMPOUND_V3_SUBGRAPH!;

async function gql<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Compound subgraph ${res.status}`);
  return res.json() as Promise<T>;
}

/** Example query; adjust to your subgraph’s schema */
export async function fetchCompoundV3(user: string) {
  const q = /* GraphQL */ `
    query Comp($user: String!) {
      accounts(where: { id: $user }) {
        id
        positions { asset { symbol decimals } supplyBalance borrowBalance }
      }
      liquidations(where: { borrower: $user }, orderBy: timestamp, orderDirection: desc, first: 20) {
        amount timestamp asset { symbol }
      }
    }
  `;
  const data = await gql<any>(COMP_URL, { query: q, variables: { user: user.toLowerCase() } });
  return data.data;
}
