// Verificar que supabaseConfig esté disponible
if (typeof supabaseConfig === 'undefined') {
  console.error('supabaseConfig no está definido. Asegúrate de incluir supabase-config.js antes de este script.');
  // Intentar cargar supabaseConfig dinámicamente si no está disponible
  document.write('<script src="/js/supabase-config.js"></script>');
}

// Inicializar iconos de Lucide
lucide.createIcons();

const businessForm = document.getElementById('businessForm');
const quotationForm = document.getElementById('quotationForm');

/**
 * Carga la configuración del negocio desde Supabase y la muestra en los formularios.
 */
async function loadSettings() {
  try {
    const settings = await supabaseConfig.getBusinessSettings();
    if (!settings) return;

    // Formulario de información del negocio
    document.getElementById('businessName').value = settings.business_name || '';
    document.getElementById('businessAddress').value = settings.address || '';
    document.getElementById('businessPhone').value = settings.phone || '';
    document.getElementById('businessEmail').value = settings.email || '';
    document.getElementById('businessRnc').value = settings.rnc || '';
    document.getElementById('businessVapidKey').value = settings.vapid_public_key || settings.push_vapid_key || '';

    // Formulario de cotización
    const rates = settings.quotation_rates || {};
    document.getElementById('baseRate').value = rates.baseRate || '';
    document.getElementById('smallTruckRate').value = rates.vehicleRates?.smallTruck || '';
    document.getElementById('pickupRate').value = rates.vehicleRates?.pickup || '';
    document.getElementById('vanRate').value = rates.vehicleRates?.van || '';
    document.getElementById('largeTruckRate').value = rates.vehicleRates?.largeTruck || '';
    document.getElementById('lightWeightRate').value = rates.weightRates?.light || '';
    document.getElementById('mediumWeightRate').value = rates.weightRates?.medium || '';
    document.getElementById('heavyWeightRate').value = rates.weightRates?.heavy || '';
    document.getElementById('veryHeavyWeightRate').value = rates.weightRates?.veryHeavy || '';
    document.getElementById('waitingRate').value = rates.additionalRates?.waiting || '';
    document.getElementById('urgentRate').value = rates.additionalRates?.urgent || '';

  } catch (error) {
    console.error("Error al cargar la configuración:", error);
    alert("No se pudo cargar la configuración del negocio.");
  }
}

// Cargar datos solo cuando el servidor confirma sesión admin
document.addEventListener('admin-session-ready', loadSettings);

// Búsqueda rápida por ID/short_id
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('businessOrderSearchInput');
  const btn = document.getElementById('businessOrderSearchBtn');
  const result = document.getElementById('businessOrderSearchResult');
  if (btn && input && result) {
    btn.addEventListener('click', async () => {
      const val = (input.value || '').trim();
      result.textContent = '';
      if (!val) { result.textContent = 'Ingresa un ID o short_id.'; return; }
      try {
        const looksLikeShortId = /^ORD-\w+/i.test(val);
        const numericId = Number(val);
        let query = supabaseConfig.client
          .from('orders')
          .select('id, short_id, name, service:services(name), status, created_at')
          .limit(1);
        if (looksLikeShortId) {
          query = query.eq('short_id', val);
        } else if (!Number.isNaN(numericId)) {
          query = query.eq('id', numericId);
        } else {
          query = query.eq('short_id', val);
        }
        const { data, error } = await query;
        if (error) throw error;
        const order = (data || [])[0];
        if (!order) { result.textContent = 'No se encontró ninguna solicitud.'; return; }
        result.innerHTML = `
          <div class="p-3 border rounded bg-gray-50">
            <div><span class="font-semibold">ID:</span> ${order.id} <span class="ml-2 text-gray-500">${order.short_id || ''}</span></div>
            <div><span class="font-semibold">Cliente:</span> ${order.name}</div>
            <div><span class="font-semibold">Servicio:</span> ${order.service?.name || 'N/A'}</div>
            <div><span class="font-semibold">Estado:</span> ${order.status}</div>
            <div><span class="font-semibold">Creado:</span> ${order.created_at ? new Date(order.created_at).toLocaleString('es-DO') : 'N/A'}</div>
          </div>
        `;
        lucide.createIcons();
      } catch (err) {
        console.error('Error buscando orden:', err);
        result.textContent = 'Error al buscar la solicitud.';
      }
    });
  }
});

// Guardar datos del negocio
businessForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const rncInput = document.getElementById('businessRnc').value || '';
  const rncClean = rncInput.replace(/\D/g, '');

  function isValidRNC(rnc) {
    // Aceptar cualquier RNC de 9 o 11 dígitos
    return /^\d{9}$/.test(rnc) || /^\d{11}$/.test(rnc);
  }

  if (rncClean && !isValidRNC(rncClean)) {
    alert(
      'RNC inválido.\n\n' +
      'El RNC debe tener 9 dígitos (empresas) o 11 dígitos (cédula).'
    );
    return;
  }

  const updates = {
    business_name: document.getElementById('businessName').value,
    address: document.getElementById('businessAddress').value,
    phone: document.getElementById('businessPhone').value,
    email: document.getElementById('businessEmail').value,
    rnc: rncClean,
    vapid_public_key: (document.getElementById('businessVapidKey').value || '').trim()
  };
  try {
    await supabaseConfig.saveBusinessSettings(updates);
    alert('Datos del negocio guardados correctamente.');
  } catch (error) {
    console.error("Error al guardar datos del negocio:", error);
    alert("Error al guardar: " + (error.message || "No se pudieron guardar los datos del negocio."));
  }
});

// Guardar configuración de cotización
quotationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const updates = {
    quotation_rates: {
      baseRate: parseFloat(document.getElementById('baseRate').value) || 0,
      vehicleRates: {
        smallTruck: parseFloat(document.getElementById('smallTruckRate').value) || 1,
        pickup: parseFloat(document.getElementById('pickupRate').value) || 1.2,
        van: parseFloat(document.getElementById('vanRate').value) || 1.3,
        largeTruck: parseFloat(document.getElementById('largeTruckRate').value) || 1.5
      },
      weightRates: {
        light: parseFloat(document.getElementById('lightWeightRate').value) || 1,
        medium: parseFloat(document.getElementById('mediumWeightRate').value) || 1.3,
        heavy: parseFloat(document.getElementById('heavyWeightRate').value) || 1.6,
        veryHeavy: parseFloat(document.getElementById('veryHeavyWeightRate').value) || 2
      },
      additionalRates: {
        waiting: parseFloat(document.getElementById('waitingRate').value) || 0,
        urgent: parseFloat(document.getElementById('urgentRate').value) || 1.5
      }
    }
  };
  try {
    await supabaseConfig.saveBusinessSettings(updates);
    alert('Configuración de cotización guardada correctamente.');
  } catch (error) {
    console.error("Error al guardar configuración de cotización:", error);
    alert("No se pudo guardar la configuración de cotización.");
  }
});
