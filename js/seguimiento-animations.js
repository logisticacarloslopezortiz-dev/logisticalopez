document.addEventListener('DOMContentLoaded', () => {
  // Elementos de la animación
  const animationContainer = document.getElementById('animation-container');
  const truck = document.getElementById('animation-truck');
  const box = document.getElementById('animation-box');

  // Elemento principal de la UI
  const loginScreen = document.getElementById('loginScreen');

  // Asegurarse de que los elementos existen antes de animar
  if (!animationContainer || !truck || !box || !loginScreen) {
    console.error('Animation elements not found. Aborting.');
    // Si no se encuentran, mostramos el login directamente.
    if(loginScreen) loginScreen.style.opacity = '1';
    document.body.style.overflow = '';
    return;
  }

  // GSAP Timeline
  const tl = gsap.timeline({
    onComplete: () => {
      // Al final de la animación, eliminamos el contenedor y permitimos el scroll
      animationContainer.style.display = 'none';
      document.body.style.overflow = '';
    }
  });

  // 1. Camión entra hasta el centro de la pantalla
  tl.to(truck, {
    x: '50vw', // Mover hasta la mitad del viewport
    duration: 1.5,
    ease: 'power2.inOut'
  });

  // 2. La caja aparece en el centro con un efecto "pop"
  tl.to(box, {
    opacity: 1,
    scale: 1,
    duration: 0.5,
    ease: 'back.out(1.7)'
  }, "-=0.5"); // Inicia 0.5s antes de que el camión se detenga

  // 3. El camión sigue su camino y sale de la pantalla
  tl.to(truck, {
    x: '100vw', // Mover hasta salir completamente
    duration: 1.5,
    ease: 'power2.inOut',
    delay: 0.5 // Pequeña pausa
  });

  // 4. La caja se transforma para revelar el modal de login
  tl.to(box, {
    scale: 20,
    opacity: 0,
    duration: 0.7,
    ease: 'power2.in'
  }, "-=1.5"); // Inicia mientras el camión se va

  // 5. El modal de login aparece
  tl.to(loginScreen, {
    opacity: 1,
    duration: 0.5
  }, "-=0.8");

  // 6. El personaje "worker" aparece
  const worker = document.getElementById('worker-character');
  if (worker) {
    tl.fromTo(worker,
      { opacity: 0, y: 100 },
      { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }
    );
  }

  // --- Lógica para la Escena Interactiva ---
  function setupInteractiveScene() {
    const interactiveWorker = document.getElementById('interactive-worker');
    const boxStack = document.getElementById('box-stack');
    const truck = document.getElementById('interactive-truck');

    if (!interactiveWorker || !boxStack || !truck) return;

    interactiveWorker.addEventListener('click', () => {
      const boxes = boxStack.querySelectorAll('.box');
      if (boxes.length === 0) return; // No hay más cajas

      const topBox = boxes[boxes.length - 1];

      // Animación de la caja
      const tl_box = gsap.timeline();
      tl_box.to(topBox, {
        x: 200,
        y: -100,
        rotation: 90,
        duration: 0.7,
        ease: 'power2.in'
      }).to(topBox, {
        opacity: 0,
        duration: 0.3
      }).call(() => topBox.remove()); // Eliminar la caja del DOM
    });
  }

  // Iniciar la escena interactiva cuando la pantalla de seguimiento se muestre
  const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      if (mutation.attributeName === 'class' && !trackingScreen.classList.contains('hidden')) {
        gsap.fromTo("#interactive-scene", { y: '100%' }, { y: '0%', duration: 0.8, ease: 'power2.out' });
        setupInteractiveScene();
        observer.disconnect(); // Dejar de observar una vez que se muestra
      }
    }
  });

  const trackingScreen = document.getElementById('trackingScreen');
  if(trackingScreen) {
      observer.observe(trackingScreen, { attributes: true });
  }
});
