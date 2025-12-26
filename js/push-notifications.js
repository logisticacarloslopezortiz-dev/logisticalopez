// Gestión de notificaciones push
class PushNotificationManager {
    constructor() {
        console.log('PushNotificationManager v9 initializing...');
        this.vapidPublicKey = null;
        this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
        this.subscription = null;
        this.init();
    }

    async init() {
        if (!this.isSupported) {
            console.warn('Push notifications not supported');
            return;
        }

        try {
            // Obtener clave VAPID pública
            await this.loadVapidKey();
            
            // Registrar Service Worker
            await this.registerServiceWorker();
            
            // Verificar suscripción existente
            await this.checkExistingSubscription();
            
        } catch (error) {
            console.error('Error initializing push notifications:', error);
        }
    }

    async loadVapidKey() {
        try {
            const FALLBACK_KEY = 'BLBz5HXcYVnRWZxsRiEgTQZYfS6VipYQPj7xQYqKtBUH9Mz7OHwzB5UYRurLrj_TJKQNRPDkzDKq9lHP0ERJ1K8';

            if (!window.supabaseConfig) throw new Error('supabaseConfig no encontrado');
            // Asegurar que el cliente esté listo
            if (typeof supabaseConfig.ensureSupabaseReady === 'function') {
                await supabaseConfig.ensureSupabaseReady();
            }

            // Intentar obtener del config (que intenta edge function y tiene su propio fallback)
            if (typeof supabaseConfig.getVapidPublicKey === 'function') {
                try {
                    const configKey = await supabaseConfig.getVapidPublicKey();
                    if (configKey) this.vapidPublicKey = configKey;
                } catch (configErr) {
                    console.warn('Error obteniendo VAPID del config:', configErr);
                }
            }
            
            // Si no se obtuvo (o devolvió undefined), usar fallback local
            if (!this.vapidPublicKey) {
                console.log('VAPID no obtenido de config, usando fallback local.');
                this.vapidPublicKey = FALLBACK_KEY;
            }

            // Validar la clave obtenida
            try {
                if (!this.vapidPublicKey) throw new Error('Clave VAPID vacía o nula');
                const raw = this.urlBase64ToUint8Array(this.vapidPublicKey);
                if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
                    throw new Error(`Formato de VAPID inválido (len=${raw ? raw.length : '?'}, first=${raw ? raw[0] : '?'})`);
                }
            } catch (validationError) {
                console.warn(`Clave VAPID inválida ("${this.vapidPublicKey?.substring(0,10)}..."), usando fallback seguro. Razón:`, validationError.message);
                this.vapidPublicKey = FALLBACK_KEY;
                // Validar el fallback para estar seguros
                const raw = this.urlBase64ToUint8Array(this.vapidPublicKey);
                if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
                    throw new Error('Fallback VAPID key también es inválido');
                }
            }

