// Configuración de Supabase
class SupabaseConfig {
    constructor() {
        // Cargar variables de entorno desde .env o usar valores por defecto
        this.supabaseUrl = this.getEnvVar('SUPABASE_URL');
        this.supabaseKey = this.getEnvVar('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ';
        this.vapidPublicKey = this.getEnvVar('VAPID_PUBLIC_KEY');
        this.useLocalStorage = this.getEnvVar('USE_LOCAL_STORAGE') === 'true';
        
        // Inicializar cliente de Supabase si está disponible
        if (typeof supabase !== 'undefined' && !this.useLocalStorage) {
            this.client = supabase.createClient(this.supabaseUrl, this.supabaseKey);
            console.log('Cliente Supabase inicializado correctamente');
        } else {
            console.log('Usando localStorage como fallback para datos');
        }
    }

    // Método para obtener variables de entorno (simulado para frontend)
    getEnvVar(name) {
        // En un entorno real, esto vendría de process.env o configuración del servidor
        const envVars = { // Cambia 'USE_LOCAL_STORAGE' a 'false' para conectar a Supabase
            'SUPABASE_URL': 'https://fkprllkxyjtosjhtikxy.supabase.co',
            'SUPABASE_ANON_KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ',
            'GOOGLE_MAPS_API_KEY': 'AQUI_VA_TU_CLAVE_DE_API_REAL'
        };
        return envVars[name];
    }

    // Métodos para órdenes/pedidos
    async getOrders() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
        }
        
