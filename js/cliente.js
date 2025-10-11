// Cliente.js - Lógica del formulario de solicitud de servicio
class ClienteFormulario {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 6;
        this.formData = this.loadFromStorage() || {
            // Paso 1: Datos personales
            fullName: '',
            phone: '',
            email: '',
            hasRNC: false,
            companyName: '',
            rncNumber: '',
            
            // Paso 2: Servicio
            service: '',
            
            // Paso 3: Vehículo
            vehicle: '',
            
            // Paso 4: Ubicación
            pickupAddress: '',
            deliveryAddress: '',
            
            // Paso 5: Fecha y hora
            serviceDate: '',
            serviceTime: ''
        };
        
        this.stepTitles = {
            1: 'Datos Personales',
            2: 'Selección de Servicio',
            3: 'Tipo de Vehículo',
            4: 'Ubicación',
            5: 'Fecha y Hora',
            6: 'Confirmación'
        };
        
        this.stepDescriptions = {
            1: 'Ingrese sus datos personales para continuar',
            2: 'Seleccione el tipo de servicio que necesita',
            3: 'Elija el vehículo más adecuado para su servicio',
            4: 'Indique las direcciones de recogida y entrega',
            5: 'Seleccione la fecha y hora del servicio',
            6: 'Revise y confirme su solicitud'
        };
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.updateUI();
        this.loadFormData();
        this.setMinDate();
        
        // Inicializar iconos de Lucide
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
    
    bindEvents() {
        // Botones de navegación
        document.getElementById('nextBtn').addEventListener('click', () => this.nextStep());
        document.getElementById('prevBtn').addEventListener('click', () => this.prevStep());
        document.getElementById('submitBtn').addEventListener('click', () => this.submitForm());
        
        // Checkbox RNC
        document.getElementById('rncCheckbox').addEventListener('change', (e) => {
            this.formData.hasRNC = e.target.checked;
            if (e.target.checked) {
                this.showRNCModal();
            } else {
                this.formData.companyName = '';
                this.formData.rncNumber = '';
            }
            this.saveToStorage();
        });
        
        // Modal RNC
        document.getElementById('saveRNC').addEventListener('click', () => this.saveRNCData());
        document.getElementById('cancelRNC').addEventListener('click', () => this.cancelRNC());
        
        // Tarjetas de servicio
        document.querySelectorAll('.service-card').forEach(card => {
            card.addEventListener('click', () => this.selectService(card));
        });
        
        // Tarjetas de vehículo
        document.querySelectorAll('.vehicle-card').forEach(card => {
            card.addEventListener('click', () => this.selectVehicle(card));
        });
        
        // Campos de formulario - auto-guardado
        this.bindFormFields();
        
        // Modal de éxito
        document.getElementById('closeSuccess').addEventListener('click', () => this.closeSuccessModal());
        document.getElementById('downloadApp').addEventListener('click', () => this.downloadApp());
        
        // Validación en tiempo real
        this.bindRealTimeValidation();
    }
    