            console.log('VAPID key lista para suscripción');
            return this.vapidPublicKey;
        } catch (error) {
            console.error('Error loading VAPID key:', error);
            this.vapidPublicKey = null;
            throw error;
        }
    }

    async registerServiceWorker() {
        try {
            let registration = null;
            if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === 'function') {
                try { registration = await navigator.serviceWorker.getRegistration(); } catch(_) {}
            }
            if (registration) {
                this.registration = registration;
                await navigator.serviceWorker.ready;
                console.log('Service Worker already registered:', registration);
                return registration;
            }
            registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration);
            await navigator.serviceWorker.ready;
            this.registration = registration;
            return registration;
        } catch (error) {
            console.error('Service Worker registration failed:', error);
            throw error;
        }
    }

    async checkExistingSubscription() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            
            if (subscription) {
                this.subscription = subscription;
                console.log('Existing push subscription found');
                
                // Solo sincronizar si el usuario aceptó explícitamente
                let optedIn = false;
                try { optedIn = localStorage.getItem('tlc_push_opt_in') === '1'; } catch(_) {}
                if (optedIn) {
                    // Verificar si está guardada en la base de datos
                    await this.syncSubscriptionWithServer(subscription);
                } else {
                    console.log('[push] Suscripción existente detectada pero sin opt-in; no se sincroniza con el servidor.');
                }

                try {
                    const savedKey = localStorage.getItem('tlc_vapid_pub') || '';
                    if (this.vapidPublicKey && savedKey && savedKey !== this.vapidPublicKey) {
                        await this.unsubscribe();
                        await this.subscribe();
                    } else if (this.vapidPublicKey && !savedKey) {
                        localStorage.setItem('tlc_vapid_pub', this.vapidPublicKey);
                    }
                } catch (_) {}
            }
            
            return subscription;
        } catch (error) {
            console.error('Error checking existing subscription:', error);
            return null;
        }
    }

    async requestPermission() {
        if (!this.isSupported) {
            throw new Error('Push notifications not supported');
        }

        const permission = await Notification.requestPermission();
        
        if (permission !== 'granted') {
            throw new Error('Notification permission denied');
        }

        return permission;
    }

    async subscribe() {
        try {
            // Solicitar permisos
            await this.requestPermission();
            
            // Obtener registration del Service Worker
            const registration = await navigator.serviceWorker.ready;
            
            // Asegurar clave VAPID
            if (!this.vapidPublicKey) {
                await this.loadVapidKey();
            }
            if (!this.vapidPublicKey) {
                throw new Error('VAPID key no disponible para suscripción');
            }
            // Crear suscripción
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
            });

            console.log('Push subscription created:', subscription);
            
            // Guardar en la base de datos (Best Effort)
            try {
                await this.saveSubscriptionToServer(subscription);
            } catch (saveError) {
                console.warn('Could not save subscription to server immediately (will be handled by order):', saveError);
            }
            
            this.subscription = subscription;
            try { if (this.vapidPublicKey) localStorage.setItem('tlc_vapid_pub', this.vapidPublicKey); } catch(_){}
            return subscription;
            
        } catch (error) {
            console.error('Error subscribing to push notifications:', error);
            throw error;
        }
    }

    async unsubscribe() {
        try {
            if (!this.subscription) {
                console.log('No active subscription to unsubscribe');
                return;
            }

            // Desuscribir del navegador
            await this.subscription.unsubscribe();
            
            // Eliminar de la base de datos
            await this.removeSubscriptionFromServer(this.subscription);
            
            this.subscription = null;
            console.log('Successfully unsubscribed from push notifications');
            
        } catch (error) {
            console.error('Error unsubscribing from push notifications:', error);
            throw error;
        }
    }

    async getSupabaseUser(client) {
        try {
            if (typeof client.auth.getUser === 'function') {
                const { data } = await client.auth.getUser();
                return data?.user;
            }
            if (typeof client.auth.getSession === 'function') {
                const { data } = await client.auth.getSession();
                return data?.session?.user;
            }
            if (typeof client.auth.user === 'function') {
                return client.auth.user();
            }
        } catch (e) { console.warn('Error getting user:', e); }
        return null;
    }

    async saveSubscriptionToServer(subscription) {
        try {
            if (typeof supabaseConfig.ensureSupabaseReady === 'function') {
                await supabaseConfig.ensureSupabaseReady();
            }
            const client = supabaseConfig?.client;
            if (!client || !client.auth || typeof client.from !== 'function') {
                throw new Error('Supabase client no inicializado o inválido en saveSubscriptionToServer');
            }

            const user = await this.getSupabaseUser(client);
            const contactId = (() => { try { return localStorage.getItem('tlc_client_contact_id'); } catch(_) { return null; } })();
            if (!user && !contactId) {
                throw new Error('User not authenticated and no contact id');
            }

            const raw = typeof subscription.toJSON === 'function' ? subscription.toJSON() : null;
            const keys = (raw && raw.keys) ? raw.keys : (subscription.keys || {});

            const subscriptionData = user ? {
                user_id: user.id,
                endpoint: subscription.endpoint,
                keys: { p256dh: keys.p256dh, auth: keys.auth }
            } : {
                client_contact_id: contactId,
                endpoint: subscription.endpoint,
                keys: { p256dh: keys.p256dh, auth: keys.auth }
            };

            const conflictCols = user ? 'user_id,endpoint' : 'client_contact_id,endpoint';
            const r = await client
                .from('push_subscriptions')
                .upsert(subscriptionData, { onConflict: conflictCols });

            if (r.error) throw r.error;
            console.log('Push subscription saved to server');
        } catch (error) {
            console.error('Error saving subscription to server:', error);
            throw error;
        }
    }

    async syncSubscriptionWithServer(subscription) {
        try {
            if (typeof supabaseConfig.ensureSupabaseReady === 'function') {
                await supabaseConfig.ensureSupabaseReady();
            }
            const client = supabaseConfig?.client;
            if (!client || typeof client.from !== 'function') {
                throw new Error('Supabase client no inicializado o inválido en syncSubscriptionWithServer');
            }

            const user = await this.getSupabaseUser(client);
            const contactId = (() => { try { return localStorage.getItem('tlc_client_contact_id'); } catch(_) { return null; } })();

            if (user && user.id) {
                const { data: existingSubscription, error } = await client
                    .from('push_subscriptions')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('endpoint', subscription.endpoint)
                    .maybeSingle();
                if (error && error.code !== 'PGRST116') throw error;
                if (!existingSubscription) await this.saveSubscriptionToServer(subscription);
                return;
            }

            if (contactId) {
                const { data: existingSubscription, error } = await client
                    .from('push_subscriptions')
                    .select('id')
                    .eq('client_contact_id', contactId)
                    .eq('endpoint', subscription.endpoint)
                    .maybeSingle();
                if (error && error.code !== 'PGRST116') throw error;
                if (!existingSubscription) await this.saveSubscriptionToServer(subscription);
                return;
            }
        } catch (error) {
            console.error('Error syncing subscription with server:', error);
        }
    }

    async removeSubscriptionFromServer(subscription) {
        try {
            if (typeof supabaseConfig.ensureSupabaseReady === 'function') {
                await supabaseConfig.ensureSupabaseReady();
            }
            const client = supabaseConfig?.client;
            if (!client || typeof client.from !== 'function') {
                throw new Error('Supabase client no inicializado o inválido en removeSubscriptionFromServer');
            }

            const user = await this.getSupabaseUser(client);
            const contactId = (() => { try { return localStorage.getItem('tlc_client_contact_id'); } catch(_) { return null; } })();

            if (user && user.id) {
                const { error } = await client
                    .from('push_subscriptions')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('endpoint', subscription.endpoint);
                if (error) throw error;
                console.log('Push subscription removed from server');
                return;
            }

            if (contactId) {
                const { error } = await client
                    .from('push_subscriptions')
                    .delete()
                    .eq('client_contact_id', contactId)
                    .eq('endpoint', subscription.endpoint);
                if (error) throw error;
                console.log('Push subscription removed from server');
                return;
            }
        } catch (error) {
            console.error('Error removing subscription from server:', error);
            throw error;
        }
    }

    async sendTestNotification() {
        // Deshabilitado: el frontend NO debe invocar funciones de envío directo.
        // Usa el flujo de outbox + process-outbox disparado por pg_cron desde backend.
        console.warn('[push] sendTestNotification deshabilitado. Usa notification_outbox + process-outbox.');
        throw new Error('sendTestNotification_disabled');
    }

    // Utility para convertir VAPID key
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // Getters para estado
    get isSubscribed() {
        return !!this.subscription;
    }

    get permissionStatus() {
        return Notification.permission;
    }
}

// Instancia global
window.pushManager = new PushNotificationManager();

// Funciones de utilidad para usar en la UI
window.pushNotifications = {
    async enable() {
        try {
            await window.pushManager.subscribe();
            try { localStorage.setItem('tlc_push_opt_in', '1'); } catch(_) {}
            return true;
        } catch (error) {
            console.error('Failed to enable push notifications:', error);
            return false;
        }
    },

    async disable() {
        try {
            await window.pushManager.unsubscribe();
            return true;
        } catch (error) {
            console.error('Failed to disable push notifications:', error);
            return false;
        }
    },

    async sendTest() {
        try {
            return await window.pushManager.sendTestNotification();
        } catch (error) {
            console.error('Failed to send test notification:', error);
            throw error;
        }
    },

    get isEnabled() {
        return window.pushManager.isSubscribed;
    },

    get isSupported() {
        return window.pushManager.isSupported;
    },

    get permission() {
        return window.pushManager.permissionStatus;
    }
};
