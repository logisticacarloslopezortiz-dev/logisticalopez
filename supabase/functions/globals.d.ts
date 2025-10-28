/// <reference lib="dom" />

// Declaraciones para que el IDE reconozca el entorno Deno en archivos de funciones Edge
declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: { get: (name: string) => string | undefined };
};

// Declaraciones mínimas de módulos remotos esm.sh para evitar errores de tipos en el IDE
// Nota: Estas declaraciones no impactan la ejecución en Edge, sólo ayudan al editor.
declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, options?: any): any;
}

declare module 'https://esm.sh/@supabase/supabase-js@2.45.4' {
  export function createClient(url: string, key: string, options?: any): any;
}

// Declaración mínima del módulo web-push en esm.sh para Deno
declare module 'https://esm.sh/web-push@3.6.1' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: any, payload: string, options?: any): Promise<any>;
  const _default: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default _default;
}

declare module 'https://esm.sh/web-push@3.6.7' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: any, payload: string, options?: any): Promise<any>;
  const _default: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default _default;
}