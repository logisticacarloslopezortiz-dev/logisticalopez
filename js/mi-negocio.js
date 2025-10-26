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

// Cargar datos al iniciar
document.addEventListener('DOMContentLoaded', loadSettings);

// Guardar datos del negocio
businessForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const updates = {
    business_name: document.getElementById('businessName').value,
    address: document.getElementById('businessAddress').value,
    phone: document.getElementById('businessPhone').value,
    email: document.getElementById('businessEmail').value,
    rnc: document.getElementById('businessRnc').value
  };
  try {
    await supabaseConfig.saveBusinessSettings(updates);
    alert('Datos del negocio guardados correctamente.');
  } catch (error) {
    console.error("Error al guardar datos del negocio:", error);
    alert("No se pudieron guardar los datos del negocio.");
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