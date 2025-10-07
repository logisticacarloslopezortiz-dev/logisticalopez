// Inicializar íconos
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
});

// Login de colaboradores validando contra localStorage ('colaboradores')
const form = document.getElementById('collabLoginForm');
const errorBox = document.getElementById('loginError');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();

  if (!email || !password) {
    errorBox.textContent = 'Ingresa correo y contraseña.';
    errorBox.classList.remove('hidden');
    return;
  }

  const colaboradores = JSON.parse(localStorage.getItem('colaboradores') || '[]');
  const user = colaboradores.find(c => (c.email || '').toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) {
    errorBox.textContent = 'Correo o contraseña incorrectos.';
    errorBox.classList.remove('hidden');
    return;
  }

  const session = { email: user.email, name: user.name, role: user.role, loginAt: new Date().toISOString() };
  localStorage.setItem('tlc_collab_session', JSON.stringify(session));
  window.location.href = 'panel-colaborador.html';
});