        try {
            // Si el cliente de Supabase no está inicializado, usar localStorage directamente.
            if (!this.client) {
                return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
            }
            const { data, error } = await this.client
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error al obtener órdenes:', error);
            return JSON.parse(localStorage.getItem('tlc_orders') || '[]'); // Return the fallback
        }
    }

    async saveOrder(order) {
        if (this.useLocalStorage) {
            const orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
            orders.push(order);
            localStorage.setItem('tlc_orders', JSON.stringify(orders));
            return order;
        }

        try {
            const { data, error } = await this.client
                .from('orders')
                .insert([order])
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('Error al guardar orden:', error);
            // Fallback a localStorage
            const orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
            orders.push(order);
            localStorage.setItem('tlc_orders', JSON.stringify(orders));
            return order;
        }
    }

    async updateOrder(orderId, updates) {
        if (this.useLocalStorage) {
            const orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
            const index = orders.findIndex(o => o.id === orderId);
            if (index !== -1) {
                orders[index] = { ...orders[index], ...updates };
                localStorage.setItem('tlc_orders', JSON.stringify(orders));
                return orders[index];
            }
            return null;
        }

        try {
            const { data, error } = await this.client
                .from('orders')
                .update(updates)
                .eq('id', orderId)
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('Error al actualizar orden:', error);
            return null;
        }
    }

    // Métodos para colaboradores
    async getCollaborators() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('colaboradores') || '[]');
        }

        try {
            const { data, error } = await this.client
                .from('collaborators')
                .select('*');
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error al obtener colaboradores:', error);
            return JSON.parse(localStorage.getItem('colaboradores') || '[]');
        }
    }

    async saveCollaborator(collaborator) {
        if (this.useLocalStorage) {
            const collaborators = JSON.parse(localStorage.getItem('colaboradores') || '[]');
            collaborators.push(collaborator);
            localStorage.setItem('colaboradores', JSON.stringify(collaborators));
            return collaborator;
        }

        try {
            const { data, error } = await this.client
                .from('collaborators')
                .insert([collaborator])
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('Error al guardar colaborador:', error);
            // Fallback a localStorage
            const collaborators = JSON.parse(localStorage.getItem('colaboradores') || '[]');
            collaborators.push(collaborator);
            localStorage.setItem('colaboradores', JSON.stringify(collaborators));
            return collaborator;
        }
    }

    async loginCollaborator(email, password) {
        if (this.useLocalStorage) {
            const localCollaborators = JSON.parse(localStorage.getItem('colaboradores') || '[]');
            const user = localCollaborators.find(c => c.email === email && c.password === password);
            return { user: user || null, error: user ? null : { message: 'Credenciales inválidas' } };
        }

        try {
            const { data: user, error } = await this.client
                .from('collaborators')
                .select('*')
                .eq('email', email)
                .single();

            if (error || !user || user.password !== password) { // ¡IMPORTANTE! Esto es inseguro. Ver nota abajo.
                throw new Error('Correo o contraseña incorrectos.');
            }
            return { user, error: null };
        } catch (error) {
            return { user: null, error };
        }
    }
    // Métodos para servicios y vehículos
    async getServices() {
        if (this.useLocalStorage) {
            // Simular la estructura de Supabase para consistencia
            return JSON.parse(localStorage.getItem('tlc_services') || '[]');
        }

        try {
            const { data, error } = await this.client
                .from('services')
                .select('*') // Asegurarse de que se seleccionan todas las columnas
                .eq('is_active', true)
                .order('name');
            
            if (error) console.error('Error en getServices:', error);
            return { data: data || [], error };
        } catch (error) {
            console.error('Error al obtener servicios:', error);
            return { data: JSON.parse(localStorage.getItem('tlc_services') || '[]'), error };
        }
    }

    async getVehicles() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('tlc_vehicles') || '[]');
        }

        try {
            const { data, error } = await this.client
                .from('vehicles')
                .select('*') // Asegurarse de que se seleccionan todas las columnas
                .eq('is_active', true)
                .order('name');
            
            if (error) console.error('Error en getVehicles:', error);
            return { data: data || [], error };
        } catch (error) {
            console.error('Error al obtener vehículos:', error);
            return { data: JSON.parse(localStorage.getItem('tlc_vehicles') || '[]'), error };
        }
    }

    async addService(serviceData) {
        if (this.useLocalStorage) return null; // No soportado en modo local por ahora
        const { data, error } = await this.client.from('services').insert([serviceData]).select();
        if (error) throw error;
        return data[0];
    }

    async addVehicle(vehicleData) {
        if (this.useLocalStorage) return null;
        const { data, error } = await this.client.from('vehicles').insert([vehicleData]).select();
        if (error) throw error;
        return data[0];
    }

    async deleteService(serviceId) {
        const { error } = await this.client.from('services').delete().eq('id', serviceId);
        if (error) throw error;
    }

    async deleteVehicle(vehicleId) {
        const { error } = await this.client.from('vehicles').delete().eq('id', vehicleId);
        if (error) throw error;
    }

    async getBusinessSettings() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('businessData') || '{}');
        }
        try {
            const { data, error } = await this.client
                .from('business_settings')
                .select('*')
                .eq('id', 1)
                .single();
            if (error) throw error;
            return data;
        } catch (error) { console.error('Error al obtener configuración del negocio:', error); return {}; }
    }
    // Método para sincronizar datos locales con Supabase
    async syncLocalData() {
        if (this.useLocalStorage) {
            console.log('Sincronización omitida: usando localStorage');
            return;
        }

        try {
            // Sincronizar órdenes
            const localOrders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
            for (const order of localOrders) {
                if (!order.synced) {
                    await this.saveOrder({ ...order, synced: true });
                }
            }

            // Sincronizar colaboradores
            const localCollaborators = JSON.parse(localStorage.getItem('colaboradores') || '[]');
            for (const collaborator of localCollaborators) {
                if (!collaborator.synced) {
                    await this.saveCollaborator({ ...collaborator, synced: true });
                }
            }

            console.log('Sincronización completada');
        } catch (error) {
            console.error('Error en sincronización:', error);
        }
    }

    // Método para cambiar entre localStorage y Supabase
    toggleStorageMode(useLocal = true) {
        this.useLocalStorage = useLocal;
        console.log(`Modo de almacenamiento cambiado a: ${useLocal ? 'localStorage' : 'Supabase'}`);
    }
}

// Crear instancia global
const supabaseConfig = new SupabaseConfig();

// Exportar para uso en otros archivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupabaseConfig;
}