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
    useLocalStorage: false,
    vapidPublicKey: null,

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

  // Crea un cliente público (anon) para consultas que no requieran la sesión del usuario
  getPublicClient() {
    // Reutilizar cliente público cacheado para evitar múltiples GoTrueClient con mismo storageKey
    if (this._publicClient) return this._publicClient;
    try {
      if (typeof supabase !== 'undefined' && supabase?.createClient) {
        this._publicClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, storageKey: 'sb-tlc-public' }
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
    await this.ensureFreshSession();
    let { data, error } = await this.client.from('services')
      .select('*')
      .order('display_order', { ascending: true, nullsFirst: false });

    // Manejar JWT expirado: intentar consulta con cliente público (anon)
    if (error && (error.code === 'PGRST303' || error.status === 401 || /jwt expired/i.test(String(error.message || '')))) {
      console.warn('JWT expirado o no autorizado para obtener services. Reintentando con cliente anon...');
      try {
        const publicClient = this.getPublicClient();
        const resp = await publicClient.from('services').select('*').order('display_order', { ascending: true, nullsFirst: false });
        if (resp.error) console.error('Error fetching services (anon):', resp.error);
        return resp.data || [];
      } catch (e) {
        console.error('Error fetching services with anon client:', e);
      }
    }

    if (error) console.error('Error fetching services:', error);
    return data || [];
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
    await this.ensureFreshSession();
    let { data, error } = await this.client.from('vehicles').select('*');

    if (error && (error.code === 'PGRST303' || error.status === 401 || /jwt expired/i.test(String(error.message || '')))) {
      console.warn('JWT expirado o no autorizado para obtener vehicles. Reintentando con cliente anon...');
      try {
        const publicClient = this.getPublicClient();
        const resp = await publicClient.from('vehicles').select('*');
        if (resp.error) console.error('Error fetching vehicles (anon):', resp.error);
        return resp.data || [];
      } catch (e) {
        console.error('Error fetching vehicles with anon client:', e);
      }
    }

    if (error) console.error('Error fetching vehicles:', error);
    return data || [];
  },

  /**
   * Obtiene la lista de órdenes.
   * @returns {Promise<Array>}
   */
  async getOrders() {
    if (this.useLocalStorage) {
      try { return JSON.parse(localStorage.getItem('tlc_orders') || '[]'); } catch { return []; }
    }
    await this.ensureFreshSession();
    let { data, error } = await this.client.from('orders').select('*');

    if (error && (error.code === 'PGRST303' || error.status === 401 || /jwt expired/i.test(String(error.message || '')))) {
      console.warn('JWT expirado o no autorizado para obtener orders. Reintentando con cliente anon...');
      try {
        const publicClient = this.getPublicClient();
        const resp = await publicClient.from('orders').select('*');
        if (resp.error) console.error('Error fetching orders (anon):', resp.error);
        return resp.data || [];
      } catch (e) {
        console.error('Error fetching orders with anon client:', e);
      }
    }

    if (error) console.error('Error fetching orders:', error);
    return data || [];
  },

  /**
   * Obtiene las órdenes asignadas a un colaborador específico.
   * @param {string} collaboratorId - El ID del colaborador.
   * @returns {Promise<Array>}
   */
  async getOrdersForCollaborator(collaboratorId) {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('orders')
      .select('*')
      .eq('assigned_to', collaboratorId);
    if (error) console.error(`Error fetching orders for collaborator ${collaboratorId}:`, error);
    return data || [];
  },

  /**
   * Agrega un nuevo servicio.
   * @param {object} serviceData - Los datos del servicio a agregar.
   * @returns {Promise<object>} El servicio recién creado.
   */
  async addService(serviceData) {
    const { data, error } = await this.client.from('services').insert(serviceData).select().single();
    if (error) throw error;
    return data;
  },

  /**
   * Elimina un servicio por su ID.
   * @param {string} serviceId - El ID del servicio a eliminar.
   */
  async deleteService(serviceId) {
    const { error } = await this.client.from('services').delete().eq('id', serviceId);
    if (error) throw error;
  },

  /**
   * Agrega un nuevo vehículo.
   * @param {object} vehicleData - Los datos del vehículo a agregar.
   * @returns {Promise<object>} El vehículo recién creado.
   */
  async addVehicle(vehicleData) {
    const { data, error } = await this.client.from('vehicles').insert(vehicleData).select().single();
    if (error) throw error;
    return data;
  },

  /**
   * Elimina un vehículo por su ID.
   * @param {string} vehicleId - El ID del vehículo a eliminar.
   */
  async deleteVehicle(vehicleId) {
    const { error } = await this.client.from('vehicles').delete().eq('id', vehicleId);
    if (error) throw error;
  },

  /**
   * Actualiza una orden por su ID.
   * @param {string} orderId - El ID de la orden.
   * @param {object} updates - Los campos a actualizar.
   * @returns {Promise<object>} Los datos actualizados de la orden.
   */
  async updateOrder(orderId, updates) {
    console.log('updateOrder called with:', { orderId, updates });
    
    // Primero verificar si la orden existe
    const { data: existingOrder, error: checkError } = await this.client
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .maybeSingle();
    
    if (checkError) {
      console.error('Error checking order existence:', checkError);
      throw checkError;
    }
    
    if (!existingOrder) {
      const notFoundError = new Error(`Orden con ID ${orderId} no encontrada`);
      notFoundError.code = 'ORDER_NOT_FOUND';
      throw notFoundError;
    }
    
    // Sanea payload: elimina campos que no existen en el esquema conocidas y reintenta si la BD rechaza columnas
    let safeUpdates = { ...updates };
    delete safeUpdates.last_collab_status;
    delete safeUpdates.lastCollabStatus;
    // Eliminar el campo tracking si existe en las actualizaciones
    if ('tracking' in safeUpdates) {
      delete safeUpdates.tracking;
    }

    // Intentaremos la actualización; si falla por columna desconocida, quitamos la(s) columna(s) problemática(s) y reintentos.
    let attempt = 0;
    let data, error;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const resp = await this.client
          .from('orders')
          .update(safeUpdates)
          .eq('id', orderId)
          .select()
          .maybeSingle();
        data = resp.data;
        error = resp.error;
      } catch (e) {
        // Algunas versiones retornan error como excepción
        error = e;
      }

      if (!error) break; // éxito

      // Si el error contiene texto indicando que una columna no existe, remover esos campos y reintentar
      const msg = String(error.message || error.error || '').toLowerCase();
      const colsToCheck = ['tracking', 'tracking_data', 'last_collab_status', 'lastCollabStatus'];
      let removed = false;
      for (const col of colsToCheck) {
        if (msg.includes(`column "${col.toLowerCase()}"`) || msg.includes(`column ${col.toLowerCase()}`)) {
          if (Object.prototype.hasOwnProperty.call(safeUpdates, col)) {
            delete safeUpdates[col];
            removed = true;
          }
        }
      }

      // Si no se removió nada, no tiene sentido reintentar
      if (!removed) break;
    }

    if (error) {
      console.error('updateOrder error:', error);
      console.log('=== SUPABASE ERROR DETAILS ===');
      console.log('Error type:', typeof error);
      console.log('Error keys:', error ? Object.keys(error) : 'null');
      try {
        console.log('Error JSON:', JSON.stringify(error, null, 2));
      } catch (jsonErr) {
        console.log('Cannot stringify error:', jsonErr.message);
      }
      console.log('=== END SUPABASE ERROR ===');
      throw error;
    }
    
    console.log('updateOrder success:', data);
    return data;
  },

  /**
   * Obtiene la clave pública VAPID (para Web Push) desde el servidor y la cachea.
   */
  async getVapidPublicKey() {
    try {
      if (this.vapidPublicKey) return this.vapidPublicKey;
      
      // Primero intentamos obtener la clave desde la función Edge de Supabase
      try {
        const { data, error } = await this.client.functions.invoke('get-vapid-key');
        if (!error && data && data.vapidPublicKey) {
          this.vapidPublicKey = data.vapidPublicKey;
          return this.vapidPublicKey;
        }
      } catch (supabaseError) {
        console.log('Intentando método alternativo para obtener VAPID key...');
      }
      
      // Si falla, intentamos el endpoint API tradicional
      const resp = await fetch('/api/vapidPublicKey');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      this.vapidPublicKey = json?.key || null;
      
      // Si todo falla, usamos una clave de respaldo (solo para desarrollo)
      if (!this.vapidPublicKey) {
        console.warn('Usando VAPID key de respaldo (solo para desarrollo)');
        this.vapidPublicKey = 'BLBz5HXcYVnRWZxsRiEgTQZYfS6VipYQPj7xQYqKtBUH9Mz7OHwzB5UYRurLrj_TJKQNRPDkzDKq9lHP0ERJ1K8';
      }
      
      return this.vapidPublicKey;
    } catch (e) {
      console.warn('No se pudo obtener VAPID public key:', e);
      // Usar clave de respaldo en caso de error (solo para desarrollo)
      this.vapidPublicKey = 'BLBz5HXcYVnRWZxsRiEgTQZYfS6VipYQPj7xQYqKtBUH9Mz7OHwzB5UYRurLrj_TJKQNRPDkzDKq9lHP0ERJ1K8';
      return this.vapidPublicKey;
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
    // rnc puede ser string o null; evitar tipos inválidos
    if (Object.prototype.hasOwnProperty.call(payload, 'rnc')) {
      const val = payload.rnc;
      payload.rnc = (val === undefined || val === null) ? null : String(val).trim() || null;
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
      throw new Error(`Error al guardar configuración: ${error.message}`);
    }
    console.log('Configuración guardada exitosamente:', data);
    return data;
  }
  };
} // end if guard

// Exportar referencia (por compatibilidad con scripts que ya lo usan)
const supabaseConfig = window.supabaseConfig;
// Nota: evitar `export {}` para que funcione en navegadores sin módulos