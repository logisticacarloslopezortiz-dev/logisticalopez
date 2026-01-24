// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const UI_TO_DB_STATUS = {
  pendiente: 'pending',
  aceptada: 'accepted',
  en_camino_recoger: 'in_progress',
  cargando: 'in_progress',
  en_camino_entregar: 'in_progress',
  entregada: 'completed',
  cancelada: 'cancelled'
};

const STATE_FLOW = {
  pendiente: ['aceptada'],
  aceptada: ['en_camino_recoger'],
  en_camino_recoger: ['cargando'],
  cargando: ['en_camino_entregar'],
  en_camino_entregar: ['entregada']
};

const OrderManager = {
  // Función helper para normalizar IDs de orden
  _normalizeOrderId(orderId) {
    try {
      // Si ya es un número finito, devolverlo
      if (typeof orderId === 'number' && Number.isFinite(orderId)) return orderId;
      
      // Si es string numérico, convertir
      if (typeof orderId === 'string') {
        const n = Number(orderId);
        return Number.isFinite(n) ? n : null;
      }
      
      // Si es objeto, buscar supabase_seq_id o id numérico
      if (orderId && typeof orderId === 'object') {
        // Priorizar supabase_seq_id si existe
        if (Number.isFinite(orderId.supabase_seq_id)) return orderId.supabase_seq_id;
        // Fallback a id si es numérico (no UUID)
        if (Number.isFinite(orderId.id)) return orderId.id;
        return null;
      }
      
      return null;
    } catch {
      return null;
    }
  },

  // Toast simple para notificaciones visuales
  _toast(message, type = 'info') {
    try {
      const colors = {
        info: { bg: '#2563eb', text: '#ffffff' },
        success: { bg: '#16a34a', text: '#ffffff' },
        warning: { bg: '#f59e0b', text: '#111827' },
        error: { bg: '#dc2626', text: '#ffffff' }
      };
      const { bg, text } = colors[type] || colors.info;
      const containerId = 'tlc-toast-container';
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.style.position = 'fixed';
        container.style.top = '16px';
        container.style.right = '16px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.style.background = bg;
      toast.style.color = text;
      toast.style.padding = '10px 14px';
      toast.style.borderRadius = '8px';
      toast.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
      toast.style.fontSize = '14px';
      toast.style.fontWeight = '600';
      toast.style.maxWidth = '340px';
      toast.style.wordBreak = 'break-word';
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 300ms ease';
        setTimeout(() => toast.remove(), 320);
      }, 3000);
    } catch (_) {
      // fallback a alert si el DOM no está listo
      try { alert(message); } catch (_) {}
    }
  },
  /**
   * Acepta una orden desde el panel del colaborador usando RPC
   */
  async acceptOrder(orderId, additionalData = {}) {
    console.log('[OrderManager] Aceptando orden', orderId);

    const normalizedId = this._normalizeOrderId(orderId);
    console.log('[OrderManager] ID normalizado para RPC:', normalizedId);

    if (!Number.isFinite(normalizedId)) {
      console.warn('[OrderManager] ID inválido para RPC accept_order; aplicando fallback...');
      this._toast('ID inválido para RPC. Aplicando fallback…', 'warning');
      return await this.actualizarEstadoPedido(orderId, 'aceptada', additionalData);
    }

    // Prevalidar que el colaborador no tenga otra orden activa
    try {
      const collabId = additionalData?.collaborator_id || null;
      if (collabId) {
        const { data: conflicts } = await supabaseConfig.client
          .from('orders')
          .select('id,status')
          .eq('assigned_to', collabId)
          .in('status', ['accepted', 'in_progress'])
          .limit(1);
        if (Array.isArray(conflicts) && conflicts.length > 0) {
          this._toast('Ya tienes una orden activa', 'error');
          return { success: false, data: null, error: 'Ya tienes una orden activa' };
        }
      }
    } catch (_) {}

    const hasPrice = typeof additionalData?.estimated_price === 'number' && !isNaN(additionalData.estimated_price);
    const fnName = 'accept_order_with_price';
    const rpcPayload = { p_order_id: normalizedId, p_price: hasPrice ? additionalData.estimated_price : null };
    console.log(`[OrderManager] RPC ${fnName} -> payload`, rpcPayload);

    try {
      const { data, error } = await supabaseConfig.client.rpc(fnName, rpcPayload);

      if (error) {
        console.error('[OrderManager] RPC error accept_order', {
          message: error.message, 
          details: error.details, 
          hint: error.hint, 
          code: error.code
        });
        const msg = String(error?.message || '');
        if (/ya tienes una orden activa/i.test(msg) || String(error?.code || '') === 'P0001') {
          this._toast('Ya tienes una orden activa', 'error');
          return { success: false, data: null, error: msg };
        }
        this._toast(`RPC error: ${error.message || 'falló'}`, 'warning');
        return { success: false, data: null, error: error.message || 'RPC falló' };
      }

      console.log('[OrderManager] RPC accept_order OK', data);
      this._toast('Orden aceptada por RPC correctamente', 'success');
      return { success: true, data, error: null };
    } catch (error) {
      console.error('[OrderManager] Exception en RPC accept_order:', error);
      this._toast(`Error inesperado: ${error.message || 'falló'}`, 'warning');
      return { success: false, data: null, error: error.message || 'Excepción RPC' };
    }
  },

  /**
   * Guarda el monto cobrado y método de pago usando RPC segura.
   * Devuelve el registro de la orden actualizado o lanza error.
   */
  async setOrderAmount(orderId, amount, method) {
    try {
      if (!supabaseConfig?.client) throw new Error('Supabase client no configurado');
      await supabaseConfig.ensureFreshSession?.();
      const { data: ord } = await supabaseConfig.client
        .from('orders')
        .select('status')
        .eq('id', Number(orderId))
        .maybeSingle();
      if (['Cancelada','Completada'].includes(String(ord?.status || '').trim())) {
        throw new Error('No se puede modificar el monto en este estado');
      }
      const rpcPayload = {
        order_id: Number(orderId),
        amount: Number(amount),
        method: method
      };
      console.debug('[OrderManager.setOrderAmount] RPC set_order_amount_admin payload:', rpcPayload);
      const { data, error } = await supabaseConfig.client.rpc('set_order_amount_admin', rpcPayload);
      if (!error && data) return data;
      console.warn('[OrderManager.setOrderAmount] RPC fallo, aplicando fallback UPDATE:', error?.message || error);
      const { data: upd, error: updErr } = await supabaseConfig.client
        .from('orders')
        .update({ monto_cobrado: Number(amount), metodo_pago: method })
        .eq('id', Number(orderId))
        .select('*')
        .maybeSingle();
      if (updErr) throw updErr;
      return upd;
    } catch (err) {
      console.error('[OrderManager.setOrderAmount] Error:', err);
      this._toast('No se pudo guardar el monto.');
      throw err;
    }
  },

   /**
    * Cancela un trabajo activo marcándolo como cancelada
    */
   async cancelActiveJob(orderId) {
     console.log(`[OrderManager] Cancelando trabajo activo #${orderId}`);
     
     return await this.actualizarEstadoPedido(orderId, 'cancelada');
   },

   /**
    * Centraliza la lógica para actualizar el estado de un pedido en Supabase.
    */
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    console.log(`[OrderManager] Iniciando actualización para orden #${orderId} a estado "${newStatus}"`);

    // ✅ CORRECCIÓN: Asegurar que la sesión esté fresca ANTES de cualquier operación.
    // Esto previene los errores 401 por token expirado.
    await supabaseConfig.ensureFreshSession();
    
    // ❌ ELIMINADO: Llamada a Edge Function 'order-event' que causaba error CORS.
    // El sistema ahora usa Triggers de Base de Datos para manejar eventos automáticamente.

    const normalizedId = this._normalizeOrderId(orderId);
    const isNumeric = Number.isFinite(normalizedId);
    const candidates = [];

    // Construir candidatos de filtro por orden de preferencia
    if (isNumeric) {
      // Primero el ID primario
      candidates.push({ col: 'id', val: normalizedId });
      // Luego secuencia de supabase si existe
      candidates.push({ col: 'supabase_seq_id', val: normalizedId });
      // Por último short_id como texto
      candidates.push({ col: 'short_id', val: String(normalizedId) });
    } else if (typeof orderId === 'string') {
      const maybeNum = Number(orderId);
      if (Number.isFinite(maybeNum)) {
        candidates.push({ col: 'id', val: maybeNum });
        candidates.push({ col: 'supabase_seq_id', val: maybeNum });
      }
      // Considerar short_id tal cual (texto)
      candidates.push({ col: 'short_id', val: orderId });
    } else if (orderId && typeof orderId === 'object') {
      if (Number.isFinite(orderId.id)) candidates.push({ col: 'id', val: orderId.id });
      if (Number.isFinite(orderId.supabase_seq_id)) candidates.push({ col: 'supabase_seq_id', val: orderId.supabase_seq_id });
      if (typeof orderId.short_id === 'string') candidates.push({ col: 'short_id', val: orderId.short_id });
    }

    console.log('[OrderManager] Candidatos de filtro:', candidates);

    // Sanitizar additionalData - solo incluir campos válidos de la tabla orders
    const allowedFields = [
      'status', 'assigned_to', 'assigned_at', 'completed_at',
      'completed_by', 'tracking_data'
    ];
    const sanitizedData = {};
    Object.keys(additionalData).forEach(key => {
      if (allowedFields.includes(key)) {
        sanitizedData[key] = additionalData[key];
      }
    });

    // Mapear collaborator_id a campos correctos según el estado
    if (additionalData.collaborator_id) {
      if (String(newStatus || '').toLowerCase() === 'entregada') {
        sanitizedData.completed_by = additionalData.collaborator_id;
      } else {
        sanitizedData.assigned_to = additionalData.collaborator_id;
      }
    }

    const updatePayload = { ...sanitizedData };

    // Lógica de negocio centralizada:
    // Mapear estados de acciones del colaborador
    const ns = String(newStatus || '').toLowerCase();
    if (UI_TO_DB_STATUS[ns]) {
      const db = UI_TO_DB_STATUS[ns];
      updatePayload.status = db;
      if (db === 'completed') updatePayload.completed_at = new Date().toISOString();
      if (db === 'accepted') updatePayload.assigned_at = new Date().toISOString();
    } else if (['completada', 'completed'].includes(ns)) {
      updatePayload.status = 'completed';
      updatePayload.completed_at = new Date().toISOString();
    } else if (['aceptada', 'accepted'].includes(ns)) {
      updatePayload.status = 'accepted';
      updatePayload.assigned_at = new Date().toISOString();
    } else if (['en curso', 'in_progress'].includes(ns)) {
      updatePayload.status = 'in_progress';
    } else if (['cancelada','cancelado', 'cancelled'].includes(ns)) {
      updatePayload.status = 'cancelled';
    } else if (['pendiente', 'pending'].includes(ns)) {
      updatePayload.status = 'pending';
    }

    // Prevalidar transición con el estado actual antes de RPC
    try {
      let pre = null;
      const nId = this._normalizeOrderId(orderId);
      if (Number.isFinite(nId)) {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status')
          .eq('id', nId)
          .maybeSingle();
        pre = data || null;
      }
      if (!pre && typeof orderId === 'string') {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status')
          .eq('short_id', orderId)
          .maybeSingle();
        pre = data || null;
      }
      if (pre) {
        const dbs = String(pre.status || '').toLowerCase();
        let phase = dbs;
        if (dbs === 'pending') phase = 'pendiente';
        else if (dbs === 'accepted') phase = 'aceptada';
        else if (dbs === 'completed') phase = 'entregada';
        else if (dbs === 'cancelled') phase = 'cancelada';
        else if (dbs === 'in_progress' || dbs === 'en curso') {
          if (Array.isArray(pre.tracking_data) && pre.tracking_data.length > 0) {
            const lt = pre.tracking_data[pre.tracking_data.length - 1];
            phase = String(lt?.ui_status || 'en_camino_recoger').toLowerCase();
          } else {
            phase = 'en_camino_recoger';
          }
        }
        const allowed = STATE_FLOW[phase] || [];
        if (ns !== 'cancelada' && ns !== 'entregada' && !allowed.includes(ns)) {
          return { success: false, error: `Transición no permitida desde "${phase}" a "${ns}"` };
        }
        if (ns === 'entregada') {
          const hasRoute = phase === 'en_camino_entregar' || (Array.isArray(pre.tracking_data) && pre.tracking_data.some(e => String(e?.ui_status || '').toLowerCase() === 'en_camino_entregar'));
          if (!hasRoute) return { success: false, error: 'No puedes completar sin pasar por "En camino a entregar"' };
        }
      }
    } catch (_) {}

    // Intentar primero vía RPC para evitar problemas de RLS en SELECT/UPDATE
    try {
      const normalizedId = this._normalizeOrderId(orderId);
      const dbStatus = UI_TO_DB_STATUS[ns] || newStatus;
      const rpcTrackingEntry = {
        ui_status: ns,
        db_status: dbStatus,
        date: new Date().toISOString(),
        description: ns === 'en_camino_recoger'
          ? 'Orden aceptada, en camino a recoger'
          : ns === 'cargando'
            ? 'Carga en proceso'
            : ns === 'en_camino_entregar'
              ? 'En ruta hacia entrega'
              : ns === 'entregada'
                ? 'Entrega completada'
                : 'Actualización de estado'
      };

      const rpcPayload = {
        order_id: normalizedId,
        new_status: ns, // ✅ CORRECCIÓN: Usar ns (siempre lowercase) en lugar de newStatus inconsistente
        collaborator_id: additionalData?.collaborator_id || null,
        tracking_entry: rpcTrackingEntry,
        extra: updatePayload
      };

      console.log('[OrderManager] Intentando RPC update_order_status ->', rpcPayload);
      const { data: rpcData, error: rpcError } = await supabaseConfig.client.rpc('update_order_status', rpcPayload);

      if (!rpcError) {
        console.log('[OrderManager] RPC update_order_status OK', rpcData);
        try { await supabaseConfig.runProcessOutbox?.(); } catch (_) {}
        return { success: true, data: rpcData, error: null };
      }

      console.warn('[OrderManager] RPC update_order_status falló, aplicando flujo directo:', {
        message: rpcError?.message, details: rpcError?.details, hint: rpcError?.hint, code: rpcError?.code
      });
      // Si falla RPC en aceptación, NO aplicar flujo directo para respetar regla de negocio
      if (ns === 'aceptada' || ns === 'accepted') {
        return { success: false, error: rpcError?.message || 'No se pudo aceptar la orden' };
      }
      // Para otros estados, continuar con el flujo directo (SELECT + UPDATE)
    } catch (rpcEx) {
      console.warn('[OrderManager] Excepción en RPC update_order_status, aplicando flujo directo:', rpcEx?.message);
      // Continuar con el flujo directo
    }

    try {
      // Obtener datos actuales probando secuencialmente los candidatos
      let usedFilter = null;
      let currentOrder = null;

      for (const cand of candidates) {
        console.log('[OrderManager] Fetch intento con:', cand);
        const { data, error } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_email')
          .eq(cand.col, cand.val)
          .maybeSingle();

        if (error) {
          console.warn('[OrderManager] No encontrado con filtro:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            filter: cand
          });
          continue;
        }

        if (data) {
          usedFilter = cand;
          currentOrder = data;
          console.log('[OrderManager] Orden encontrada con filtro:', cand, 'Datos:', data);
          break;
        }
      }

      // Si no se encontró con los candidatos principales, intentar búsqueda más amplia
      if (!currentOrder && candidates.length > 0) {
        const nId = this._normalizeOrderId(orderId);
        if (Number.isFinite(nId)) {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_email')
          .eq('id', nId)
          .maybeSingle();
          if (data) { currentOrder = data; usedFilter = { col: 'id', val: data.id }; }
        }
        if (!currentOrder && typeof orderId === 'string') {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_email')
          .eq('short_id', orderId)
          .maybeSingle();
          if (data) { currentOrder = data; usedFilter = { col: 'id', val: data.id }; }
        }
      }

      if (!currentOrder || !usedFilter) {
        console.error('[OrderManager] No se pudo encontrar la orden. Candidatos probados:', candidates);
        throw new Error(`No se encontró la orden con ID "${orderId}". Verifica que la orden existe y tienes permisos para accederla.`);
      }

      // Validar transición de estado (máquina de estados)
      const currentDbStatus = String(currentOrder.status || '').toLowerCase();
      let currentPhase = currentDbStatus;

      // Mapear status DB a fase UI
      if (currentDbStatus === 'pending') currentPhase = 'pendiente';
      else if (currentDbStatus === 'accepted') currentPhase = 'aceptada';
      else if (currentDbStatus === 'completed') currentPhase = 'entregada';
      else if (currentDbStatus === 'cancelled') currentPhase = 'cancelada';
      else if (currentDbStatus === 'in_progress' || currentDbStatus === 'en curso') {
          // Derivar sub-estado de tracking_data
          if (Array.isArray(currentOrder.tracking_data) && currentOrder.tracking_data.length > 0) {
             const lastTrack = currentOrder.tracking_data[currentOrder.tracking_data.length - 1];
             currentPhase = String(lastTrack?.ui_status || 'cargando').toLowerCase();
          } else {
             // Default para in_progress si no hay tracking
             currentPhase = 'en_camino_recoger'; // Asumir inicio de progreso
          }
      }
      const nextAllowed = STATE_FLOW[currentPhase] || [];
      
      // ✅ CORRECCIÓN: Validación más clara y explícita
      if (ns === 'cancelada') {
        // Cancelación siempre permitida desde cualquier estado
      } else if (ns === 'entregada') {
        // Entrega tiene validaciones adicionales (ver abajo)
      } else if (!nextAllowed.includes(ns)) {
        throw new Error(`Transición no permitida desde "${currentPhase}" a "${ns}". Estados permitidos: ${nextAllowed.join(', ')}`);
      }

      if (ns === 'entregada') {
        const hasRoutePhase = currentPhase === 'en_camino_entregar' || (Array.isArray(currentOrder.tracking_data) && currentOrder.tracking_data.some(e => String(e?.ui_status || '').toLowerCase() === 'en_camino_entregar'));
        const evidenceArr = Array.isArray(currentOrder.evidence_photos) ? currentOrder.evidence_photos : [];
        if (!hasRoutePhase) {
          throw new Error('No puedes completar sin pasar por "En camino a entregar"');
        }
        if (evidenceArr.length === 0) {
          throw new Error('Debes subir al menos una evidencia para completar');
        }
      }

      const dbStatus2 = UI_TO_DB_STATUS[ns] || newStatus;
      const newTrackingEntry = { 
        ui_status: ns, 
        db_status: dbStatus2,
        date: new Date().toISOString(),
        description: ns === 'en_camino_recoger'
          ? 'Orden aceptada, en camino a recoger'
          : ns === 'cargando'
            ? 'Carga en proceso'
          : ns === 'en_camino_entregar'
            ? 'En ruta hacia entrega'
          : ns === 'entregada'
            ? 'Pedido entregado'
            : undefined
      };
      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      updatePayload.tracking_data = [...currentTracking, newTrackingEntry];

      console.log('[OrderManager] Update payload:', updatePayload);

      // Realizar la actualización usando el filtro que devolvió datos
      const { error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq(usedFilter.col, usedFilter.val);

      if (updateError) {
        console.error('[OrderManager] Error al actualizar orden:', {
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code
        });
        throw new Error(`Error al actualizar en Supabase: ${updateError.message}`);
      }

      console.log(`[OrderManager] Orden #${orderId} actualizada exitosamente en la BD.`);
      try { await supabaseConfig.runProcessOutbox?.(); } catch (_) {}


      try {
        if (supabaseConfig?.client && typeof supabaseConfig.client.functions?.invoke === 'function') {
          /*
          // ❌ ELIMINADO: El frontend NO debe enviar emails.
          const toEmail = currentOrder?.client_email || currentOrder?.email || null;
          if (toEmail) {
            const resolvedId = usedFilter?.val ?? orderId;
            await supabaseConfig.client.functions.invoke('send-order-email', {
              body: {
                to: String(toEmail),
                orderId: resolvedId,
                shortId: currentOrder?.short_id || null,
                status: ns,
                name: currentOrder?.name || null
              }
            });
          }
          */
        }
      } catch (_) {}

      return { success: true, error: null };

    } catch (error) {
      console.error(`[OrderManager] Fallo completo en la actualización de la orden #${orderId}:`, error);
      // Aquí podrías notificar al usuario con un sistema de notificaciones más robusto si lo tienes.
      return { success: false, error: error.message };
    }
  }
};

async function notifyClientForOrder(orderId, newStatus) {}


// Exportar a entorno global para consumo desde panel-colaborador
try { if (typeof window !== 'undefined') { window.OrderManager = OrderManager; } } catch (_) {}
try { if (typeof globalThis !== 'undefined') { globalThis.OrderManager = OrderManager; } } catch (_) {}
try { if (typeof module === 'object' && module && module.exports) { module.exports = OrderManager; } } catch (_) {}
