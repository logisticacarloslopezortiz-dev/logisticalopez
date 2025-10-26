/**
 * Configuración centralizada de Supabase.
 * Este archivo inicializa el cliente de Supabase y lo exporta
 * en un objeto `supabaseConfig` para ser usado en toda la aplicación.
 */

const SUPABASE_URL = 'https://fkprllkxyjtosjhtikxy.supabase.co'; // Reemplaza con la URL de tu proyecto
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ';        
let supabaseClient = null;

try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error("Error al inicializar el cliente de Supabase:", e);
}

const supabaseConfig = {
  client: supabaseClient,
  useLocalStorage: false, // ✅ CORREGIDO: Forzar la lectura desde Supabase siempre.
  vapidPublicKey: null,

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
    // ✅ MEJORA: Pedir los servicios ordenados directamente desde la base de datos.
    const { data, error } = await this.client.from('services')
      .select('*')
      .order('display_order', { ascending: true, nullsFirst: false });
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
    const { data, error } = await this.client.from('vehicles').select('*');
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
    const { data, error } = await this.client.from('orders').select('*');
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
    // Sanea payload: elimina campos que no existen en el esquema
    const safeUpdates = { ...updates };
    delete safeUpdates.last_collab_status;
    delete safeUpdates.lastCollabStatus;

    const { data, error } = await this.client
      .from('orders')
      .update(safeUpdates)
      .eq('id', orderId)
      .select()
      .single();
    
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
      const resp = await fetch('/api/vapidPublicKey');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      this.vapidPublicKey = json?.key || null;
      return this.vapidPublicKey;
    } catch (e) {
      console.warn('No se pudo obtener VAPID public key:', e);
      return null;
    }
  },

  /**
   * Obtiene la configuración del negocio.
   * @returns {Promise<object>} La configuración del negocio.
   */
  async getBusinessSettings() {
    if (!this.client) return {};
    // Asumimos que solo hay una fila de configuración con id=1
    const { data, error } = await this.client.from('business_settings').select('*').eq('id', 1).single();
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
    if (!this.client) return;
    // Usamos upsert para crear la fila si no existe, o actualizarla si ya existe.
    const { error } = await this.client.from('business_settings').upsert({ id: 1, ...settingsData });
    if (error) throw error;
  }
};