# 🎯 INICIO RÁPIDO - SUPABASE + LIVE SERVER + MEJORAS

## PASO 1: Configurar CORS (2 minutos)
1. Abre https://app.supabase.com → Tu proyecto
2. Settings → API → CORS
3. Agrega estos dominios:
   - `http://localhost:5500`
   - `http://127.0.0.1:5500`
   - `http://localhost:3000` (opcional)

## PASO 2: Abrir con Live Server (30 segundos)
1. Click derecho en `index.html`
2. "Open with Live Server"
3. ✅ Se abre en `http://localhost:5500`

## PASO 3: Verificar que Supabase carga
1. Abre DevTools (F12) → Console
2. Ejecuta: `supabaseConfig.client`
3. ✅ Deberías ver el objeto cliente sin errores

## PASO 4: Probar Asignación de Órdenes
1. Login en admin (inicio.html)
2. Selecciona una orden
3. Haz clic en "Gestionar"
4. Elige un colaborador
5. Haz clic en "Asignar"
6. ✅ Verás spinner, luego confirmación

---

## ✅ MEJORAS APLICADAS

| Mejora | Antes | Después |
|--------|-------|---------|
| **Feedback al asignar** | Sin respuesta visual | Spinner + "Asignando..." |
| **Órdenes finalizadas** | Se podían abrir/asignar | Se valida y rechaza |
| **Botón deshabilitado** | Podía quedar "pegado" | Se restaura con try/finally |
| **Estados inconsistentes** | 'Completada' vs 'entregada' | Todo mapeado a 'completed' en BD |
| **Disponibilidad** | Sin validación | Verifica órdenes activas |

---

## 🔴 ERRORES COMUNES Y SOLUCIÓN

### ❌ "CORS policy: No 'Access-Control-Allow-Origin'"
**Solución**: Agrega `http://localhost:5500` a CORS en Supabase

### ❌ "Cannot read property 'createClient'"
**Solución**: Verifica que en `index.html` incluyas Supabase ANTES de supabase-config:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.43.0"></script>
<script src="js/supabase-config.js"></script>
```

### ❌ "401 Unauthorized"
**Solución**: Limpia cache y recarga:
- Presiona Ctrl+Shift+Delete
- Selecciona "Cookies y datos de sitios" 
- Recarga F5

### ❌ "RPC update_order_status falló"
**Solución**: El RPC probablemente no existe en BD. Ejecuta:
```sql
-- En Supabase SQL Editor
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' AND routine_name LIKE 'update%';
```

---

## 📱 FLUJO DE TRABAJO TÍPICO

```
1. Inicia sesión
2. Ve órdenes pendientes en tabla
3. Haz doble clic en orden O usa botón "Gestionar"
4. Se abre modal con detalles
5. Elige colaborador del select
6. Haz clic "Asignar"
   → Se muestra spinner
   → Se asigna orden a colaborador
   → Se notifica con "Pedido asignado a [nombre]"
   → Modal se cierra automáticamente
7. Orden desaparece de lista (si finalizó)
```

---

## 🎨 PERSONALIZACIÓN VISUAL

Si quieres cambiar los colores del spinner, edita en `inicio.js`:

```javascript
// Cambiar el spinner por otros iconos de lucide:
assignBtn.innerHTML = '<i data-lucide="check-circle" class="..."></i>Confirmando...';
// Opciones: loader, check-circle, clock, zap, etc.

// Cambiar colores:
class="w-4 h-4 animate-spin inline-block mr-2 text-blue-600"
```

---

## 📊 MONITOREO EN CONSOLA

Abre DevTools (F12) y copia esto en Console:

```javascript
// Ver todos los logs de OrderManager
const logs = [];
const originalLog = console.log;
console.log = function(...args) {
  if (String(args[0]).includes('[OrderManager]')) {
    logs.push(args);
  }
  originalLog.apply(console, args);
};
```

Luego: `logs` para ver todos los eventos

---

## ✨ FUNCIONES ÚTILES EN CONSOLA

```javascript
// Ver todas las órdenes cargadas
console.table(allOrders);

// Ver filtradas (no completadas)
console.table(filteredOrders);

// Ver colaboradores
console.log(__collaboratorsById);

// Recargar órdenes manualmente
await loadOrders();

// Verificar sesión
await supabaseConfig.client.auth.getSession();
```

---

## 🚀 PRÓXIMOS PASOS

1. ✅ CORS configurado
2. ✅ Live Server corriendo
3. ✅ Asignaciones funcionando
4. **Siguiente**: Implementar reintentos automáticos
5. **Siguiente**: Agregar panel de disponibilidad en tiempo real
6. **Siguiente**: Notificaciones push a colaboradores

---

Para más detalles, ve a:
- 📖 `GUIA_SUPABASE_LIVE_SERVER.md` - Configuración completa
- ✨ `CAMBIOS_IMPLEMENTADOS.md` - Detalles de mejoras

¡Listo para producción! 🎉
