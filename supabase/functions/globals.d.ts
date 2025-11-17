declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, options?: unknown): unknown;
}

declare module 'https://esm.sh/@supabase/supabase-js@2.45.4' {
  export function createClient(url: string, key: string, options?: unknown): unknown;
}

declare module '@supabase/supabase-js' {
  export function createClient(url: string, key: string, options?: unknown): unknown;
}

declare module 'https://esm.sh/web-push@3.6.1' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: unknown, payload: string, options?: unknown): Promise<unknown>;
  const _default: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default _default;
}

declare module 'https://esm.sh/web-push@3.6.7' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: unknown, payload: string, options?: unknown): Promise<unknown>;
  const _default: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default _default;
}

declare module 'web-push' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: unknown, payload: string, options?: unknown): Promise<unknown>;
  const _default: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default _default;
}