    bindFormFields() {
        const fields = ['fullName', 'phone', 'email', 'pickupAddress', 'deliveryAddress', 'serviceDate', 'serviceTime'];
        
        fields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', (e) => {
                    this.formData[fieldId] = e.target.value;
                    this.saveToStorage();
                    this.clearFieldError(fieldId);
                });
            }
        });
    }
    
    bindRealTimeValidation() {
        // Validación de RNC en tiempo real
        const rncField = document.getElementById('rncNumber');
        if (rncField) {
            rncField.addEventListener('input', (e) => {
                const value = e.target.value.replace(/\D/g, ''); // Solo números
                e.target.value = value;
                if (value.length !== 9 && value.length > 0) {
                    this.showFieldError('rncNumber', 'El RNC debe tener exactamente 9 dígitos');
                } else {
                    this.clearFieldError('rncNumber');
                }
            });
        }
        
        // Validación de teléfono
        const phoneField = document.getElementById('phone');
        if (phoneField) {
            phoneField.addEventListener('input', (e) => {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length >= 10) {
                    value = value.substring(0, 10);
                    const formatted = `(${value.substring(0, 3)}) ${value.substring(3, 6)}-${value.substring(6)}`;
                    e.target.value = formatted;
                }
            });
        }
        
        // Validación de email
        const emailField = document.getElementById('email');
        if (emailField) {
            emailField.addEventListener('blur', (e) => {
                const email = e.target.value;
                if (email && !this.isValidEmail(email)) {
                    this.showFieldError('email', 'Ingrese un email válido');
                } else {
                    this.clearFieldError('email');
                }
            });
        }
    }
    
    nextStep() {
        if (this.validateCurrentStep()) {
            if (this.currentStep < this.totalSteps) {
                this.currentStep++;
                this.updateUI();
                this.saveToStorage();
            }
        }
    }
    
    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateUI();
        }
    }
    
    validateCurrentStep() {
        this.clearAllErrors();
        let isValid = true;
        
        switch (this.currentStep) {
            case 1:
                isValid = this.validateStep1();
                break;
            case 2:
                isValid = this.validateStep2();
                break;
            case 3:
                isValid = this.validateStep3();
                break;
            case 4:
                isValid = this.validateStep4();
                break;
            case 5:
                isValid = this.validateStep5();
                break;
        }
        
        return isValid;
    }
    
    validateStep1() {
        let isValid = true;
        
        const fullName = document.getElementById('fullName').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const email = document.getElementById('email').value.trim();
        
        if (!fullName) {
            this.showFieldError('fullName', 'El nombre completo es requerido');
            isValid = false;
        }
        
        if (!phone) {
            this.showFieldError('phone', 'El teléfono es requerido');
            isValid = false;
        } else if (phone.replace(/\D/g, '').length < 10) {
            this.showFieldError('phone', 'Ingrese un teléfono válido');
            isValid = false;
        }
        
        if (!email) {
            this.showFieldError('email', 'El email es requerido');
            isValid = false;
        } else if (!this.isValidEmail(email)) {
            this.showFieldError('email', 'Ingrese un email válido');
            isValid = false;
        }
        
        // Validar RNC si está marcado
        if (this.formData.hasRNC) {
            if (!this.formData.companyName || !this.formData.rncNumber) {
                alert('Debe completar los datos de la empresa antes de continuar');
                isValid = false;
            }
        }
        
        return isValid;
    }
    
    validateStep2() {
        if (!this.formData.service) {
            this.showStepError(2, 'Debe seleccionar al menos un servicio');
            return false;
        }
        return true;
    }
    
    validateStep3() {
        if (!this.formData.vehicle) {
            this.showStepError(3, 'Debe seleccionar un tipo de vehículo');
            return false;
        }
        return true;
    }
    
    validateStep4() {
        let isValid = true;
        
        const pickup = document.getElementById('pickupAddress').value.trim();
        const delivery = document.getElementById('deliveryAddress').value.trim();
        
        if (!pickup) {
            this.showFieldError('pickupAddress', 'La dirección de recogida es requerida');
            isValid = false;
        }
        
        if (!delivery) {
            this.showFieldError('deliveryAddress', 'La dirección de entrega es requerida');
            isValid = false;
        }
        
        return isValid;
    }
    
    validateStep5() {
        let isValid = true;
        
        const date = document.getElementById('serviceDate').value;
        const time = document.getElementById('serviceTime').value;
        
        if (!date) {
            this.showFieldError('serviceDate', 'La fecha es requerida');
            isValid = false;
        } else {
            const selectedDate = new Date(date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (selectedDate < today) {
                this.showFieldError('serviceDate', 'No puede seleccionar una fecha anterior a hoy');
                isValid = false;
            }
        }
        
        if (!time) {
            this.showFieldError('serviceTime', 'La hora es requerida');
            isValid = false;
        }
        
        return isValid;
    }
    
    updateUI() {
        // Actualizar número de paso
        document.getElementById('currentStepNumber').textContent = this.currentStep;
        
        // Actualizar título y descripción
        document.getElementById('stepTitle').textContent = this.stepTitles[this.currentStep];
        document.getElementById('stepDescription').textContent = this.stepDescriptions[this.currentStep];
        
        // Actualizar barra de progreso
        const progressPercentage = (this.currentStep / this.totalSteps) * 100;
        document.getElementById('progress-bar').style.width = `${progressPercentage}%`;
        
        // Actualizar indicadores de paso
        for (let i = 1; i <= this.totalSteps; i++) {
            const stepElement = document.getElementById(`step-${i}`);
            stepElement.classList.remove('active', 'completed');
            
            if (i < this.currentStep) {
                stepElement.classList.add('completed');
            } else if (i === this.currentStep) {
                stepElement.classList.add('active');
            }
        }
        
        // Mostrar/ocultar contenido de pasos
        document.querySelectorAll('.step-content').forEach((step, index) => {
            if (index + 1 === this.currentStep) {
                step.classList.remove('hidden');
                step.classList.add('fade-in');
            } else {
                step.classList.add('hidden');
                step.classList.remove('fade-in');
            }
        });
        
        // Actualizar botones de navegación
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const submitBtn = document.getElementById('submitBtn');
        
        if (this.currentStep === 1) {
            prevBtn.classList.add('hidden');
        } else {
            prevBtn.classList.remove('hidden');
        }
        
        if (this.currentStep === this.totalSteps) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
            this.updateSummary();
        } else {
            nextBtn.classList.remove('hidden');
            submitBtn.classList.add('hidden');
        }
        
        // Reinicializar iconos de Lucide
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
    
    selectService(card) {
        // Remover selección previa
        document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
        
        // Seleccionar nueva tarjeta
        card.classList.add('selected');
        this.formData.service = card.dataset.service;
        this.saveToStorage();
        this.clearStepError(2);
    }
    
    selectVehicle(card) {
        // Remover selección previa (solo una selección permitida)
        document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('selected'));
        
        // Seleccionar nueva tarjeta
        card.classList.add('selected');
        this.formData.vehicle = card.dataset.vehicle;
        this.saveToStorage();
        this.clearStepError(3);
    }
    
    showRNCModal() {
        const modal = document.getElementById('rncModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Cargar datos existentes si los hay
        if (this.formData.companyName) {
            document.getElementById('companyName').value = this.formData.companyName;
        }
        if (this.formData.rncNumber) {
            document.getElementById('rncNumber').value = this.formData.rncNumber;
        }
    }
    
    saveRNCData() {
        const companyName = document.getElementById('companyName').value.trim();
        const rncNumber = document.getElementById('rncNumber').value.trim();
        
        let isValid = true;
        
        if (!companyName) {
            this.showFieldError('companyName', 'El nombre de la empresa es requerido');
            isValid = false;
        }
        
        if (!rncNumber) {
            this.showFieldError('rncNumber', 'El RNC es requerido');
            isValid = false;
        } else if (rncNumber.length !== 9) {
            this.showFieldError('rncNumber', 'El RNC debe tener exactamente 9 dígitos');
            isValid = false;
        }
        
        if (isValid) {
            this.formData.companyName = companyName;
            this.formData.rncNumber = rncNumber;
            this.saveToStorage();
            this.hideRNCModal();
        }
    }
    
    cancelRNC() {
        document.getElementById('rncCheckbox').checked = false;
        this.formData.hasRNC = false;
        this.formData.companyName = '';
        this.formData.rncNumber = '';
        this.saveToStorage();
        this.hideRNCModal();
    }
    
    hideRNCModal() {
        const modal = document.getElementById('rncModal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        this.clearFieldError('companyName');
        this.clearFieldError('rncNumber');
    }
    
    updateSummary() {
        // Datos del cliente
        document.getElementById('summaryName').textContent = this.formData.fullName;
        document.getElementById('summaryPhone').textContent = this.formData.phone;
        document.getElementById('summaryEmail').textContent = this.formData.email;
        
        // Datos RNC
        const rncSection = document.getElementById('summaryRNC');
        if (this.formData.hasRNC && this.formData.companyName) {
            document.getElementById('summaryCompany').textContent = this.formData.companyName;
            document.getElementById('summaryRNCNumber').textContent = this.formData.rncNumber;
            rncSection.classList.remove('hidden');
        } else {
            rncSection.classList.add('hidden');
        }
        
        // Detalles del servicio
        document.getElementById('summaryService').textContent = this.formData.service;
        document.getElementById('summaryVehicle').textContent = this.formData.vehicle;
        document.getElementById('summaryDate').textContent = this.formatDate(this.formData.serviceDate);
        document.getElementById('summaryTime').textContent = this.formatTime(this.formData.serviceTime);
        
        // Ubicaciones
        document.getElementById('summaryPickup').textContent = this.formData.pickupAddress;
        document.getElementById('summaryDelivery').textContent = this.formData.deliveryAddress;
    }
    
    submitForm() {
        // Simular envío de datos
        this.showSuccessModal();
        
        // Aquí se integraría con Supabase o backend
        console.log('Datos del formulario:', this.formData);
        
        // Limpiar localStorage después del envío exitoso
        this.clearStorage();
    }
    
    showSuccessModal() {
        const modal = document.getElementById('successModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    
    closeSuccessModal() {
        const modal = document.getElementById('successModal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        
        // Reiniciar formulario
        this.resetForm();
    }
    
    downloadApp() {
        // Detectar dispositivo y redirigir a la tienda correspondiente
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        
        if (/android/i.test(userAgent)) {
            window.open('https://play.google.com/store', '_blank');
        } else if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
            window.open('https://apps.apple.com/', '_blank');
        } else {
            alert('Descargue nuestra app desde Google Play Store o App Store');
        }
    }
    
    resetForm() {
        this.currentStep = 1;
        this.formData = {
            fullName: '', phone: '', email: '', hasRNC: false,
            companyName: '', rncNumber: '', service: '', vehicle: '',
            pickupAddress: '', deliveryAddress: '', serviceDate: '', serviceTime: ''
        };
        
        // Limpiar formulario
        document.querySelectorAll('input, select').forEach(field => {
            if (field.type === 'checkbox') {
                field.checked = false;
            } else {
                field.value = '';
            }
        });
        
        // Limpiar selecciones
        document.querySelectorAll('.service-card, .vehicle-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        this.updateUI();
        this.setMinDate();
    }
    
    loadFormData() {
        // Cargar datos en los campos
        Object.keys(this.formData).forEach(key => {
            const field = document.getElementById(key);
            if (field && this.formData[key]) {
                if (field.type === 'checkbox') {
                    field.checked = this.formData[key];
                } else {
                    field.value = this.formData[key];
                }
            }
        });
        
        // Restaurar selecciones de tarjetas
        if (this.formData.service) {
            const serviceCard = document.querySelector(`[data-service="${this.formData.service}"]`);
            if (serviceCard) serviceCard.classList.add('selected');
        }
        
        if (this.formData.vehicle) {
            const vehicleCard = document.querySelector(`[data-vehicle="${this.formData.vehicle}"]`);
            if (vehicleCard) vehicleCard.classList.add('selected');
        }
    }
    
    setMinDate() {
        const today = new Date().toISOString().split('T')[0];
        const dateField = document.getElementById('serviceDate');
        if (dateField) {
            dateField.min = today;
        }
    }
    
    // Utilidades de validación
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    formatTime(timeString) {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    }
    
    // Manejo de errores
    showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const errorDiv = field?.parentElement?.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }
        if (field) {
            field.classList.add('border-red-500');
        }
    }
    
    clearFieldError(fieldId) {
        const field = document.getElementById(fieldId);
        const errorDiv = field?.parentElement?.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
        if (field) {
            field.classList.remove('border-red-500');
        }
    }
    
    showStepError(stepNumber, message) {
        const step = document.getElementById(`step${stepNumber}`);
        const errorDiv = step?.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }
    }
    
    clearStepError(stepNumber) {
        const step = document.getElementById(`step${stepNumber}`);
        const errorDiv = step?.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }
    
    clearAllErrors() {
        document.querySelectorAll('.error-message').forEach(error => {
            error.classList.add('hidden');
        });
        document.querySelectorAll('input, select').forEach(field => {
            field.classList.remove('border-red-500');
        });
    }
    
    // LocalStorage
    saveToStorage() {
        try {
            localStorage.setItem('tlc_cliente_form', JSON.stringify({
                ...this.formData,
                currentStep: this.currentStep,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.warn('No se pudo guardar en localStorage:', error);
        }
    }
    
    loadFromStorage() {
        try {
            const saved = localStorage.getItem('tlc_cliente_form');
            if (saved) {
                const data = JSON.parse(saved);
                // Verificar que los datos no sean muy antiguos (24 horas)
                if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
                    this.currentStep = data.currentStep || 1;
                    return data;
                }
            }
        } catch (error) {
            console.warn('No se pudo cargar desde localStorage:', error);
        }
        return null;
    }
    
    clearStorage() {
        try {
            localStorage.removeItem('tlc_cliente_form');
        } catch (error) {
            console.warn('No se pudo limpiar localStorage:', error);
        }
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    window.clienteForm = new ClienteFormulario();
});

// Integración con Google Maps (placeholder)
function initMap() {
    // Esta función se llamará cuando se cargue la API de Google Maps
    console.log('Google Maps API cargada - implementar integración');
}

// Prevenir pérdida de datos al salir
window.addEventListener('beforeunload', function(e) {
    if (window.clienteForm && window.clienteForm.currentStep > 1) {
        e.preventDefault();
        e.returnValue = '¿Está seguro de que desea salir? Se perderán los datos no guardados.';
    }
});