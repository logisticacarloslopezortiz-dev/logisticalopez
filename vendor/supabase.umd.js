/* Minimal UMD-style Supabase client replacement for restricted environments.
   Supports a subset of features used in this project: from/select/eq/not/order/maybeSingle,
   rpc, and functions.invoke. Uses PostgREST and Edge Functions endpoints directly. */
(function(root){
  if (root.supabase && typeof root.supabase.createClient === 'function') return;
  function createClient(url, anonKey){
    var baseUrl = String(url||'').replace(/\/$/, '');
    var headers = { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey, 'Content-Type': 'application/json' };
    function q(table){
      var _select = '*';
      var _filters = [];
      var _order = null;
      function buildParams(){
        var params = new URLSearchParams();
        if (_select) params.set('select', _select);
        _filters.forEach(function(f){
          if (f.type === 'eq') params.append(f.col, 'eq.' + f.val);
          else if (f.type === 'not' && f.op === 'in') params.append(f.col, 'not.in.(' + f.values.join(',') + ')');
          else if (f.type === 'or') params.append('or', '(' + f.val + ')');
        });
        if (_order) params.set('order', _order.column + '.' + (_order.ascending !== false ? 'asc' : 'desc'));
        return params;
      }
      async function exec(){
        var params = buildParams();
        var resp = await fetch(baseUrl + '/rest/v1/' + table + '?' + params.toString(), { headers: headers });
        if (!resp.ok) return { data: null, error: { status: resp.status, message: await resp.text() } };
        var json = await resp.json();
        return { data: json, error: null };
      }
      return {
        select: function(sel){ _select = sel || '*'; return this; },
        order: function(column, opts){ _order = { column: column, ascending: !!(opts?opts.ascending:true) }; return this; },
        eq: function(col,val){ _filters.push({ type:'eq', col:col, val:val }); return this; },
        not: function(col, op, values){ _filters.push({ type:'not', col:col, op:op, values:Array.isArray(values)?values:[] }); return this; },
        or: function(val){ _filters.push({ type:'or', val:val }); return this; },
        maybeSingle: async function(){ var r = await exec(); return { data: r.data ? r.data[0] || null : null, error: r.error } },
        then: function(res, rej){ return exec().then(res, rej); }
      };
    }
    return {
      supabaseUrl: baseUrl,
      auth: {
        async getSession(){ return { data: { session: null } }; },
        async refreshSession(){ return {}; }
      },
      from: q,
      rpc: async function(fn, args){
        try{
          var r = await fetch(baseUrl + '/rest/v1/rpc/' + fn, { method:'POST', headers: headers, body: JSON.stringify(args||{}) });
          if (!r.ok) return { data:null, error: { status:r.status, message: await r.text() } };
          return { data: await r.json(), error: null };
        }catch(e){ return { data:null, error:e }; }
      },
      functions: {
        async invoke(name, opts){
          try{
            var b = opts && opts.body ? JSON.stringify(opts.body) : undefined;
            var r = await fetch(baseUrl + '/functions/v1/' + name, { method:'POST', headers: headers, body: b });
            var ok = r.ok;
            var data = null; try { data = await r.json(); } catch(_){}
            return { data: ok ? data : null, error: ok ? null : new Error('HTTP ' + r.status) };
          }catch(e){ return { data:null, error:e }; }
        }
      }
    };
  }
  root.supabase = { createClient: createClient };
})(typeof window !== 'undefined' ? window : this);