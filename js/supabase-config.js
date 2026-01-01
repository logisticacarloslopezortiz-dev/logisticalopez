/**
 * Configuración centralizada de Supabase.
 * Este archivo inicializa el cliente de Supabase y lo exporta
 * en un objeto `supabaseConfig` para ser usado en toda la aplicación.
 */

const SUPABASE_URL = 'https://fkprllkxyjtosjhtikxy.supabase.co'; // Reemplaza con la URL de tu proyecto
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ';

// Evitar múltiples instancias de GoTrueClient: reutilizar cliente único y cachear public client
if (!window.supabaseConfig) {
  let mainClient = null;
  if (typeof supabase !== 'undefined' && supabase?.createClient) {
    try {
      mainClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storageKey: 'sb-tlc-main'
        },
        functions: {
          url: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co')
        }
      });
    } catch (e) {
      console.error('Error al inicializar el cliente principal de Supabase:', e);
    }
  } else {
    console.error('Supabase JS no cargado: verifica el script UMD antes de supabase-config.js');
  }

  window.supabaseConfig = {
    client: mainClient,
    _publicClient: null, // Se inicializa como null y se crea solo cuando se necesita
    projectUrl: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    functionsUrl: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co'),
    useLocalStorage: false,
    vapidPublicKey: null,
    buckets: { evidence: 'order-evidence', fallbackEvidence: 'public' },
    getEvidenceBucket() { return (this.buckets && this.buckets.evidence) ? this.buckets.evidence : 'evidence'; },
    // Eliminado: process-outbox no debe invocarse desde el frontend.
    // Si necesitas forzar procesamiento, usa el RPC admin desde backend
    // o confía en pg_cron para ejecutar cada minuto.
    async triggerOutboxTestForContact(contactId){
      try {
        const { data, error } = await this.client.rpc('create_outbox_test_for_contact', { c: contactId });
        return { id: data || null, error };
      } catch(e){ return { id:null, error: e }; }
    },

  // Asegura que la sesión JWT esté fresca antes de consultas
  ensureFreshSession: async function() {
    try {
      const { data: { session } } = await this.client.auth.getSession();
      if (!session) return;
      const now = Math.floor(Date.now() / 1000);
      const exp = session.expires_at || 0;
      if (exp <= now + 60) { // renovar si expira en 60s
        // Intentar refrescar la sesión; si falla, lo manejaremos en los queries
        try {
          if (this.client.auth.refreshSession) {
            await this.client.auth.refreshSession();
          }
        } catch (e) {
          console.warn('No se pudo refrescar la sesión automáticamente:', e?.message || e);
        }
      }
    } catch (_) { /* no-op */ }
  },

  isJwtExpiredError: function(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    const code = String(err.code || '');
    const status = Number(err.status || 0);
    return /jwt expired/i.test(msg) || code === 'PGRST303' || status === 401 || /JWT expired/i.test(msg);
  },

  withAuthRetry: async function (op) {
    await this.ensureFreshSession();

    let res;
    try {
      res = await op();
    } catch (e) {
      return { data: null, error: e };
    }

    if (this.isJwtExpiredError(res?.error)) {
      try {
        await this.client.auth.refreshSession?.();
      } catch (_) {}
      try {
        return await op();
      } catch (e) {
        return { data: null, error: e };
      }
    }

    return res;
  },

  // Garantiza que Supabase UMD esté cargado y clientes inicializados
  ensureSupabaseReady: async function() {
    try {
      if (this.client && typeof this.client.from === 'function') return;
      if (typeof supabase === 'undefined' || !supabase?.createClient) {
        await new Promise((resolve) => {
          const existing = document.querySelector('script[src*="supabase.umd.js"]');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            // Si ya está cargado, resolver inmediatamente
            if (typeof supabase !== 'undefined') return resolve();
            return;
          }
          const s = document.createElement('script');
          s.src = 'vendor/supabase.umd.js';
          s.async = false;
          s.onload = () => resolve();
          s.onerror = () => resolve();
          document.head.appendChild(s);
        });
      }
      if (!this.client && typeof supabase !== 'undefined' && supabase?.createClient) {
        try {
          this.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, storageKey: 'sb-tlc-main' },
            functions: { url: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') }
          });
        } catch (e) { console.error('Error re-inicializando cliente principal de Supabase:', e); }
      }
      if (!this._publicClient && typeof supabase !== 'undefined' && supabase?.createClient) {
        try {
          this._publicClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, storageKey: 'sb-tlc-public' },
            functions: { url: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') }
          });
        } catch (e) { console.warn('No se pudo crear public client:', e); }
      }
      let retries = 0;
      while (
        !(this.client && typeof this.client.from === 'function') &&
        !(this._publicClient && typeof this._publicClient.from === 'function') &&
        retries < 20
      ) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
        if (!this.client && typeof supabase !== 'undefined' && supabase?.createClient) {
          try {
            this.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
              auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, storageKey: 'sb-tlc-main' },
              functions: { url: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') }
            });
          } catch (_) {}
        }
        if (!this._publicClient && typeof supabase !== 'undefined' && supabase?.createClient) {
          try {
            this._publicClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
              auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, storageKey: 'sb-tlc-public' },
              functions: { url: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') }
            });
          } catch (_) {}
        }
      }
    } catch (_) { /* no-op */ }
  },

  // Fallback REST (PostgREST) para lecturas públicas cuando el cliente no está disponible
  async restSelect(table, query) {
    try {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      // Forzar aceptación JSON y retorno plano
      url.searchParams.set('select', query?.select || '*');
      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Accept': 'application/json'
        }
      });
      if (!resp.ok) {
        return { data: null, error: new Error(`rest_error_${resp.status}`) };
      }
      const data = await resp.json();
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  },

  async restInsert(table, row) {
    try {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        'Accept': 'application/json'
      };
      const resp = await fetch(url.toString(), { method: 'POST', headers, body: JSON.stringify(row) });
      if (!resp.ok) return { data: null, error: new Error(`rest_error_${resp.status}`) };
      const data = await resp.json();
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  },

  async restGetOrderByAny(identifier) {
    const idStr = String(identifier || '').trim();
    if (!idStr) return { data: null, error: null };
    const isNum = /^\d+$/.test(idStr);
    const variants = [];
    if (isNum) variants.push({ col: 'id', val: idStr });
    variants.push({ col: 'short_id', val: idStr });
    if (idStr.startsWith('ORD-')) variants.push({ col: 'short_id', val: idStr.replace(/^ORD\-/, '') });
    variants.push({ col: 'short_id', val: idStr.toUpperCase() });
    variants.push({ col: 'short_id', val: idStr.toLowerCase() });
    const select = '*,service:services(name),vehicle:vehicles(name)';
    for (const v of variants) {
      const q = { select };
      q[`${v.col}`] = `eq.${v.val}`;
      const { data } = await this.restSelect('orders', q);
      if (Array.isArray(data) && data.length) return { data: data[0], error: null };
    }
    return { data: null, error: new Error('not_found') };
  },

  // Crea un cliente público (anon) para consultas que no requieran la sesión del usuario
  getPublicClient() {
    // Reutilizar cliente público cacheado para evitar múltiples GoTrueClient con mismo storageKey
    if (this._publicClient) return this._publicClient;
    try {
      if (typeof supabase !== 'undefined' && supabase?.createClient) {
        this._publicClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, storageKey: 'sb-tlc-public' },
          functions: { url: SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') }
        });
        return this._publicClient;
      }
      throw new Error('Supabase JS no cargado');
    } catch (e) {
      console.error('Error creando public client de Supabase:', e);
      return this.client; // fallback al cliente principal
    }
  },

  // --- INICIO: Funciones de acceso a datos ---

  /**
   * Obtiene la lista de servicios.
   * @returns {Promise<Array>}
   */
  async getServices() {
    if (this.useLocalStorage) {
      try {
        return JSON.parse(localStorage.getItem('tlc_services') || '[]');
      } catch { return []; }
    }
    try {
      await this.ensureSupabaseReady();
      const pc = this.getPublicClient();
      const clientToUse = (pc && typeof pc.from === 'function') ? pc : this.client;
      if (!clientToUse || typeof clientToUse.from !== 'function') {
        console.warn('Supabase client no disponible para servicios');
        return [];
      }
      const resp = await clientToUse.from('services').select('*').order('display_order', { ascending: true, nullsFirst: false });
      if (resp.error) console.error('Error fetching services (anon):', resp.error);
      return resp.data || [];
    } catch (e) {
      console.error('Error fetching services with anon client:', e);
      return [];
    }
  },

  /**
   * Obtiene la lista de vehículos.
   * @returns {Promise<Array>}
   */
  async getVehicles() {
    if (this.useLocalStorage) {
      try {
        return JSON.parse(localStorage.getItem('tlc_vehicles') || '[]');
      } catch { return []; }
    }
    try {
      await this.ensureSupabaseReady();
      const pc = this.getPublicClient();
      const clientToUse = (pc && typeof pc.from === 'function') ? pc : this.client;
      if (!clientToUse || typeof clientToUse.from !== 'function') {
        console.warn('Supabase client no disponible para vehículos');
        return [];
      }
      const resp = await clientToUse.from('vehicles').select('*');
      if (resp.error) console.error('Error fetching vehicles (anon):', resp.error);
      return resp.data || [];
    } catch (e) {
      console.error('Error fetching vehicles with anon client:', e);
      return [];
    }
  },

  /**
   * Obtiene la lista de órdenes.
   * @returns {Promise<Array>}
   */
  async getOrders() {
    if (this.useLocalStorage) {
      try { return JSON.parse(localStorage.getItem('tlc_orders') || '[]'); } catch { return []; }
    }
    const resp = await this.withAuthRetry(() => this.client
      .from('orders')
      .select('*, service:services(name), vehicle:vehicles(name)')
    );
    if (resp?.error) return [];
    return resp?.data || [];
  },

  async getOrderById(orderId) {
    const resp = await this.withAuthRetry(() => this.client
      .from('orders')
      .select('*, service:services(name), vehicle:vehicles(name)')
      .eq('id', orderId)
      .maybeSingle()
    );
    if (resp?.error) return null;
    return resp?.data || null;
  },

  /**
   * Obtiene las órdenes asignadas a un colaborador específico.
   * @param {string} collaboratorId - El ID del colaborador.
   * @returns {Promise<Array>}
   */
  async getOrdersForCollaborator(collaboratorId) {
    if (!this.client) return [];

    try {
      if (!collaboratorId) {
        const { data: u } = await this.client.auth.getUser();
        collaboratorId = u?.user?.id || null;
      }
    } catch (_) {}

    const FINAL_STATES = new Set(['completed', 'cancelled', 'entregada', 'completada', 'cancelada']);

    try {
      const sel = `
        id,short_id,name,phone,status,
        pickup,delivery,
        service:services(name),
        vehicle:vehicles(name),
        assigned_to
      `;

      const { data, error } = await this.withAuthRetry(() =>
        this.client.from('orders').select(sel)
      );

      if (error) {
        console.error('Error fetching orders:', error);
        return [];
      }

      // 🧠 Filtro REAL basado en estado
      return (data || []).filter(o => {
        const s = String(o.status || '').toLowerCase().trim();
        return !FINAL_STATES.has(s);
      });

    } catch (e) {
      console.error('Unexpected error fetching collaborator orders:', e);
      return [];
    }
  },

  /**
   * Agrega un nuevo servicio.
   * @param {object} serviceData - Los datos del servicio a agregar.
   * @returns {Promise<object>} El servicio recién creado.
   */
  async addService(serviceData) {
    const { data, error } = await (this.withAuthRetry?.(() => this.client.from('services').insert(serviceData).select().single())
      || this.client.from('services').insert(serviceData).select().single());
    if (error) throw error;
    return data;
  },

  /**
   * Elimina un servicio por su ID.
   * @param {string} serviceId - El ID del servicio a eliminar.
   */
  async deleteService(serviceId) {
    const { error } = await (this.withAuthRetry?.(() => this.client.from('services').delete().eq('id', serviceId))
      || this.client.from('services').delete().eq('id', serviceId));
    if (error) throw error;
  },

  /**
   * Agrega un nuevo vehículo.
   * @param {object} vehicleData - Los datos del vehículo a agregar.
   * @returns {Promise<object>} El vehículo recién creado.
   */
  async addVehicle(vehicleData) {
    const { data, error } = await (this.withAuthRetry?.(() => this.client.from('vehicles').insert(vehicleData).select().single())
      || this.client.from('vehicles').insert(vehicleData).select().single());
    if (error) throw error;
    return data;
  },

  /**
   * Elimina un vehículo por su ID.
   * @param {string} vehicleId - El ID del vehículo a eliminar.
   */
  async deleteVehicle(vehicleId) {
    const { error } = await (this.withAuthRetry?.(() => this.client.from('vehicles').delete().eq('id', vehicleId))
      || this.client.from('vehicles').delete().eq('id', vehicleId));
    if (error) throw error;
  },

  /**
   * Actualiza una orden por su ID.
   * @param {string} orderId - El ID de la orden.
   * @param {object} updates - Los campos a actualizar.
   * @returns {Promise<object>} Los datos actualizados de la orden.
   */
  async updateOrder() {
    throw new Error('updateOrder está deprecado. Usa OrderManager.actualizarEstadoPedido()');
  },

  /**
   * Obtiene la clave pública VAPID (para Web Push) desde el servidor y la cachea.
   */
  async getVapidPublicKey() {
    try {
      if (this.vapidPublicKey) return this.vapidPublicKey;

      try { await this.ensureSupabaseReady?.(); } catch(_){}

      // 1) Obtener SOLO desde Edge Function unificada
      let key = null;
      try {
        const resp = await this.client.functions.invoke('getVapidKey');
        if (resp?.data?.key && typeof resp.data.key === 'string') key = resp.data.key;
      } catch(_){}

      // 2) Intentar obtener desde tabla de configuración de negocio
      if (!key) {
        try {
          const bs = await this.getBusinessSettings();
          key = bs?.vapid_public_key || bs?.push_vapid_key || null;
        } catch(_){}
      }

      // 3) Intentar obtener desde localStorage
      if (!key) {
        try { key = localStorage.getItem('tlc_vapid_pub') || null; } catch(_){}
      }

      // 4) Fallback de emergencia (Generado automáticamente)
      if (!key) {
        key = 'BCgYgK3ZJwHjR529P7BaTE27ImKc6Cl-BzJSr8h2KrnUeQXth7G2iuAqfS-8BUQ9qAQ8oAMjb76cAXzA3R0MUn8';
      }

      // Validar formato básico
      const toBytes = (base64String) => {
        try {
          const padding = '='.repeat((4 - base64String.length % 4) % 4);
          const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
          const rawData = atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
          return outputArray;
        } catch(_) { return new Uint8Array(0); }
      };

      if (key) {
        const bytes = toBytes(key);
        if (bytes instanceof Uint8Array && bytes.length === 65 && bytes[0] === 4) {
          this.vapidPublicKey = key;
          try { localStorage.setItem('tlc_vapid_pub', key); } catch(_){}
          return this.vapidPublicKey;
        } else {
          console.warn('VAPID pública inválida desde Edge Function. Debe responder { key: PUBLIC_VAPID_KEY }');
        }
      }

      throw new Error('No se pudo obtener VAPID pública válida');
    } catch (e) {
      console.warn('No se pudo obtener VAPID public key:', e);
      throw e;
    }
  },

  /**
   * Obtiene la configuración del negocio.
   * @returns {Promise<object>} La configuración del negocio.
   */
  async getBusinessSettings() {
    if (!this.client) return {};
    // Asumimos que solo hay una fila de configuración con id=1
    const { data, error } = await this.client.from('business').select('*').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error fetching business settings:', error);
      return {};
    }
    return data || {};
  },

  /**
   * Guarda o actualiza la configuración del negocio.
   * @param {object} settingsData - Los datos de configuración a guardar.
   */
  async saveBusinessSettings(settingsData) {
    if (!this.client) throw new Error('Cliente de Supabase no inicializado');
    console.log('Guardando configuración del negocio:', settingsData);

    // Saneamiento defensivo
    const payload = { id: 1, ...settingsData };
    // rnc: normalizar a solo dígitos y validar longitud (9-11)
    if (Object.prototype.hasOwnProperty.call(payload, 'rnc')) {
      const raw = payload.rnc;
      let normalized = (raw === undefined || raw === null) ? null : String(raw).replace(/\D+/g, '');
      if (normalized && normalized.length === 0) normalized = null;
      if (normalized && (normalized.length < 9 || normalized.length > 11)) {
        throw new Error('RNC inválido: debe contener entre 9 y 11 dígitos');
      }
      payload.rnc = normalized;
    }
    // quotation_rates debe ser objeto JSON serializable
    if (Object.prototype.hasOwnProperty.call(payload, 'quotation_rates')) {
      const qr = payload.quotation_rates;
      if (qr && typeof qr === 'object') {
        // No hacer nada, dejarlo como objeto
      } else {
        payload.quotation_rates = null;
      }
    }

    const { data, error } = await this.client
      .from('business')
      .upsert(payload)
      .select();
    if (error) {
      console.error('Error detallado al guardar business:', error);
      const msg = String(error.message || 'Error');
      if (/business_rnc_check/i.test(msg)) {
        throw new Error('Error al guardar configuración: RNC inválido (solo dígitos, 9-11)');
      }
      throw new Error(`Error al guardar configuración: ${msg}`);
    }
    console.log('Configuración guardada exitosamente:', data);
    return data;
  },

  /**
   * Valida si un usuario es un colaborador activo en la base de datos.
   * @param {string} userId - El ID del usuario autenticado.
   * @returns {Promise<object>} { isValid: boolean, collaborator: object|null, error: string|null }
   */
  async validateActiveCollaborator(userId) {
    try {
      if (!userId) {
        return { isValid: false, collaborator: null, error: 'User ID is empty' };
      }
      try { await this.ensureFreshSession(); } catch(_){ }
      const { data: { session } } = await this.client.auth.getSession();
      const emailClaim = session?.user?.email || null;

      const resp = await this.withAuthRetry(() => this.client
        .from('collaborators')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      );
      const collaborator = resp?.data || null;
      const error = resp?.error || null;
      
      if (error) {
        console.error('Error validating collaborator:', error);
        return { isValid: false, collaborator: null, error: error.message };
      }
      
      let collab = collaborator;
      if (!collab && emailClaim) {
        const byEmailResp = await this.withAuthRetry(() => this.client
          .from('collaborators')
          .select('*')
          .eq('email', emailClaim)
          .maybeSingle()
        );
        const byEmail = byEmailResp?.data || null;
        const e2 = byEmailResp?.error || null;
        if (e2) {
          console.error('Error validating collaborator by email:', e2);
          return { isValid: false, collaborator: null, error: e2.message };
        }
        collab = byEmail || null;
      }
      if (!collab) {
        console.warn(`Collaborator not found for user ${userId}`);
        return { isValid: false, collaborator: null, error: 'Collaborator not found' };
      }
      
      // Validar que el status sea 'activo'
      if (String(collab.status || '').trim().toLowerCase() !== 'activo') {
        console.warn(`Collaborator ${userId} has status: ${collab.status}`);
        return { isValid: false, collaborator: collab, error: 'Collaborator is not active' };
      }
      
      // Validar que el role sea 'colaborador' o 'administrador'
      const role = String(collab.role || '').trim().toLowerCase();
      if (role !== 'colaborador' && role !== 'administrador') {
        console.warn(`Collaborator ${userId} has role: ${collab.role}`);
        return { isValid: false, collaborator: collab, error: 'Invalid role for this panel' };
      }
      
      return { isValid: true, collaborator: collab, error: null };
    } catch (e) {
      console.error('Unexpected error in validateActiveCollaborator:', e);
      return { isValid: false, collaborator: null, error: e.message };
    }
  }
  ,

  async getActiveJobOrder() {
    try {
      await this.ensureFreshSession?.();
      const { data: { session } } = await this.client.auth.getSession();
      if (!session?.user?.id) return null;
      const { data: job } = await this.client
        .from('collaborator_active_jobs')
        .select('order_id')
        .maybeSingle();
      const orderId = job?.order_id;
      if (!orderId) return null;
      const resp = await this.client
        .from('orders')
        .select('*, service:services(name), vehicle:vehicles(name)')
        .eq('id', orderId)
        .maybeSingle();
      return resp?.data || null;
    } catch (_) { return null; }
  },

  async startOrderWork(orderId) {
    try {
      await this.ensureFreshSession?.();
      const { data, error } = await this.client.rpc('start_order_work', { p_order_id: Number(orderId) });
      if (error) return { order: null, error };
      const { data: ord } = await this.client
        .from('orders')
        .select('*, service:services(name), vehicle:vehicles(name)')
        .eq('id', Number(orderId))
        .maybeSingle();
      return { order: ord || null, error: null };
    } catch (e) {
      return { order: null, error: e };
    }
  },

  async completeOrderWork(orderId) {
    try {
      await this.ensureFreshSession?.();
      const { error } = await this.client.rpc('complete_order_work', { p_order_id: Number(orderId) });
      return { error: error || null };
    } catch (e) { return { error: e }; }
  }
  };
} // end if guard

// Exportar referencia (por compatibilidad con scripts que ya lo usan)
const supabaseConfig = window.supabaseConfig;
try { Object.freeze(window.supabaseConfig); } catch(_) {}
// Nota: evitar `export {}` para que funcione en navegadores sin módulos
