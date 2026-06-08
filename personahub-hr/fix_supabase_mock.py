"""
fix_supabase_mock.py
Remplace le client Supabase mock par une version complete
qui supporte le chainage : .from().select().eq().order().in()...

Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os

CLIENT_FILE = os.path.join("src", "integrations", "supabase", "client.ts")

mock_content = '''// ─────────────────────────────────────────────────────────────────────────────
// Client Supabase MOCK — remplace Supabase par FastAPI
// Supporte le chainage complet : .from().select().eq().order().in()...
// Toutes les requetes retournent des donnees vides (migration progressive).
// ─────────────────────────────────────────────────────────────────────────────

class MockQueryBuilder {
  private _data: any[] = [];
  private _single = false;

  select(_cols?: string) { return this; }
  eq(_col: string, _val: any) { return this; }
  neq(_col: string, _val: any) { return this; }
  in(_col: string, _vals: any[]) { return this; }
  is(_col: string, _val: any) { return this; }
  gte(_col: string, _val: any) { return this; }
  lte(_col: string, _val: any) { return this; }
  gt(_col: string, _val: any) { return this; }
  lt(_col: string, _val: any) { return this; }
  like(_col: string, _val: string) { return this; }
  ilike(_col: string, _val: string) { return this; }
  order(_col: string, _opts?: any) { return this; }
  limit(_n: number) { return this; }
  range(_from: number, _to: number) { return this; }
  filter(_col: string, _op: string, _val: any) { return this; }
  contains(_col: string, _val: any) { return this; }
  overlaps(_col: string, _val: any) { return this; }
  textSearch(_col: string, _query: string) { return this; }
  match(_query: object) { return this; }
  not(_col: string, _op: string, _val: any) { return this; }
  or(_filter: string) { return this; }
  insert(_data: any, _opts?: any) { return this; }
  update(_data: any) { return this; }
  upsert(_data: any, _opts?: any) { return this; }
  delete() { return this; }
  count(_col?: string, _opts?: any) { return this; }

  single() {
    this._single = true;
    return this;
  }

  maybeSingle() {
    this._single = true;
    return this;
  }

  then(resolve: (result: any) => any, reject?: (err: any) => any) {
    const result = this._single
      ? { data: null, error: null, count: 0 }
      : { data: [], error: null, count: 0 };
    return Promise.resolve(result).then(resolve, reject);
  }

  // Rend l\'objet "thenable" (awaitable)
  get [Symbol.toStringTag]() { return "MockQueryBuilder"; }
}

class MockStorageBucket {
  upload(_path: string, _file: any, _opts?: any) {
    return Promise.resolve({ data: { path: _path }, error: null });
  }
  download(_path: string) {
    return Promise.resolve({ data: null, error: null });
  }
  getPublicUrl(_path: string) {
    return { data: { publicUrl: "" } };
  }
  remove(_paths: string[]) {
    return Promise.resolve({ data: null, error: null });
  }
  list(_prefix?: string) {
    return Promise.resolve({ data: [], error: null });
  }
}

class MockStorage {
  from(_bucket: string) { return new MockStorageBucket(); }
}

class MockRealtime {
  channel(_name: string) {
    return {
      on: () => this.channel(_name),
      subscribe: (_cb?: any) => ({ unsubscribe: () => {} }),
    };
  }
  removeChannel(_channel: any) {}
}

class MockAuth {
  private _session: any = null;
  private _listeners: Array<(event: string, session: any) => void> = [];

  async getSession() {
    return { data: { session: this._session }, error: null };
  }

  async getUser() {
    return { data: { user: null }, error: null };
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    this._listeners.push(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this._listeners = this._listeners.filter(l => l !== callback);
          },
        },
      },
    };
  }

  async signInWithPassword(_credentials: { email: string; password: string }) {
    // La connexion reelle passe par AuthContext -> FastAPI
    return { data: null, error: { message: "Utiliser AuthContext FastAPI" } };
  }

  async signUp(_credentials: any) {
    return { data: null, error: { message: "Inscription via administrateur uniquement" } };
  }

  async signOut() {
    this._session = null;
    return { error: null };
  }

  async resetPasswordForEmail(_email: string) {
    return { error: null };
  }
}

// ── Client principal ──────────────────────────────────────────────────────────
class MockSupabaseClient {
  readonly auth = new MockAuth();
  readonly storage = new MockStorage();
  readonly realtime = new MockRealtime();

  from(_table: string) {
    return new MockQueryBuilder();
  }

  rpc(_fn: string, _args?: any) {
    return new MockQueryBuilder();
  }

  channel(_name: string) {
    return this.realtime.channel(_name);
  }

  removeAllChannels() {}
}

export const supabase = new MockSupabaseClient();
'''

os.makedirs(os.path.join("src", "integrations", "supabase"), exist_ok=True)
with open(CLIENT_FILE, "w", encoding="utf-8") as f:
    f.write(mock_content)

print(f"OK : {CLIENT_FILE} remplace par le mock complet")
print("Le mock supporte maintenant tout le chainage Supabase.")
print("Actualisez le navigateur (F5) !")
