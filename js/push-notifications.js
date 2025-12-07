// Gestión de notificaciones push
class PushNotificationManager {
    constructor() {
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
            const client = supabaseConfig?.client;
            if (!client || !client.functions || typeof client.functions.invoke !== 'function') {
                throw new Error('Supabase client/functions no disponible');
            }
            // Primer intento: nombre canónico
            let resp = await client.functions.invoke('getVapidKey');
            if (resp.error || !resp.data?.key) {
                // Segundo intento: nombre con guiones (posibles despliegues antiguos)
                resp = await client.functions.invoke('get-vapid-key');
            }
            if (resp.error) throw resp.error;
            this.vapidPublicKey = resp.data?.key || null;
            if (!this.vapidPublicKey) throw new Error('Clave VAPID no disponible');
            const raw = this.urlBase64ToUint8Array(this.vapidPublicKey);
            if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
              throw new Error('Formato de VAPID inválido');
            }
            console.log('VAPID key obtenida desde Supabase Functions');
            return;
        } catch (error) {
            console.error('Error loading VAPID key (Supabase):', error);
            this.vapidPublicKey = null;
            throw new Error('No se pudo obtener la clave VAPID pública del servidor');
        }
    }

    async registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration);
            
            // Esperar a que esté activo
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
                
                // Verificar si está guardada en la base de datos
                await this.syncSubscriptionWithServer(subscription);

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
            
            // Crear suscripción
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
            });

            console.log('Push subscription created:', subscription);
            
            // Guardar en la base de datos
            await this.saveSubscriptionToServer(subscription);
            
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

    async saveSubscriptionToServer(subscription) {
        try {
            const { data: { user } } = await supabaseConfig.client.auth.getUser();
            
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

            const client = supabaseConfig?.client;
            if (!client || typeof client.from !== 'function') {
                throw new Error('Supabase client no inicializado o inválido en saveSubscriptionToServer');
            }

            const conflictCols = user ? 'user_id,endpoint' : 'client_contact_id,endpoint';
            const r = await client
                .from('push_subscriptions')
                .upsert(subscriptionData, { onConflict: conflictCols });

            if (r.error) {
                throw r.error;
            }
            
            console.log('Push subscription saved to server');
            
        } catch (error) {
            console.error('Error saving subscription to server:', error);
            throw error;
        }
    }

    async syncSubscriptionWithServer(subscription) {
        try {
            const { data: { user } } = await supabaseConfig.client.auth.getUser();
            
            if (!user) return;

            // Verificar si la suscripción existe en el servidor
            const client = supabaseConfig?.client;
            if (!client || typeof client.from !== 'function') {
                throw new Error('Supabase client no inicializado o inválido en syncSubscriptionWithServer');
            }

            const { data: existingSubscription, error } = await client
                .from('push_subscriptions')
                .select('id')
                .eq('user_id', user.id)
                .eq('endpoint', subscription.endpoint)
                .maybeSingle();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            // Si no existe, guardarla
            if (!existingSubscription) {
                await this.saveSubscriptionToServer(subscription);
            }
            
        } catch (error) {
            console.error('Error syncing subscription with server:', error);
        }
    }

    async removeSubscriptionFromServer(subscription) {
        try {
            const { data: { user } } = await supabaseConfig.client.auth.getUser();
            
            if (!user) return;

            const client = supabaseConfig?.client;
            if (!client || typeof client.from !== 'function') {
                throw new Error('Supabase client no inicializado o inválido en removeSubscriptionFromServer');
            }

            const { error } = await client
                .from('push_subscriptions')
                .delete()
                .eq('user_id', user.id)
                .eq('endpoint', subscription.endpoint);

            if (error) throw error;
            
            console.log('Push subscription removed from server');
            
        } catch (error) {
            console.error('Error removing subscription from server:', error);
            throw error;
        }
    }

    async sendTestNotification() {
        try {
            if (!this.subscription) throw new Error('No existe suscripción activa del navegador');
            const { data, error } = await supabaseConfig.client.functions.invoke('sendPush', {
                body: {
                    title: 'Notificación de prueba',
                    body: 'Esta es una notificación de prueba del sistema',
                    icon: '/img/android-chrome-192x192.png',
                    url: '/inicio.html',
                    subscription: (typeof this.subscription.toJSON === 'function') ? this.subscription.toJSON() : this.subscription
                }
            });
            if (error) throw error;
            console.log('Test notification sent via Supabase send-push:', data);
            return data;
        } catch (error) {
            console.error('Error sending test notification:', error);
            throw error;
        }
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
