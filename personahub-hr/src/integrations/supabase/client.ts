// Supabase Proxy — redirige tous les appels vers FastAPI
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

function getToken(): string | null {
  return sessionStorage.getItem("access_token");
}
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

class QueryBuilder {
  private _table: string;
  private _method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  private _body: any = null;
  private _filters: Record<string, string> = {};
  private _select: string = "*";
  private _order: string = "";
  private _limit: number = 1000;
  private _offset: number = 0;
  private _single: boolean = false;
  private _maybeSingle: boolean = false;

  constructor(table: string) { this._table = table; }

  select(cols: string = "*") { this._select = cols; return this; }
  eq(col: string, val: any) { this._filters[col] = `eq.${val}`; return this; }
  neq(col: string, val: any) { this._filters[col] = `neq.${val}`; return this; }
  gt(col: string, val: any) { this._filters[col] = `gt.${val}`; return this; }
  gte(col: string, val: any) { this._filters[col] = `gte.${val}`; return this; }
  lt(col: string, val: any) { this._filters[col] = `lt.${val}`; return this; }
  lte(col: string, val: any) { this._filters[col] = `lte.${val}`; return this; }
  like(col: string, val: string) { this._filters[col] = `like.${val}`; return this; }
  ilike(col: string, val: string) { this._filters[col] = `ilike.${val}`; return this; }
  is(col: string, val: any) { this._filters[col] = `is.${val}`; return this; }
  in(col: string, vals: any[]) { this._filters[col] = `in.(${vals.join(",")})`; return this; }
  not(_col: string, _op: string, _val: any) { return this; }
  or(_f: string) { return this; }
  contains(_c: string, _v: any) { return this; }
  overlaps(_c: string, _v: any) { return this; }
  filter(col: string, op: string, val: any) { this._filters[col] = `${op}.${val}`; return this; }
  match(query: Record<string, any>) { for (const [k,v] of Object.entries(query)) this.eq(k,v); return this; }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this._order = `${col}.${opts.ascending === false ? "desc" : "asc"}`;
    return this;
  }
  limit(n: number) { this._limit = n; return this; }
  range(from: number, to: number) { this._offset = from; this._limit = to - from + 1; return this; }
  single() { this._single = true; this._limit = 1; return this; }
  maybeSingle() { this._maybeSingle = true; this._limit = 1; return this; }
  insert(data: any, _opts?: any) { this._method = "POST"; this._body = data; return this; }
  update(data: any) { this._method = "PATCH"; this._body = data; return this; }
  upsert(data: any, _opts?: any) { this._method = "POST"; this._body = data; return this; }
  delete() { this._method = "DELETE"; return this; }
  count(_col?: string, _opts?: any) { return this; }

  private buildUrl(): string {
    const params = new URLSearchParams();
    if (this._method === "GET") {
      if (this._select !== "*") params.set("select", this._select);
      if (this._order) params.set("order", this._order);
      if (this._limit !== 1000) params.set("limit", String(this._limit));
      if (this._offset) params.set("offset", String(this._offset));
    }
    for (const [k, v] of Object.entries(this._filters)) params.set(k, v);
    const qs = params.toString();
    return `${API_BASE}/db/${this._table}${qs ? "?" + qs : ""}`;
  }

  then(resolve: (r: { data: any; error: any; count?: number }) => any, reject?: (e: any) => any) {
    return this._execute().then(resolve, reject);
  }

  private async _execute(): Promise<{ data: any; error: any; count?: number }> {
    const token = getToken();
    if (!token) return { data: null, error: { message: "Non authentifie" } };
    try {
      const url = this.buildUrl();
      const opts: RequestInit = {
        method: this._method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
      };
      if (this._body !== null && (this._method === "POST" || this._method === "PATCH")) {
        opts.body = JSON.stringify(this._body);
      }
      const res = await fetch(url, opts);
      if (res.status === 204) return { data: null, error: null };
      const json = await res.json();
      if (!res.ok) return { data: null, error: { message: json.detail || `Erreur ${res.status}` } };
      if (this._single || this._maybeSingle) {
        const item = Array.isArray(json) ? (json[0] ?? null) : json;
        return { data: item, error: null };
      }
      return { data: Array.isArray(json) ? json : [json], error: null, count: Array.isArray(json) ? json.length : 1 };
    } catch (err: any) {
      console.error(`[Proxy] ${this._table}:`, err);
      return { data: null, error: { message: err.message } };
    }
  }
}

class ProxyAuth {
  private _listeners: Array<(e: string, s: any) => void> = [];
  async getSession() {
    const token = sessionStorage.getItem("access_token");
    return { data: { session: token ? { access_token: token } : null }, error: null };
  }
  async getUser() { return { data: { user: null }, error: null }; }
  onAuthStateChange(cb: (e: string, s: any) => void) {
    this._listeners.push(cb);
    return { data: { subscription: { unsubscribe: () => { this._listeners = this._listeners.filter(l => l !== cb); } } } };
  }
  async signInWithPassword(_c: any) { return { data: null, error: { message: "Utiliser AuthContext" } }; }
  async signUp(_c: any) { return { data: null, error: { message: "Inscription via admin" } }; }
  async signOut() { sessionStorage.removeItem("access_token"); return { error: null }; }
  async resetPasswordForEmail(_e: string) { return { error: null }; }
}

class ProxyStorageBucket {
  private _b: string;
  constructor(b: string) { this._b = b; }
  async upload(path: string, _file: any, _opts?: any) { return { data: { path }, error: null }; }
  async download(_p: string) { return { data: null, error: null }; }
  getPublicUrl(path: string) { return { data: { publicUrl: `${API_BASE}/storage/${this._b}/${path}` } }; }
  async remove(_p: string[]) { return { data: null, error: null }; }
  async list(_p?: string) { return { data: [], error: null }; }
}

class ProxyStorage { from(b: string) { return new ProxyStorageBucket(b); } }

class SupabaseProxyClient {
  readonly auth = new ProxyAuth();
  readonly storage = new ProxyStorage();
  from(table: string) { return new QueryBuilder(table); }
  rpc(fn: string, args?: any) {
    const qb = new QueryBuilder(`${fn}/rpc`);
    (qb as any)._method = "POST";
    (qb as any)._body = args ?? {};
    return qb;
  }
  channel(_n: string) { return { on: () => this.channel(_n), subscribe: (_cb?: any) => ({ unsubscribe: () => {} }) }; }
  removeAllChannels() {}
}

export const supabase = new SupabaseProxyClient();
