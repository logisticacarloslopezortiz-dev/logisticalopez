// Sistema de Notificaciones en Tiempo Real

class NotificationSystem {
    constructor() {
        this.container = null;
        this.notifications = [];
        this.init();
    }

    init() {
        // Crear contenedor de notificaciones
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        this.container.className = 'fixed top-4 right-4 z-50 space-y-3 max-w-sm';
        document.body.appendChild(this.container);

        // Estilos CSS
        this.injectStyles();
    }

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .notification {
                transform: translateX(100%);
                transition: all 0.3s ease-in-out;
                opacity: 0;
            }
            
            .notification.show {
                transform: translateX(0);
                opacity: 1;
            }
            
            .notification.hide {
                transform: translateX(100%);
                opacity: 0;
            }
            
            .notification-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: rgba(255, 255, 255, 0.3);
                transition: width linear;
            }
            
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-5px); }
                75% { transform: translateX(5px); }
            }
            
            .notification.shake {
                animation: shake 0.5s ease-in-out;
            }
        `;
        document.head.appendChild(style);
    }

    show(message, type = 'info', duration = 5000, options = {}) {
        const notification = this.createNotification(message, type, duration, options);
        this.container.appendChild(notification.element);
        this.notifications.push(notification);

        // Mostrar notificación
        setTimeout(() => {
            notification.element.classList.add('show');
        }, 100);

        // Auto-ocultar si tiene duración
        if (duration > 0) {
            notification.timer = setTimeout(() => {
                this.hide(notification.id);
            }, duration);

            // Barra de progreso
            if (options.showProgress !== false) {
                this.startProgress(notification, duration);
            }
        }

        return notification.id;
    }

    createNotification(message, type, duration, options) {
        const id = 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const typeConfig = {
            success: {
                bg: 'bg-green-500',
                icon: 'check-circle',
                title: 'Éxito'
            },
            error: {
                bg: 'bg-red-500',
                icon: 'x-circle',
                title: 'Error'
            },
            warning: {
                bg: 'bg-yellow-500',
                icon: 'alert-triangle',
                title: 'Advertencia'
            },
            info: {
                bg: 'bg-blue-500',
                icon: 'info',
                title: 'Información'
            }
        };

        const config = typeConfig[type] || typeConfig.info;
        const title = options.title || config.title;

        const element = document.createElement('div');
        element.className = `notification ${config.bg} text-white p-4 rounded-lg shadow-lg relative overflow-hidden max-w-sm`;
        element.setAttribute('data-id', id);

        element.innerHTML = `
            <div class="flex items-start space-x-3">
                <i data-lucide="${config.icon}" class="w-5 h-5 mt-0.5 flex-shrink-0"></i>
                <div class="flex-1 min-w-0">
                    <div class="font-semibold text-sm">${title}</div>
                    <div class="text-sm opacity-90 mt-1 ${options.isCopyable ? 'select-all' : ''}">${message}</div>
                    ${options.copyText ? `
                        <button class="mt-2 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors" onclick="notifications.copyAndContinue('${id}', '${options.copyText}')">Copiar ID y Continuar</button>
                    ` : ''}
                    ${options.actions ? this.createActions(options.actions, id) : ''}
                </div>
                <button class="notification-close ml-2 p-1 hover:bg-white/20 rounded" onclick="notifications.hide('${id}')">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>
            ${duration > 0 && options.showProgress !== false ? '<div class="notification-progress"></div>' : ''}
        `;

        // Inicializar iconos de Lucide
        setTimeout(() => {
            if (window.lucide) {
                lucide.createIcons({ nameAttr: 'data-lucide' });
            }
        }, 0);

        return {
            id,
            element,
            type,
            timer: null,
            progressTimer: null,
            onCopy: options.onCopy
        };
    }

    createActions(actions, notificationId) {
        return `
            <div class="mt-3 flex space-x-2">
                ${actions.map(action => `
                    <button 
                        class="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
                        onclick="${action.handler}; notifications.hide('${notificationId}')"
                    >
                        ${action.text}
                    </button>
                `).join('')}
            </div>
        `;
    }

    startProgress(notification, duration) {
        const progressBar = notification.element.querySelector('.notification-progress');
        if (!progressBar) return;

        progressBar.style.width = '100%';
        
        setTimeout(() => {
            progressBar.style.width = '0%';
            progressBar.style.transitionDuration = duration + 'ms';
        }, 100);
    }

    hide(id) {
        const notification = this.notifications.find(n => n.id === id);
        if (!notification) return;

        // Limpiar timers
        if (notification.timer) {
            clearTimeout(notification.timer);
        }
        if (notification.progressTimer) {
            clearTimeout(notification.progressTimer);
        }

        // Animar salida
        notification.element.classList.add('hide');
        notification.element.classList.remove('show');

        // Remover del DOM
        setTimeout(() => {
            if (notification.element.parentNode) {
                notification.element.parentNode.removeChild(notification.element);
            }
            this.notifications = this.notifications.filter(n => n.id !== id);
        }, 300);
    }

    hideAll() {
        this.notifications.forEach(notification => {
            this.hide(notification.id);
        });
    }

    copyAndContinue(id, textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            const notification = this.notifications.find(n => n.id === id);
            if (notification) {
                // Actualizar el botón para dar feedback
                const copyButton = notification.element.querySelector('button[onclick*="copyAndContinue"]');
                if (copyButton) {
                    copyButton.textContent = '¡ID Copiado!';
                    copyButton.disabled = true;
                }
                // Ejecutar la función de continuación después de un breve retraso
                if (typeof notification.onCopy === 'function') {
                    setTimeout(notification.onCopy, 500);
                }
            }
        }).catch(err => console.error('Error al copiar:', err));
    }
    // Métodos de conveniencia
    success(message, options = {}) {
        return this.show(message, 'success', options.duration || 4000, options);
    }

    error(message, options = {}) {
        return this.show(message, 'error', options.duration || 6000, options);
    }

    warning(message, options = {}) {
        return this.show(message, 'warning', options.duration || 5000, options);
    }

    info(message, options = {}) {
        return this.show(message, 'info', options.duration || 4000, options);
    }

    // Notificación persistente (sin auto-ocultar)
    persistent(message, type = 'info', options = {}) {
        return this.show(message, type, 0, options);
    }

    // Notificación con confirmación
    confirm(message, onConfirm, onCancel = null, options = {}) {
        const actions = [
            {
                text: 'Confirmar',
                handler: `(${onConfirm.toString()})()`
            },
            {
                text: 'Cancelar',
                handler: onCancel ? `(${onCancel.toString()})()` : 'void(0)'
            }
        ];

        return this.show(message, 'warning', 0, {
            ...options,
            actions,
            title: options.title || 'Confirmación'
        });
    }

    // Notificación de carga
    loading(message, options = {}) {
        const element = document.createElement('div');
        element.className = 'notification bg-gray-700 text-white p-4 rounded-lg shadow-lg relative overflow-hidden max-w-sm';
        
        const id = 'loading_' + Date.now();
        element.setAttribute('data-id', id);

        element.innerHTML = `
            <div class="flex items-center space-x-3">
                <div class="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                <div class="flex-1">
                    <div class="font-semibold text-sm">${options.title || 'Cargando...'}</div>
                    <div class="text-sm opacity-90 mt-1">${message}</div>
                </div>
            </div>
        `;

        this.container.appendChild(element);
        
        setTimeout(() => {
            element.classList.add('show');
        }, 100);

        const notification = {
            id,
            element,
            type: 'loading',
            timer: null,
            progressTimer: null
        };

        this.notifications.push(notification);
        return id;
    }

    // Actualizar notificación de carga
    updateLoading(id, message, options = {}) {
        const notification = this.notifications.find(n => n.id === id);
        if (!notification || notification.type !== 'loading') return;

        const messageElement = notification.element.querySelector('.text-sm.opacity-90');
        if (messageElement) {
            messageElement.textContent = message;
        }

        if (options.title) {
            const titleElement = notification.element.querySelector('.font-semibold');
            if (titleElement) {
                titleElement.textContent = options.title;
            }
        }
    }
}

// Instancia global
const notifications = new NotificationSystem();

// Funciones de conveniencia globales
window.showNotification = (message, type, duration, options) => notifications.show(message, type, duration, options);
window.showSuccess = (message, options) => notifications.success(message, options);
window.showError = (message, options) => notifications.error(message, options);
window.showWarning = (message, options) => notifications.warning(message, options);
window.showInfo = (message, options) => notifications.info(message, options);
window.showConfirm = (message, onConfirm, onCancel, options) => notifications.confirm(message, onConfirm, onCancel, options);
window.showLoading = (message, options) => notifications.loading(message, options);
window.updateLoading = (id, message, options) => notifications.updateLoading(id, message, options);
window.hideNotification = (id) => notifications.hide(id);
window.hideAllNotifications = () => notifications.hideAll();

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotificationSystem;
}