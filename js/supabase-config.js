// Configuración de Supabase
class SupabaseConfig {
    constructor() {
        // Cargar variables de entorno desde .env o usar valores por defecto
        this.supabaseUrl = this.getEnvVar('SUPABASE_URL') || 'https://fkprllkxyjtosjhtikxy.supabase.co';
        this.supabaseKey = this.getEnvVar('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ';
        this.useLocalStorage = this.getEnvVar('USE_LOCAL_STORAGE') === 'true' || true;
        
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
        const envVars = {
            'SUPABASE_URL': 'https://fkprllkxyjtosjhtikxy.supabase.co',
            'SUPABASE_ANON_KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ',
            'USE_LOCAL_STORAGE': 'true',
            'GOOGLE_MAPS_API_KEY': 'tu-clave-de-google-maps'
        };
        return envVars[name];
    }

    // Métodos para órdenes/pedidos
    async getOrders() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
        }
        
        try {
            const { data, error } = await this.client
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error al obtener órdenes:', error);
            return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
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

    // Métodos para servicios y vehículos
    async getServices() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('servicesData') || '{}');
        }

        try {
            const { data, error } = await this.client
                .from('services')
                .select('*');
            
            if (error) throw error;
            
            const servicesObj = {};
            data.forEach(service => {
                servicesObj[service.name] = service.count || 0;
            });
            
            return servicesObj;
        } catch (error) {
            console.error('Error al obtener servicios:', error);
            return JSON.parse(localStorage.getItem('servicesData') || '{}');
        }
    }

    async getVehicles() {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem('vehiclesData') || '{}');
        }

        try {
            const { data, error } = await this.client
                .from('vehicles')
                .select('*');
            
            if (error) throw error;
            
            const vehiclesObj = {};
            data.forEach(vehicle => {
                vehiclesObj[vehicle.name] = vehicle.count || 0;
            });
            
            return vehiclesObj;
        } catch (error) {
            console.error('Error al obtener vehículos:', error);
            return JSON.parse(localStorage.getItem('vehiclesData') || '{}');
        }
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