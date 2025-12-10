;(function(root, factory){
  // UMD wrapper: soporta Node/CommonJS, AMD y browser global
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    var exportsObj = factory();
    // Evitar colisiones, publicar bajo root (window/self/globalThis)
    var target = root || (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
    Object.keys(exportsObj).forEach(function(k){ target[k] = exportsObj[k]; });
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function(){

  // Estados canónicos
  const ESTADOS = {
    pendiente: 'pendiente',
    aceptada: 'aceptada',
    en_camino_recoger: 'en camino a recoger',
    cargando: 'cargando',
    en_camino_entregar: 'en camino a entregar',
    completada: 'completada',
    retraso: 'retraso por tapon'
  };

  // Flujo lineal principal (excluye 'retraso' por ser especial)
  const WORKFLOW = [
    ESTADOS.aceptada,
    ESTADOS.en_camino_recoger,
    ESTADOS.cargando,
    ESTADOS.en_camino_entregar,
    ESTADOS.completada
  ];

  const STATUS_GRADIENT = Object.freeze({
    [ESTADOS.aceptada]: { bg: 'linear-gradient(90deg, #4f46e5, #6366f1)', color: '#ffffff' },
    [ESTADOS.en_camino_recoger]: { bg: 'linear-gradient(90deg, #1E405A, #2D5A7B)', color: '#ffffff' },
    [ESTADOS.cargando]: { bg: 'linear-gradient(90deg, #FBBF24, #FCD34D)', color: '#1F2937' },
    [ESTADOS.en_camino_entregar]: { bg: 'linear-gradient(90deg, #7C3AED, #A78BFA)', color: '#ffffff' },
    [ESTADOS.retraso]: { bg: 'linear-gradient(90deg, #F97316, #FB923C)', color: '#ffffff' },
    [ESTADOS.completada]: { bg: 'linear-gradient(90deg, #10B981, #34D399)', color: '#ffffff' }
  });

  // Índice simplificado del paso (excluye 'aceptada' como index -1 en la versión original)
  function idxOf(st){
    // Conservamos compat: los índices usados originalmente 0..3 para 4 pasos
    switch(normalizeStatus(st)){
      case ESTADOS.en_camino_recoger: return 0;
      case ESTADOS.cargando: return 1;
      case ESTADOS.en_camino_entregar: return 2;
      case ESTADOS.completada: return 3;
      default: return -1;
    }
  }

  function removeDiacritics(s){
    try {
      return s.normalize('NFD').replace(/\p{Diacritic}+/gu, '');
    } catch(e){
      // Fallback simple si no hay soporte unicode regex
      return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
    }
  }

  // Normalización más amplia
  function normalizeStatus(s){
    const base = String(s == null ? '' : s).trim().toLowerCase();
    if (!base) return '';
    const x = removeDiacritics(base);

    // Mapear sinónimos y formas comunes
    // Retraso
    if (/(retraso|tapon|atasco|demora|delay)/.test(x)) return ESTADOS.retraso;

    // Completada / entregada
    if (/(completad|completo|finalizad|cerrad|entregad|entregado|entrega completa)/.test(x)) return ESTADOS.completada;

    // En camino a entregar
    if (/(en\s*camino.*entreg|camino.*entreg|yendo.*entreg|ruta.*entreg|por\s*entregar|salida.*entreg)/.test(x)) {
      return ESTADOS.en_camino_entregar;
    }
    // Cargando
    if (/(cargando|carga|load(ing)?|pickup\s*load)/.test(x)) return ESTADOS.cargando;

    // En camino a recoger
    if (/(en\s*camino.*recog|camino.*recog|yendo.*recog|ruta.*recog|por\s*recoger|hacia.*recog)/.test(x)) {
      return ESTADOS.en_camino_recoger;
    }

    // Aceptada / aceptado
    if (/(aceptad|aceptado|acepto|accepted)/.test(x)) return ESTADOS.aceptada;

    // Pendiente
    if (/(pendient|pending|por\s*aceptar)/.test(x)) return ESTADOS.pendiente;

    // Tokens del manager reverso
    if (x === 'en_camino_recoger') return ESTADOS.en_camino_recoger;
    if (x === 'en_camino_entregar') return ESTADOS.en_camino_entregar;
    if (x === 'entregado') return ESTADOS.completada;
    if (x === 'cargando') return ESTADOS.cargando;
    if (x === 'aceptada') return ESTADOS.aceptada;

    return x;
  }

  // Mapea estado canónico a token consumible por manager
  function statusToManagerToken(s){
    const n = normalizeStatus(s);
    switch(n){
      case ESTADOS.en_camino_recoger: return 'en_camino_recoger';
      case ESTADOS.cargando: return 'cargando';
      case ESTADOS.en_camino_entregar: return 'en_camino_entregar';
      case ESTADOS.completada: return 'entregado';
      case ESTADOS.aceptada: return 'aceptada';
      case ESTADOS.pendiente: return 'pendiente';
      case ESTADOS.retraso: return 'retraso';
      default: return n; // devuelve lo que haya para no romper
    }
  }

  // Reverso del token del manager al estado canónico
  function managerTokenToStatus(token){
    return normalizeStatus(token);
  }

  const NEXT_FLOW = Object.freeze({
    [ESTADOS.aceptada]: ESTADOS.en_camino_recoger,
    [ESTADOS.en_camino_recoger]: ESTADOS.cargando,
    [ESTADOS.cargando]: ESTADOS.en_camino_entregar,
    [ESTADOS.en_camino_entregar]: ESTADOS.completada
  });

  function siguienteEstado(actual){
    const norm = normalizeStatus(actual);
    return NEXT_FLOW[norm] || null;
  }

  function isTerminalStatus(s){
    const ns = normalizeStatus(s);
    return ns === ESTADOS.completada;
  }

  // Regla de transición robusta
  function isStatusChangeAllowed(current, next, hasEvidence){
    const normCurrent = normalizeStatus(current);
    const normNext = normalizeStatus(next);

    // No-ops
    if (!normNext) return false;
    if (normCurrent && normNext === normCurrent) return false;

    // Estado especial: retraso permisible en cualquier momento del flujo principal
    if (normNext === ESTADOS.retraso) return true;

    const currIdx = WORKFLOW.indexOf(normCurrent);
    const nextIdx = WORKFLOW.indexOf(normNext);

    // Completar requiere evidencia y haber alcanzado "en camino a entregar" o posterior.
    if (normNext === ESTADOS.completada) {
      const entregIdx = WORKFLOW.indexOf(ESTADOS.en_camino_entregar);
      return !!hasEvidence && currIdx >= entregIdx;
    }

    // Permitir avance lineal de a un paso, y permitir iniciar desde 'aceptada'
    if (currIdx === -1) {
      // Si todavía no está en el flujo, solo puede entrar por el inicio
      return nextIdx === 0; // aceptada
    }
    return nextIdx === currIdx + 1;
  }

  // Sugerir siguientes posibles estados desde el actual
  function getAllowedNextStatuses(current, hasEvidence){
    const normCurrent = normalizeStatus(current);

    const allowed = [];
    // 'retraso' siempre permitido como acción paralela (si decides usarlo como flag)
    allowed.push(ESTADOS.retraso);

    const next = siguienteEstado(normCurrent);
    if (next && isStatusChangeAllowed(normCurrent, next, hasEvidence)) {
      allowed.push(next);
    }
    // Si ya está en "en camino a entregar", ofrecer completada si hay evidencia
    if (normalizeStatus(normCurrent) === ESTADOS.en_camino_entregar && isStatusChangeAllowed(normCurrent, ESTADOS.completada, hasEvidence)) {
      allowed.push(ESTADOS.completada);
    }
    // Si ya está en completada, no hay más
    return Array.from(new Set(allowed));
  }

  function coerceToWorkflowOrSpecial(status){
    const n = normalizeStatus(status);
    if (WORKFLOW.includes(n)) return n;
    if (n === ESTADOS.retraso) return n;
    return '';
  }

  // Export público
  return {
    ESTADOS,
    WORKFLOW,
    STATUS_GRADIENT,
    idxOf,
    isStatusChangeAllowed,
    normalizeStatus,
    statusToManagerToken,
    managerTokenToStatus,
    NEXT_FLOW,
    siguienteEstado,
    isTerminalStatus,
    getAllowedNextStatuses,
    coerceToWorkflowOrSpecial
  };
});