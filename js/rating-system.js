// Sistema de valoración para servicios finalizados
const ratingSystem = {
  init() {
    // Crear el modal de valoración si no existe
    if (!document.getElementById('ratingModal')) {
      const modal = document.createElement('div');
      modal.id = 'ratingModal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center hidden';
      modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden transform transition-all">
          <div class="p-6">
            <h3 class="text-xl font-bold text-gray-900 mb-4">¿Cómo calificarías tu servicio?</h3>
            <p class="text-gray-600 mb-6">Tu opinión nos ayuda a mejorar nuestros servicios.</p>
            
            <div class="flex justify-center mb-6 stars-container">
              <button class="star-btn text-4xl text-gray-300 hover:text-yellow-400" data-rating="1">★</button>
              <button class="star-btn text-4xl text-gray-300 hover:text-yellow-400" data-rating="2">★</button>
              <button class="star-btn text-4xl text-gray-300 hover:text-yellow-400" data-rating="3">★</button>
              <button class="star-btn text-4xl text-gray-300 hover:text-yellow-400" data-rating="4">★</button>
              <button class="star-btn text-4xl text-gray-300 hover:text-yellow-400" data-rating="5">★</button>
            </div>
            
            <div class="mb-4">
              <label for="ratingComment" class="block text-sm font-medium text-gray-700 mb-1">Comentarios (opcional)</label>
              <textarea id="ratingComment" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
            
            <div class="flex justify-end gap-3">
              <button id="cancelRating" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500">Cancelar</button>
              <button id="submitRating" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500" disabled>Enviar valoración</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      // Agregar estilos para animación de estrellas
      const style = document.createElement('style');
      style.textContent = `
        .stars-container .star-btn {
          transition: all 0.2s ease;
          transform-origin: center;
        }
        .stars-container .star-btn:hover {
          transform: scale(1.2);
        }
        .stars-container .star-btn.active {
          color: #FBBF24;
          transform: scale(1.1);
        }
        @keyframes thankYouFadeIn {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .thank-you-animation {
          animation: thankYouFadeIn 0.5s ease forwards;
        }
      `;
      document.head.appendChild(style);
      
      // Configurar eventos
      this.setupEvents();
    }
  },
  
  setupEvents() {
    const modal = document.getElementById('ratingModal');
    const starButtons = modal.querySelectorAll('.star-btn');
    const submitButton = document.getElementById('submitRating');
    const cancelButton = document.getElementById('cancelRating');
    
    // Manejar clics en estrellas
    starButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const rating = parseInt(btn.dataset.rating);
        this.currentRating = rating;
        
        // Actualizar apariencia de estrellas
        starButtons.forEach(star => {
          const starRating = parseInt(star.dataset.rating);
          if (starRating <= rating) {
            star.classList.add('active');
          } else {
            star.classList.remove('active');
          }
        });
        
        // Habilitar botón de envío
        submitButton.disabled = false;
      });
    });
    
    // Manejar envío de valoración
    submitButton.addEventListener('click', () => {
      const comment = document.getElementById('ratingComment').value;
      this.saveRating(comment);
    });
    
    // Manejar cancelación
    cancelButton.addEventListener('click', () => {
      this.hideModal();
    });
  },
  
  showModal(order) {
    this.init();
    this.currentOrder = order;
    this.currentRating = 0;
    
    // Resetear estado del modal
    const modal = document.getElementById('ratingModal');
    const starButtons = modal.querySelectorAll('.star-btn');
    starButtons.forEach(star => star.classList.remove('active'));
    document.getElementById('ratingComment').value = '';
    document.getElementById('submitRating').disabled = true;
    
    // Mostrar modal
    modal.classList.remove('hidden');
  },
  
  hideModal() {
    const modal = document.getElementById('ratingModal');
    modal.classList.add('hidden');
  },
  
  async saveRating(comment) {
    if (!this.currentOrder || !this.currentRating) return;

    try {
      const { data, error } = await supabaseConfig.client
        .from('orders')
        .update({
          rating: this.currentRating,
          rating_comment: comment
        })
        .eq('id', this.currentOrder.id);

      if (error) {
        throw error;
      }

      // Si la actualización es exitosa, mostrar mensaje de agradecimiento
      this.showThankYouMessage();

    } catch (error) {
      console.error('Error al guardar la calificación:', error);
      // Aquí podrías mostrar una notificación de error al usuario
      alert('No se pudo guardar tu calificación. Por favor, inténtalo de nuevo.');
    }
  },
  
  showThankYouMessage() {
    const modal = document.getElementById('ratingModal');
    const modalContent = modal.querySelector('div > div');
    
    // Guardar altura actual para mantener tamaño del modal
    const currentHeight = modalContent.offsetHeight;
    modalContent.style.minHeight = `${currentHeight}px`;
    
    // Reemplazar contenido con mensaje de agradecimiento
    modalContent.innerHTML = `
      <div class="p-6 text-center thank-you-animation">
        <div class="text-green-500 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 class="text-xl font-bold text-gray-900 mb-2">¡Gracias por tu valoración!</h3>
        <p class="text-gray-600 mb-6">Tu opinión es muy importante para nosotros. Esperamos volver a servirte pronto.</p>
        <button id="closeThankYou" class="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">Cerrar</button>
      </div>
    `;
    
    // Configurar evento para cerrar
    document.getElementById('closeThankYou').addEventListener('click', () => {
      this.hideModal();
    });
    
    // Cerrar automáticamente después de 5 segundos
    setTimeout(() => {
      this.hideModal();
    }, 5000);
  }
};

// Función para mostrar notificación de valoración
function showRatingNotification(order) {
  // Mostrar notificación del navegador para valorar el servicio
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification('Servicio completado', {
      body: '¡Tu servicio ha sido completado! Nos encantaría conocer tu opinión.',
      icon: '/img/favicon-32x32.png'
    });
    
    notification.onclick = function() {
      window.focus();
      ratingSystem.showModal(order);
    };
  }
  
  // Mostrar notificación en la interfaz
  notifications.success('Servicio completado. ¿Te gustaría valorarlo?', {
    title: 'Valoración de servicio',
    duration: 10000,
    actions: [
      {
        text: 'Valorar ahora',
        onClick: () => ratingSystem.showModal(order)
      }
    ]
  });
}

// Exportar funciones
window.showRatingNotification = showRatingNotification;
window.ratingSystem = ratingSystem;

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  ratingSystem.init();
});