// Google Sheets Integration for TLC Transport Services
class GoogleSheetsIntegration {
    constructor() {
        // Google Apps Script Web App URL - Replace with your actual deployment URL
        this.webAppUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
        this.isEnabled = true; // Set to false to disable Google Sheets integration
    }

    /**
     * Send order data to Google Sheets
     * @param {Object} orderData - The order data to send
     * @returns {Promise<boolean>} - Success status
     */
    async sendOrderToSheets(orderData) {
        if (!this.isEnabled) {
            console.log('Google Sheets integration is disabled');
            return false;
        }

        try {
            // Prepare data for Google Sheets
            const sheetsData = this.formatDataForSheets(orderData);
            
            // Send data to Google Apps Script
            const response = await fetch(this.webAppUrl, {
                method: 'POST',
                mode: 'no-cors', // Required for Google Apps Script
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(sheetsData)
            });

            console.log('Data sent to Google Sheets successfully');
            return true;

        } catch (error) {
            console.error('Error sending data to Google Sheets:', error);
            return false;
        }
    }

    /**
     * Format order data for Google Sheets
     * @param {Object} orderData - Raw order data
     * @returns {Object} - Formatted data for sheets
     */
    formatDataForSheets(orderData) {
        const mudanzaSummary = this.formatMudanzaItemsSummary(orderData?.serviceDetails?.mudanza);
        return {
            // Orden y tiempo
            orderId: orderData.id || '',
            timestamp: new Date().toLocaleString('es-DO'),
            orderType: orderData.orderType || 'ORDEN REGULAR',
            
            // Cliente
            clientName: orderData.clientName || '',
            clientPhone: orderData.clientPhone || '',
            clientEmail: orderData.clientEmail || '',
            
            // Servicio
            service: orderData.service || '',
            vehicle: orderData.vehicle || '',
            serviceDescription: orderData.serviceDescription || '',
            serviceDetails: this.formatServiceDetails(orderData.serviceDetails),
            mudanza_items_summary: mudanzaSummary,
            
            // Ubicación y agenda
            pickupAddress: orderData.pickupAddress || '',
            deliveryAddress: orderData.deliveryAddress || '',
            serviceDate: orderData.serviceDate || '',
            serviceTime: orderData.serviceTime || '',
            
            // Estado
            status: orderData.status || 'Pendiente',
            
            // RNC (opcional)
            rncNumber: orderData.rncData?.rncNumber || '',
            companyName: orderData.rncData?.companyName || '',
            
            // Metadatos
            createdAt: orderData.createdAt || new Date().toISOString()
        };
    }

    /**
     * Format service-specific details into a readable string
     * @param {Object} serviceDetails - Service-specific details
     * @returns {string} - Formatted details string
     */
    formatServiceDetails(serviceDetails) {
        if (!serviceDetails || typeof serviceDetails !== 'object') {
            return '';
        }

        const details = [];
        
        // Format different service types
        if (serviceDetails.mudanza) {
            const m = serviceDetails.mudanza;
            details.push(`Mudanza: ${m.tipoVivienda || ''}`);
            if (m.tieneElevador) details.push('Con elevador');
            if (m.necesitaEmbalaje) details.push('Necesita embalaje');
            if (m.articulosFragiles) details.push('Artículos frágiles');
            if (m.descripcion) details.push(`Descripción: ${m.descripcion}`);
        }

        if (serviceDetails.cargaComercial) {
            const c = serviceDetails.cargaComercial;
            details.push(`Carga Comercial: ${c.tipoCarga || ''}`);
            if (c.peso) details.push(`Peso: ${c.peso} kg`);
            if (c.descripcion) details.push(`Descripción: ${c.descripcion}`);
        }

        if (serviceDetails.paqueteria) {
            const p = serviceDetails.paqueteria;
            details.push(`Paquetería: ${p.tipoPaquete || ''}`);
            if (p.peso) details.push(`Peso: ${p.peso} kg`);
            if (p.dimensiones) details.push(`Dimensiones: ${p.dimensiones}`);
            if (p.descripcion) details.push(`Descripción: ${p.descripcion}`);
        }

        if (serviceDetails.botesMineros) {
            const b = serviceDetails.botesMineros;
            details.push(`Botes Mineros: ${b.tipoMaterial || ''}`);
            if (b.cantidad) details.push(`Cantidad: ${b.cantidad}`);
            if (b.descripcion) details.push(`Descripción: ${b.descripcion}`);
        }

        if (serviceDetails.gruas) {
            const g = serviceDetails.gruas;
            details.push(`Grúas: ${g.tipoServicio || ''}`);
            if (g.estadoVehiculo) details.push(`Estado: ${g.estadoVehiculo}`);
            if (g.tipoMaquinaria) details.push(`Maquinaria: ${g.tipoMaquinaria}`);
            if (g.pesoMaquinaria) details.push(`Peso: ${g.pesoMaquinaria} ton`);
            if (g.descripcion) details.push(`Descripción: ${g.descripcion}`);
        }

        return details.join(' | ');
    }

    /**
     * Crea un resumen compacto de artículos de mudanza
     * @param {Object} mudanza - Detalles específicos de mudanza
     * @returns {string}
     */
    formatMudanzaItemsSummary(mudanza) {
        if (!mudanza || typeof mudanza !== 'object') return '';
        const items = Array.isArray(mudanza.items) ? mudanza.items : [];
        const base = [];
        if (mudanza.tipoVivienda) base.push(mudanza.tipoVivienda);
        if (mudanza.tieneElevador) base.push('Elevador');
        if (mudanza.necesitaEmbalaje) base.push('Embalaje');
        if (mudanza.articulosFragiles) base.push('Frágiles');
        const itemsStr = items.map(i => {
            if (typeof i === 'string') return i;
            if (i && typeof i === 'object') {
                const name = i.nombre || i.name || 'Artículo';
                const qty = i.cantidad || i.qty || 1;
                return `${name} x${qty}`;
            }
            return String(i);
        }).join(', ');
        return [base.join(' | '), itemsStr].filter(Boolean).join(' | ');
    }

    /**
     * Test the Google Sheets connection
     * @returns {Promise<boolean>} - Connection status
     */
    async testConnection() {
        try {
            const testData = {
                orderId: 'TEST-001',
                orderType: 'TEST ORDER',
                timestamp: new Date().toLocaleString('es-DO'),
                clientName: 'Test Client',
                service: 'Test Service',
                status: 'Test'
            };

            const success = await this.sendOrderToSheets(testData);
            return success;
        } catch (error) {
            console.error('Google Sheets connection test failed:', error);
            return false;
        }
    }

    /**
     * Enable or disable Google Sheets integration
     * @param {boolean} enabled - Whether to enable the integration
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log(`Google Sheets integration ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Update the Google Apps Script Web App URL
     * @param {string} url - New Web App URL
     */
    setWebAppUrl(url) {
        this.webAppUrl = url;
        console.log('Google Sheets Web App URL updated');
    }
}

// Create global instance
const googleSheetsIntegration = new GoogleSheetsIntegration();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoogleSheetsIntegration;
}