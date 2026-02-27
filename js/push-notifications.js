// Gestión de notificaciones push
class PushNotificationManager {
    constructor() {
        this.version = 'v10';
        this.vapidPublicKey = null;
        this.subscription = null;
        this.registration = null;
        this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        this.state = 'idle';
        console.log(`PushNotificationManager ${this.version} starting`);
        if (this.isSupported) this.init();
    }

    async init() {
        if (!this.isSupported) return;
        if (this.state !== 'idle') return;
        this.state = 'initializing';
        try {
            await this.ensureVapidKey();
            await this.ensureServiceWorker();
            await this.restoreSubscription();
            this.state = 'ready';
        } catch (error) {
            console.error('[push] init failed:', error);
            this.state = 'error';
        }
    }

    async ensureVapidKey() {
        if (this.vapidPublicKey) return this.vapidPublicKey;
        let key = null;
        try { if (typeof window.__VAPID_PUBLIC_KEY__ === 'string') key = window.__VAPID_PUBLIC_KEY__; } catch(_) {}
        if (!key) { try { key = localStorage.getItem('tlc_vapid_pub') || null; } catch(_) {} }
        if (this.isValidVapid(key)) {
            this.vapidPublicKey = key;
            return this.vapidPublicKey;
        }
        
        try {
            if (window.supabaseConfig && typeof supabaseConfig.getVapidPublicKey === 'function') {
                const response = await supabaseConfig.getVapidPublicKey();
                key = typeof response === 'string' ? response : response?.key;
                if (this.isValidVapid(key)) {
                    this.vapidPublicKey = key;
                    try { localStorage.setItem('tlc_vapid_pub', key); } catch(_) {}
                    return this.vapidPublicKey;
                }
            }
        } catch(e) { console.warn('Supabase getVapidPublicKey failed', e); }

        // Fallback final hardcoded (Emergencia)
        key = 'BCgYgK3ZJwHjR529P7BaTE27ImKc6Cl-BzJSr8h2KrnUeQXth7G2iuAqfS-8BUQ9qAQ8oAMjb76cAXzA3R0MUn8';
        if (this.isValidVapid(key)) {
             this.vapidPublicKey = key;
             try { localStorage.setItem('tlc_vapid_pub', key); } catch(_) {}
             return this.vapidPublicKey;
        }

        throw new Error('VAPID pública no configurada');
    }

    isValidVapid(key) {
        try {
            const raw = this.urlBase64ToUint8Array(key);
            return raw instanceof Uint8Array && raw.length === 65 && raw[0] === 4;
        } catch { return false; }
    }

    async ensureServiceWorker() {
        let registration = null;
        if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === 'function') {
            try { registration = await navigator.serviceWorker.getRegistration(); } catch(_) {}
        }
        if (!registration) {
            registration = await navigator.serviceWorker.register('/sw.js');
        }
        await navigator.serviceWorker.ready;
        this.registration = registration;
        return registration;
    }

    async restoreSubscription() {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return null;
        this.subscription = subscription;
        if (this.hasUserOptIn()) {
            await this.syncSubscriptionWithServer(subscription);
        }
        return subscription;
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
        if (!this.isSupported) throw new Error('Push not supported');
        if (Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('Notification permission denied');
        }
        await this.ensureVapidKey();
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
        });
        this.subscription = subscription;
        this.setOptIn(true);
        await this.syncSubscriptionWithServer(subscription);
        return subscription;
    }

    async unsubscribe() {
        if (!this.subscription) return;
        await this.subscription.unsubscribe();
        await this.removeSubscriptionFromServer(this.subscription);
        this.subscription = null;
        this.setOptIn(false);
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
            const cleanEndpoint = String(subscription.endpoint || '')
              .trim()
              .replace(/`+/g, '');
            const subscriptionData = user ? {
                user_id: user.id,
                endpoint: cleanEndpoint,
                keys: { p256dh: keys.p256dh, auth: keys.auth }
            } : {
                client_contact_id: contactId,
                endpoint: cleanEndpoint,
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
                    .eq('endpoint', subscription.endpoint)
                    .eq('user_id', user.id)
                    .maybeSingle();
                if (error && error.code !== 'PGRST116') throw error;
                if (!existingSubscription) await this.saveSubscriptionToServer(subscription);
                return;
            }
            if (contactId) {
                const { data: existingSubscription, error } = await client
                    .from('push_subscriptions')
                    .select('id')
                    .eq('endpoint', subscription.endpoint)
                    .eq('client_contact_id', contactId)
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
                    .eq('endpoint', subscription.endpoint)
                    .eq('user_id', user.id);
                if (error) throw error;
                console.log('Push subscription removed from server');
                return;
            }
            if (contactId) {
                const { error } = await client
                    .from('push_subscriptions')
                    .delete()
                    .eq('endpoint', subscription.endpoint)
                    .eq('client_contact_id', contactId);
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
        throw new Error('sendTestNotification_disabled');
    }

    hasUserOptIn() {
        try { return localStorage.getItem('tlc_push_opt_in') === '1'; } catch(_) { return false; }
    }

    setOptIn(val) {
        try { localStorage.setItem('tlc_push_opt_in', val ? '1' : '0'); } catch(_){}
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

/* 
  SISTEMA DESHABILITADO
  Este archivo contenía una implementación manual de Web Push que ha sido 
  reemplazada por OneSignal para evitar conflictos y mejorar la fiabilidad.
  
  window.pushManager = new PushNotificationManager();
  window.pushNotifications = { ... };
*/
console.warn('[Push] El sistema manual de push-notifications.js está deshabilitado en favor de OneSignal.');
