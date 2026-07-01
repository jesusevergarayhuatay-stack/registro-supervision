// === CONFIGURACIÓN Y GLOBALES ===
const ADMIN_PASSWORD = "Defensoria2026";
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbz9GbqHfoAQarF5pv4da2jJDcSSTz7suco2O5SyaZ8X_4sJOTVbYZhiTrj0X501uECW/exec";

let activeSession = null;
let history = [];
let waContacts = [];
let incidentMediaFiles = []; // Array de { file, previewUrl, type }
let timerInterval = null;
let locationWatchId = null;
let minimap = null;
let minimapMarker = null;
let otherMarkers = {}; // Almacena marcadores de otros comisionados { sessionId: marker }

// 1. DATA ESTRÍCTAMENTE HARDCODEADA (Original Lima)
const puntosPredefinidos = {
    "Espacio de movilización": ["Congreso", "Fiscalía", "Plaza San Martín", "Plaza Dos de Mayo", "Plaza Manco Cápac", "Alameda Paseo de los Héroes Navales", "Óvalo Grau", "Óvalo Bolognesi", "Av. De la Peruanidad", "ONPE", "JNE", "Campo de Marte"],
    "Dependencia policial / Seguridad del Estado": ["Comisaría Alfonso Ugarte", "Comisaría Cotabambas", "Comisaría de Mujeres", "Comisaría PNP San Andrés", "División de Asuntos Sociales", "Comisaría de Piedra Liza"],
    "Establecimiento de salud": ["Hospital Nacional Arzobispo Loayza", "Emergencias Grau", "Hospital Nacional Guillermo Almenara", "Hospital Edgardo Rebagliati Martins", "Hospital Nacional Dos de Mayo", "Hospital PNP Augusto B. Leguía", "Hospital Nacional PNP Luis N Saenz"],
    "Videovigilancia": ["Centro de Monitoreo", "Cámaras - Municipalidad", "Cámaras - PNP"]
};

// Cascada directa Lima: seleccionar categoría → rellenar puntos de supervisión
function cascadePuntosLima(cat) {
    const pointSelect = document.getElementById('punto-lima');
    if (!pointSelect || !cat) return;
    let html = '<option value="">Selecciona punto...</option>';
    (puntosPredefinidos[cat] || []).forEach(p => { html += `<option value="${p}">${p}</option>`; });
    pointSelect.innerHTML = html;
    cargarPuntosFirebase(cat, pointSelect);
}
window.cascadePuntosLima = cascadePuntosLima;

// Firebase Safety (fbRef y _fbDb definidos en firebase-config.js)
const _fbStorage = (typeof _storage !== "undefined") ? _storage : null;

// =============================================
// COMPRESIÓN DE IMÁGENES (Canvas API)
// =============================================
function compressImage(file, maxPx = 1200, quality = 0.75) {
    return new Promise((resolve) => {
        // Si no es imagen o es muy pequeña, devolver tal cual
        if (!file.type.startsWith('image/')) { resolve(file); return; }

        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;

            // Escalar manteniendo proporción
            if (width > maxPx || height > maxPx) {
                if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
                else { width = Math.round(width * maxPx / height); height = maxPx; }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(blob => {
                const compressed = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
                const reduction = Math.round((1 - blob.size / file.size) * 100);
                console.log(`[Compresión] ${file.name}: ${(file.size/1024).toFixed(0)}KB → ${(blob.size/1024).toFixed(0)}KB (${reduction}% reducción)`);
                resolve(compressed);
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

// =============================================
// FOTO INICIO: CÁMARA O GALERÍA
// Sincroniza el input auxiliar (cam/gal) con el input real del formulario
// y muestra un thumbnail de previsualización
// =============================================
function syncPhotoInput(sourceInput, targetId, previewId) {
    const file = sourceInput.files[0];
    if (!file) return;

    // Copiar el file al input real usando DataTransfer
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.getElementById(targetId);
    if (target) target.files = dt.files;

    // Mostrar preview
    const preview = document.getElementById(previewId);
    if (preview) {
        const url = URL.createObjectURL(file);
        preview.innerHTML = `<img src="${url}" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px;border:2px solid var(--primary);" alt="Vista previa">`;
    }
}

// =============================================
// MEDIA DE INCIDENCIAS (múltiples fotos + video)
// =============================================
function addIncidentFiles(files) {
    Array.from(files).forEach(file => {
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (isVideo && file.size > 200 * 1024 * 1024) {
            alert(`"${file.name}" supera los 200 MB. Selecciona un video más corto.`);
            return;
        }
        const previewUrl = (isImage || isVideo) ? URL.createObjectURL(file) : null;
        incidentMediaFiles.push({ file, previewUrl, type: file.type });
    });
    renderIncidentMediaPreview();
}

function renderIncidentMediaPreview() {
    const container = document.getElementById('incident-media-preview');
    if (!container) return;
    container.innerHTML = incidentMediaFiles.map((m, idx) => {
        const isImage = m.type.startsWith('image/');
        const isVideo = m.type.startsWith('video/');
        const thumb = isImage
            ? `<img src="${m.previewUrl}" style="width:64px;height:50px;object-fit:cover;border-radius:6px;">`
            : isVideo
            ? `<video src="${m.previewUrl}" style="width:64px;height:50px;object-fit:cover;border-radius:6px;" muted playsinline></video>`
            : `<span style="font-size:1.5rem;">📎</span>`;
        return `<div style="position:relative;display:inline-block;">
            ${thumb}
            <button type="button" onclick="removeIncidentFile(${idx})" style="position:absolute;top:-4px;right:-4px;background:#e74c3c;color:white;border:none;border-radius:50%;width:18px;height:18px;font-size:0.7rem;cursor:pointer;line-height:18px;padding:0;">✕</button>
        </div>`;
    }).join('');
    // Mostrar contador
    const label = document.querySelector('#incident-media-preview')?.previousElementSibling;
    const countEl = document.getElementById('incident-media-count');
    if (!countEl && incidentMediaFiles.length > 0) {
        const div = document.createElement('small');
        div.id = 'incident-media-count';
        div.style.cssText = 'color:#666;display:block;margin-bottom:4px;';
        container.before(div);
    }
    const c = document.getElementById('incident-media-count');
    if (c) c.textContent = incidentMediaFiles.length > 0 ? `${incidentMediaFiles.length} archivo(s) adjunto(s)` : '';
}

function removeIncidentFile(idx) {
    if (incidentMediaFiles[idx]?.previewUrl) URL.revokeObjectURL(incidentMediaFiles[idx].previewUrl);
    incidentMediaFiles.splice(idx, 1);
    renderIncidentMediaPreview();
}

// =============================================
// RECORDAR DATOS DEL COMISIONADO
// =============================================
const STORAGE_KEYS = { supervisor: 'dp_last_supervisor', oficina_od: 'dp_last_oficina_od', turno: 'dp_last_turno', oficina_lima: 'dp_last_oficina_lima' };

function saveLastSupervisorData(data) {
    Object.keys(data).forEach(k => { if (data[k]) localStorage.setItem(k, data[k]); });
}

function restoreSupervisorData() {
    // Formulario OD/MOD
    const lastSuperOD = localStorage.getItem(STORAGE_KEYS.supervisor);
    const lastOficinaOD = localStorage.getItem(STORAGE_KEYS.oficina_od);
    const lastTurnoOD = localStorage.getItem(STORAGE_KEYS.turno);
    if (lastSuperOD) { const el = document.getElementById('acp-supervisor'); if (el && !el.value) el.value = lastSuperOD; }
    if (lastOficinaOD) { const el = document.getElementById('acp-office'); if (el && !el.value) el.value = lastOficinaOD; }
    if (lastTurnoOD) { const el = document.getElementById('acp-turno'); if (el && !el.value) el.value = lastTurnoOD; }

    // Formulario Lima
    const lastSuperLima = localStorage.getItem(STORAGE_KEYS.supervisor);
    const lastOficinaLima = localStorage.getItem(STORAGE_KEYS.oficina_lima);
    const lastTurnoLima = localStorage.getItem(STORAGE_KEYS.turno);
    if (lastSuperLima) { const el = document.getElementById('name'); if (el && !el.value) el.value = lastSuperLima; }
    if (lastOficinaLima) { const el = document.getElementById('oficina-lima'); if (el && !el.value) el.value = lastOficinaLima; }
    if (lastTurnoLima) { const el = document.getElementById('turno'); if (el && !el.value) el.value = lastTurnoLima; }
}

// =============================================
// INDICADOR DE CALIDAD GPS
// =============================================
let lastGpsUpdate = null;
let gpsStaleTimer = null;

function updateGpsQualityBadge(accuracy) {
    const badge = document.getElementById('gps-quality-badge');
    if (!badge) return;

    lastGpsUpdate = Date.now();
    document.getElementById('gps-stale-warn')?.style.setProperty('display', 'none');
    if (gpsStaleTimer) clearTimeout(gpsStaleTimer);

    // Reiniciar alarma de GPS estancado (30s sin actualizar)
    gpsStaleTimer = setTimeout(() => {
        const warn = document.getElementById('gps-stale-warn');
        if (warn) warn.style.display = 'block';
        if (badge) { badge.textContent = '📡 Sin señal'; badge.style.background = '#fadbd8'; badge.style.color = '#922b21'; }
    }, 30000);

    let label, bg, color;
    if (accuracy <= 10)       { label = '📡 GPS Excelente';  bg = '#d5f5e3'; color = '#1a5c32'; }
    else if (accuracy <= 30)  { label = '📡 GPS Bueno';      bg = '#d5f5e3'; color = '#1a5c32'; }
    else if (accuracy <= 100) { label = '📡 GPS Regular';    bg = '#fef9e7'; color = '#7d6608'; }
    else                       { label = '📡 GPS Débil';      bg = '#fadbd8'; color = '#922b21'; }

    badge.textContent = label + ` (±${Math.round(accuracy)}m)`;
    badge.style.background = bg;
    badge.style.color = color;
}

// =============================================
// BOTÓN DE PÁNICO
// =============================================
function initPanicButton() {
    document.getElementById('panic-btn')?.addEventListener('click', async () => {
        const confirmed = confirm('⚠️ ¿Confirmas activar el BOTÓN DE PÁNICO?\n\nEsto notificará a TODOS los contactos de emergencia con tu ubicación actual.');
        if (!confirmed) return;

        const btn = document.getElementById('panic-btn');
        btn.disabled = true;
        btn.textContent = '🆘 ENVIANDO ALERTA...';
        btn.style.background = '#7b241c';

        try {
            // 1. Marcar alerta crítica en Firebase
            const sRef = fbRef('sessions/' + activeSession.sessionId);
            if (sRef) await sRef.update({ alertaActiva: true, panicAt: Date.now() });

            // 2. Guardar en registro de sesión
            const panicInc = {
                timestamp: Date.now(),
                clasificacion: 'PÁNICO',
                cantidad: '',
                description: '🆘 BOTÓN DE PÁNICO activado — Solicita apoyo inmediato.',
                author: activeSession.name,
                office: activeSession.office,
                lat: activeSession.currentLat,
                lng: activeSession.currentLng
            };
            const slug = slugify(activeSession.protestName || activeSession.location);
            const feedRef = fbRef('shared_feeds/' + slug + '/incidents');
            if (feedRef) await feedRef.push(panicInc);

            // 3. Enviar WhatsApp al contacto de emergencia principal (5to registro)
            const contactoEmergencia = waContacts[4] || waContacts[0];
            if (contactoEmergencia) {
                const gps = `${activeSession.currentLat?.toFixed(5)}, ${activeSession.currentLng?.toFixed(5)}`;
                const mapsLink = `https://maps.google.com/?q=${activeSession.currentLat},${activeSession.currentLng}`;
                const msg = `🆘 *PÁNICO — EMERGENCIA*\n*Comisionado:* ${activeSession.name}\n*Oficina:* ${activeSession.office}\n*Punto:* ${activeSession.location}\n*GPS:* ${gps}\n*Mapa:* ${mapsLink}`;
                const url = `https://wa.me/${contactoEmergencia.numero.toString().replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
                window.open(url, '_blank');
            } else {
                alert('⚠️ No hay contactos de emergencia configurados. El administrador fue notificado en el tablero.');
            }

            btn.textContent = '✅ ALERTA ENVIADA';
            btn.style.background = '#1a5c32';
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '🆘 BOTÓN DE PÁNICO — EMERGENCIA INMEDIATA';
                btn.style.background = '#c0392b';
            }, 10000);

        } catch (e) {
            alert('Error al enviar alerta: ' + e.message);
            btn.disabled = false;
            btn.textContent = '🆘 BOTÓN DE PÁNICO — EMERGENCIA INMEDIATA';
            btn.style.background = '#c0392b';
        }
    });
}

// --- HELPERS ---
function adminLogin() {
    const pass = prompt("Ingrese clave de administrador:");
    if (pass === ADMIN_PASSWORD) window.location.href = "defensor.html";
    else if (pass !== null) alert("Clave incorrecta.");
}

function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function slugify(text) {
    if (!text) return 'general';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

function formatAMPM(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    let ampm = hours >= 12 ? 'p.m.' : 'a.m.';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return hours + ':' + minutes + ' ' + ampm;
}

// --- NAVEGACIÓN ---
const sections = ['selection-section', 'acp-section', 'start-section', 'active-section'];
function showSection(id) {
    sections.forEach(s => document.getElementById(s)?.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
    if (id === 'selection-section') document.getElementById('history-section')?.classList.remove('hidden');
    else document.getElementById('history-section')?.classList.add('hidden');
}

function showAcpForm() { showSection('acp-section'); }
function showPlanForm() { showSection('start-section'); }

// --- NAVEGACIÓN MÚLTIPLES MÓDULOS (v3.0) ---
let _alertasModuleInited = false;
let _acpModuleInited = false;

function goToAlertas() {
    openModule('modulo-alertas');
    if (!_alertasModuleInited) {
        if (typeof initAlertasModule === 'function') { initAlertasModule(); _alertasModuleInited = true; }
    }
}

function goToAcciones() {
    openModule('modulo-acciones');
    if (!_acpModuleInited) {
        if (typeof initAcpModule === 'function') { initAcpModule(); _acpModuleInited = true; }
    }
}

function openModule(moduleId) {
    // Ocultar menú principal
    document.getElementById('main-menu')?.classList.add('d-none');
    
    // Ocultar todos los módulos
    const modules = ['modulo-alertas', 'modulo-acciones', 'modulo-supervision'];
    modules.forEach(m => document.getElementById(m)?.classList.add('d-none'));
    
    // Mostrar el módulo seleccionado
    const selectedModule = document.getElementById(moduleId);
    if (selectedModule) {
        selectedModule.classList.remove('d-none');
    }
}

function showMainMenu() {
    // Ocultar todos los módulos
    const modules = ['modulo-alertas', 'modulo-acciones', 'modulo-supervision'];
    modules.forEach(m => document.getElementById(m)?.classList.add('d-none'));
    
    // Mostrar menú principal
    document.getElementById('main-menu')?.classList.remove('d-none');
}

// --- DOCUMENTOS DE GESTIÓN ---
const documentosGestion = [
    { titulo: 'Lineamientos de Supervisión', url: '#' },
    { titulo: 'Cartilla de Derechos', url: '#' },
    { titulo: 'Protocolo de Intervención', url: '#' }
];

function renderToolkit() {
    const list = document.getElementById('toolkit-list');
    const modalList = document.getElementById('modal-docs-list');
    if (!list) return;

    const html = documentosGestion.map(doc =>
        `<a href="${doc.url}" target="_blank" style="text-decoration:none; color:var(--primary); font-size:0.9rem; padding:8px; background:#f0f2f5; border-radius:8px;">📄 ${doc.titulo}</a>`
    ).join('');

    list.innerHTML = html;
    if (modalList) modalList.innerHTML = html;
}

// --- INICIALIZACIÓN ---
function init() {
    activeSession = JSON.parse(localStorage.getItem('dp_active_session'));
    history = JSON.parse(localStorage.getItem('dp_history')) || [];

    // Fechas
    const dateLima = document.getElementById('date');
    if (dateLima) dateLima.value = new Date().toISOString().split('T')[0];
    const dateAcp = document.getElementById('acp-date');
    if (dateAcp) dateAcp.value = new Date().toISOString().split('T')[0];

    // Listeners
    document.getElementById('choice-acp')?.addEventListener('click', showAcpForm);
    document.getElementById('choice-plan')?.addEventListener('click', showPlanForm);
    document.querySelectorAll('.back-link').forEach(btn => btn.addEventListener('click', () => showSection('selection-section')));
    document.getElementById('export-btn')?.addEventListener('click', exportData);

    // Aviso si el usuario intenta cerrar/recargar con supervisión activa
    window.addEventListener('beforeunload', e => {
        if (activeSession && !activeSession.endTime) {
            e.preventDefault();
            e.returnValue = '¿Seguro que quieres salir? La supervisión está en curso y perderás el progreso no guardado.';
        }
    });

    // Docs Modal
    document.getElementById('view-docs-btn')?.addEventListener('click', () => {
        document.getElementById('docs-modal').classList.remove('hidden-modal');
    });
    document.getElementById('close-docs-btn')?.addEventListener('click', () => {
        document.getElementById('docs-modal')?.classList.add('hidden-modal');
    });

    renderToolkit();

    // 1. MOTOR DE CASCADA LIMA (Estricto)
    const selectCatLima = document.getElementById('categoria-lima');
    const selectPuntoLima = document.getElementById('punto-lima');

    selectCatLima?.addEventListener('change', async (e) => {
        const cat = e.target.value;
        if (!selectPuntoLima) return;

        // Limpiar
        selectPuntoLima.innerHTML = '<option value="">Cargando puntos...</option>';

        // Inyectar Base Lima (Hardcoded)
        let html = '<option value="">Selecciona punto...</option>';
        if (puntosPredefinidos[cat]) {
            puntosPredefinidos[cat].forEach(p => {
                html += `<option value="${p}">${p}</option>`;
            });
        }
        selectPuntoLima.innerHTML = html;

        // Inyectar Dinámicos (Firebase)
        await cargarPuntosFirebase(cat, selectPuntoLima);
    });

    // 2. AUTOCOMPLETE OD/MOD (Historial)
    cargarSugerenciasOD();

    initFirebaseCatalogos();

    // Listeners del Menú Principal (v4.0)
    document.getElementById('btn-modulo-alertas')?.addEventListener('click', goToAlertas);
    document.getElementById('btn-modulo-acciones')?.addEventListener('click', goToAcciones);
    document.getElementById('btn-modulo-supervision')?.addEventListener('click', () => openModule('modulo-supervision'));

    // Botones Volver
    document.querySelectorAll('.back-to-menu-btn').forEach(btn => {
        btn.addEventListener('click', showMainMenu);
    });

    // Restaurar datos del último comisionado
    restoreSupervisorData();

    if (activeSession) {
        showActiveSession();
        openModule('modulo-supervision');
    } else {
        showSection('selection-section');
        showMainMenu();
    }

    renderHistory();
}

// === GESTIÓN DE CATÁLOGOS DINÁMICOS (LIMA) ===
let catalogosCache = { protestas: [], puntos: {} };

function initFirebaseCatalogos() {
    const catRef = fbRef('configuracion/catalogos');
    if (!catRef) return;

    catRef.on('value', snap => {
        const data = snap.val();
        if (!data) return;

        catalogosCache = data;

        // Poblar datalist de protestas
        const protestList = document.getElementById('protest-list-plan');
        if (protestList) {
            protestList.innerHTML = (data.protestas || []).map(p => `<option value="${p}">`).join('');
        }

        // Actualizar datalists de puntos si hay una categoría seleccionada
        populateLocationDatalist();
        populateLocationDatalist(true);
    });

    // Cargar contactos de Google Sheets (mantenemos esto por ahora si el usuario no pidió quitarlo)
    fetchGoogleConfig();
}

async function cargarPuntosFirebase(categoria, container) {
    try {
        const snap = await fbRef('configuracion/catalogos/puntos/' + categoria).once('value');
        const remotePoints = snap.val();
        if (remotePoints && Array.isArray(remotePoints)) {
            remotePoints.forEach(p => {
                // Evitar duplicados con la lista base
                const isPredefined = puntosPredefinidos[categoria] && puntosPredefinidos[categoria].includes(p);
                if (!isPredefined) {
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    container.appendChild(opt);
                }
            });
        }
    } catch (e) {
        console.error("Error al cargar puntos desde Firebase:", e);
    }
}

async function cargarSugerenciasOD() {
    const list = document.getElementById('sugerencias-od');
    if (!list) return;
    try {
        const snap = await fbRef('configuracion/historial_puntos_od').once('value');
        const data = snap.val();
        if (data) {
            const puntos = Object.values(data);
            const unique = [...new Set(puntos)];
            list.innerHTML = unique.map(p => `<option value="${p}">`).join('');
        }
    } catch (e) { console.error("Error sugerencias OD:", e); }
}

async function guardarPuntoOD(punto) {
    if (!punto) return;
    try {
        const ref = fbRef('configuracion/historial_puntos_od');
        if (ref) await ref.push(punto);
    } catch (e) { console.error("Error guardando punto OD:", e); }
}

async function populateLocationDatalist(isAcp = false) {
    if (isAcp) return; // OD/MOD no usa cascada

    const catSelect = document.getElementById('categoria-lima');
    const pointSelect = document.getElementById('punto-lima');

    if (!catSelect || !pointSelect) return;

    const cat = catSelect.value;
    if (!cat) return;

    let html = '<option value="">Selecciona punto...</option>';
    if (puntosPredefinidos[cat]) {
        puntosPredefinidos[cat].forEach(p => {
            html += `<option value="${p}">${p}</option>`;
        });
    }
    pointSelect.innerHTML = html;
    await cargarPuntosFirebase(cat, pointSelect);
}

async function fetchGoogleConfig() {
    try {
        const res = await fetch(GOOGLE_SHEETS_URL);
        const json = await res.json();
        if (json.config) {
            waContacts = json.config.contactos || [];
        }
    } catch (e) { console.error("Google sync error", e); }
}

// --- SESIÓN ACTIVA ---
function showActiveSession() {
    showSection('active-section');
    safeSetText('display-location', activeSession.location);

    initMinimap();
    startTimer(activeSession.startTime);
    listenSharedFeed();
    startLocationTracking();
    syncOtherCommissioners(); // Multiplayer Map
    initPanicButton();        // Botón de pánico
}

function initMinimap() {
    if (minimap) return;
    minimap = L.map('minimapa-comisionado', { zoomControl: false }).setView([-12.0464, -77.0428], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(minimap);

    minimapMarker = L.marker([-12.0464, -77.0428]).addTo(minimap);
    minimapMarker.bindTooltip("Tú: " + activeSession.name, {
        permanent: true,
        direction: 'top',
        className: 'waze-tooltip'
    });
}

function syncOtherCommissioners() {
    const sessionsRef = fbRef('sessions');
    if (!sessionsRef || !activeSession.protestName) return;

    sessionsRef.on('value', snap => {
        const data = snap.val();
        if (!data) return;

        Object.keys(data).forEach(sid => {
            if (sid === activeSession.sessionId) return;

            const s = data[sid];
            // AISLAMIENTO ESTRICTO POR PROTESTA
            const isSameProtest = (s.protestName === activeSession.protestName) && (s.protestName !== undefined);
            const isActive = s.status === 'active';

            if (isSameProtest && isActive && s.currentLat && s.currentLng) {
                updateOtherMarker(sid, s);
            } else {
                removeOtherMarker(sid);
            }
        });
    });
}

function updateOtherMarker(sid, s) {
    const latlng = [s.currentLat, s.currentLng];

    // REGLA ESTRICTA: solo alertaActiva===true activa el pin de emergencia
    const hasCritical = s.alertaActiva === true;

    let marker;
    if (hasCritical) {
        // ESTADO DE EMERGENCIA 🚨
        marker = L.divIcon({
            html: '🚨',
            className: 'alert-marker',
            iconSize: [40, 40],
            iconAnchor: [20, 40]
        });
    } else {
        // ESTADO NORMAL: pin azul estándar de Leaflet (sin divIcon)
        marker = new L.Icon.Default();
    }

    if (otherMarkers[sid]) {
        otherMarkers[sid].setLatLng(latlng);
        otherMarkers[sid].setIcon(marker);
    } else {
        otherMarkers[sid] = L.marker(latlng, { icon: marker }).addTo(minimap);
        otherMarkers[sid].bindTooltip(s.name + ' (' + s.office + ')', {
            permanent: true,
            direction: 'top',
            className: 'waze-tooltip'
        });
    }
}


function removeOtherMarker(sid) {
    if (otherMarkers[sid]) {
        minimap.removeLayer(otherMarkers[sid]);
        delete otherMarkers[sid];
    }
}

function startLocationTracking() {
    if (!navigator.geolocation) return;

    const geoOptions = { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 };

    locationWatchId = navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        safeSetText('display-start-geo', lat.toFixed(5) + ", " + lng.toFixed(5));
        updateGpsQualityBadge(accuracy); // Indicador de calidad

        if (minimap) {
            minimap.setView([lat, lng]);
            minimapMarker.setLatLng([lat, lng]);
        }

        // Actualizar también en el objeto de sesión local
        if (activeSession) { activeSession.currentLat = lat; activeSession.currentLng = lng; }

        const sRef = fbRef('sessions/' + activeSession.sessionId);
        if (sRef) sRef.update({ currentLat: lat, currentLng: lng, lastUpdate: Date.now() });

    }, err => {
        console.warn("GPS Update Error", err);
        safeSetText('display-start-geo', 'Ubicación aprox. (señal débil)');
        const badge = document.getElementById('gps-quality-badge');
        if (badge) { badge.textContent = '📡 Sin señal'; badge.style.background = '#fadbd8'; badge.style.color = '#922b21'; }
    }, geoOptions);
}

function startTimer(start) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const diff = Date.now() - start;
        const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        safeSetText('timer', h + ":" + m + ":" + s);
    }, 1000);
}

// --- FEED COMPARTIDO ---
function listenSharedFeed() {
    const slug = slugify(activeSession.protestName || activeSession.location);
    const feedRef = fbRef('shared_feeds/' + slug + '/incidents');
    if (feedRef) {
        feedRef.on('value', snap => {
            const data = snap.val();
            // Ordenamos cronológicamente (más antiguo primero) para que al insertar aparezca abajo
            const list = data ? Object.values(data).sort((a, b) => a.timestamp - b.timestamp) : [];
            renderTimeline(list);
        });
    }
}

function renderTimeline(list) {
    const container = document.getElementById('incidents-timeline');
    if (!container) return;

    container.innerHTML = list.map(inc => {
        const isMe = inc.author === activeSession.name;
        const timeStr = formatAMPM(new Date(inc.timestamp));

        return '<div class="chat-bubble ' + (isMe ? 'chat-mine' : 'chat-others') + '">' +
            '<div class="chat-author">' + inc.author + ' (' + inc.office + ')</div>' +
            '<div style="margin: 5px 0;">' +
            '<span style="background: ' + getIncidentColor(inc.clasificacion) + '; color:white; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700;">' + inc.clasificacion + '</span>' +
            (inc.cantidad ? '<span style="font-weight:800; margin-left:5px;">[' + inc.cantidad + ']</span>' : '') +
            '</div>' +
            '<div style="word-wrap: break-word;">' + inc.description + '</div>' +
            (inc.mediaUrls && inc.mediaUrls.length > 0
                ? inc.mediaUrls.map(m => {
                    if (m.type && m.type.startsWith('video/')) {
                        return '<video controls src="' + m.url + '" style="width:100%;max-height:240px;border-radius:8px;margin-top:8px;" playsinline></video>';
                    } else {
                        return '<img src="' + m.url + '" class="chat-img" onclick="window.open(\'' + m.url + '\')">';
                    }
                }).join('')
                : (inc.imageUrl ? '<img src="' + inc.imageUrl + '" class="chat-img" onclick="window.open(\'' + inc.imageUrl + '\')">' : '')
            ) +
            (inc.audioUrl ? '<audio controls src="' + inc.audioUrl + '" style="width:100%; margin-top:10px; height:35px;"></audio>' : '') +
            '<div class="chat-time">' + timeStr + '</div>' +
            '</div>';
    }).join('') || '<p style="text-align:center; padding:40px; color:#999;">Esperando incidencias...</p>';

    // AUTO-SCROLL AL FINAL (WhatsApp Style)
    container.scrollTop = container.scrollHeight;
}

function getIncidentColor(cls) {
    switch (cls) {
        case 'Heridos': return '#e67e22';
        case 'Fallecidos': return '#c0392b';
        case 'Privados de la libertad': return '#8e44ad';
        default: return '#3498db';
    }
}

// --- FORM HANDLERS ---
const acpForm = document.getElementById('acp-form');
acpForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Procesando...";

    const photoFileRaw = document.getElementById('acp-photo').files[0];
    const photoFile = photoFileRaw ? await compressImage(photoFileRaw) : null;
    let photoUrl = "";
    if (photoFile && _fbStorage) {
        const ref = _fbStorage.ref('starts/' + Date.now());
        await ref.put(photoFile);
        photoUrl = await ref.getDownloadURL();
    }

    const supervisorName = document.getElementById('acp-supervisor').value;
    const oficina = document.getElementById('acp-office').value;
    const turno = document.getElementById('acp-turno').value;

    // Guardar para próxima vez
    saveLastSupervisorData({ [STORAGE_KEYS.supervisor]: supervisorName, [STORAGE_KEYS.oficina_od]: oficina, [STORAGE_KEYS.turno]: turno });

    startSession({
        sessionId: 'ACP-' + Date.now(),
        type: 'OD',
        fecha: document.getElementById('acp-date').value,
        turno,
        name: supervisorName,
        office: oficina,
        category: document.getElementById('acp-category').value,
        nombreSupervision: document.getElementById('nombre-supervision-od').value.trim(),
        location: document.getElementById('punto-od').value,
        startTime: Date.now(),
        initialPhoto: photoUrl
    });

    // PERSISTENCIA INTELIGENTE PROVINCIAS
    guardarPuntoOD(document.getElementById('punto-od').value);
});

const startForm = document.getElementById('start-form');
startForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Procesando...";

    const photoFileRaw = document.getElementById('main-photo').files[0];
    const photoFile = photoFileRaw ? await compressImage(photoFileRaw) : null;
    let photoUrl = "";
    if (photoFile && _fbStorage) {
        const ref = _fbStorage.ref('starts/' + Date.now());
        await ref.put(photoFile);
        photoUrl = await ref.getDownloadURL();
    }

    const supervisorNameLima = document.getElementById('name').value;
    const oficinaLima = document.getElementById('oficina-lima').value;
    const turnoLima = document.getElementById('turno').value;

    // Guardar para próxima vez
    saveLastSupervisorData({ [STORAGE_KEYS.supervisor]: supervisorNameLima, [STORAGE_KEYS.oficina_lima]: oficinaLima, [STORAGE_KEYS.turno]: turnoLima });

    startSession({
        sessionId: 'LIMA-' + Date.now(),
        type: 'Sede',
        fecha: document.getElementById('date').value,
        turno: turnoLima,
        office: oficinaLima,
        name: supervisorNameLima,
        protestName: document.getElementById('protest-name').value,
        category: document.getElementById('categoria-lima').value,
        location: document.getElementById('punto-lima').value,
        startTime: Date.now(),
        initialPhoto: photoUrl
    });
});

async function startSession(session) {
    try {
        const pos = await new Promise((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 5000 });
        });
        session.startLat = pos.coords.latitude;
        session.startLng = pos.coords.longitude;
        session.currentLat = session.startLat;
        session.currentLng = session.startLng;
    } catch (e) {
        console.warn("GPS inicial omitido", e);
        session.startLat = -12.0464;
        session.startLng = -77.0428;
        session.currentLat = session.startLat;
        session.currentLng = session.startLng;
    }

    activeSession = session;
    localStorage.setItem('dp_active_session', JSON.stringify(session));

    const sRef = fbRef('sessions/' + session.sessionId);
    if (sRef) await sRef.set({ ...session, status: 'active', lastUpdate: Date.now() });

    const cloudData = {
        fecha: session.fecha,
        tipo_registro: session.type,
        turno: session.turno,
        oficina: session.office,
        supervisor: session.name,
        nombre_protesta: session.protestName || "N/A",
        categoria: session.category || "General",
        punto: session.location,
        inicio: formatAMPM(new Date(session.startTime)),
        lat_inicio: session.startLat,
        lng_inicio: session.startLng,
        mediaData: "",
        archivo: session.initialPhoto || "",
        sessionId: session.sessionId
    };

    syncWithCloud('start', cloudData);
    showActiveSession();
}

// --- INCIDENCIAS ---
const incidentModal = document.getElementById('incident-modal');
const saveIncidentBtn = document.getElementById('save-incident-btn');
let mediaRecorder;
let audioChunks = [];
let audioBlob = null;

document.getElementById('add-incident-btn')?.addEventListener('click', () => openIncidentModal('incidencia'));
document.getElementById('add-update-btn')?.addEventListener('click', () => openIncidentModal('actualizacion'));
document.getElementById('cancel-incident-btn')?.addEventListener('click', () => incidentModal.classList.add('hidden-modal'));

function openIncidentModal(mode) {
    incidentModal._mode = mode;
    incidentModal.classList.remove('hidden-modal');
    document.getElementById('modal-title').textContent = mode === 'actualizacion' ? 'Enviar Actualización' : 'Reportar Incidencia';
    document.getElementById('incident-class-group').style.display = mode === 'actualizacion' ? 'none' : 'block';
    // En actualización, forzar clasificación a "Actualización"
    if (mode === 'actualizacion') {
        document.getElementById('incident-class').value = '';
    }
}

saveIncidentBtn?.addEventListener('click', async () => {
    const rawDesc = document.getElementById('incident-desc').value;
    const qty = document.getElementById('incidencia-cantidad').value;
    const isActualizacion = incidentModal._mode === 'actualizacion';
    const category = isActualizacion ? 'Actualización' : document.getElementById('incident-class').value;

    if (!rawDesc) return alert("Describe el suceso.");

    saveIncidentBtn.disabled = true;
    saveIncidentBtn.textContent = "Enviando...";

    const finalDesc = isActualizacion
        ? rawDesc
        : category + (qty ? ' (' + qty + ')' : '') + ' - ' + rawDesc;

    const inc = {
        timestamp: Date.now(),
        time: formatAMPM(new Date()),
        tipoRegistro: document.getElementById('modal-title')?.textContent?.includes('Actualización') ? 'Actualización' : 'Incidencia',
        clasificacion: category,
        cantidad: qty,
        description: finalDesc,
        author: activeSession.name,
        office: activeSession.office,
        lat: activeSession.currentLat || '',
        lng: activeSession.currentLng || ''
    };

    try {
        // === SUBIR MÚLTIPLES ARCHIVOS (fotos + videos) ===
        if (incidentMediaFiles.length > 0 && _fbStorage) {
            const mediaUrls = [];
            for (const m of incidentMediaFiles) {
                try {
                    let fileToUpload = m.file;
                    if (m.type.startsWith('image/')) {
                        fileToUpload = await compressImage(m.file, 1200, 0.80);
                    }
                    const ref = _fbStorage.ref('incidents/' + activeSession.sessionId + '/' + Date.now() + '_' + m.file.name);
                    await ref.put(fileToUpload);
                    const url = await ref.getDownloadURL();
                    mediaUrls.push({ url, type: m.type, name: m.file.name });
                } catch (e) { /* continuar con el siguiente */ }
            }
            if (mediaUrls.length > 0) {
                // Compatibilidad: el primer archivo de imagen va también en imageUrl
                const firstImg = mediaUrls.find(u => u.type.startsWith('image/'));
                if (firstImg) inc.imageUrl = firstImg.url;
                inc.mediaUrls = mediaUrls; // array completo con fotos y videos
            }
        }
        if (audioBlob && _fbStorage) {
            const ref = _fbStorage.ref('incidents/' + activeSession.sessionId + '/' + Date.now() + '.webm');
            await ref.put(audioBlob);
            inc.audioUrl = await ref.getDownloadURL();
        }

        const slug = slugify(activeSession.protestName || activeSession.location);
        const feedRef = fbRef('shared_feeds/' + slug + '/incidents');
        if (feedRef) await feedRef.push(inc);

        const sRef = fbRef('sessions/' + activeSession.sessionId + '/incidents');
        if (sRef) await sRef.push(inc);

        // === ETIQUETAR ALERTA EN FIREBASE ===
        const isCritical = ['Heridos', 'Fallecidos', 'Privados de la libertad'].includes(inc.clasificacion);
        const alertaRef = fbRef('sessions/' + activeSession.sessionId + '/alertaActiva');
        if (alertaRef) {
            await alertaRef.set(isCritical);
            // Si es no-crítico, aseguramos reset después de 30s (da tiempo al admin de verlo)
            if (!isCritical) {
                setTimeout(async () => {
                    const r = fbRef('sessions/' + activeSession.sessionId + '/alertaActiva');
                    if (r) await r.set(false);
                }, 30000);
            }
        }

        syncWithCloud('incident', {
            sessionId: activeSession.sessionId,
            fecha: activeSession.fecha,
            supervisor: activeSession.name,
            oficina: activeSession.office
        }, { new_incident: inc });

        if (isCritical) {
            openWaModal(inc);
        }

        incidentModal.classList.add('hidden-modal');
        resetIncidentForm();
    } catch (e) { alert("Error: " + e.message); }
    finally {
        saveIncidentBtn.disabled = false;
        saveIncidentBtn.textContent = "Enviar ➡️";
    }
});

function resetIncidentForm() {
    document.getElementById('incident-desc').value = "";
    document.getElementById('incidencia-cantidad').value = "";
    document.getElementById('incident-photo').value = "";
    // Limpiar archivos multimedia
    incidentMediaFiles.forEach(m => { if (m.previewUrl) URL.revokeObjectURL(m.previewUrl); });
    incidentMediaFiles = [];
    renderIncidentMediaPreview();
    ['incident-photo-cam','incident-photo-gal','incident-video-cam'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    audioBlob = null;
    document.getElementById('audio-preview').classList.add('hidden');
}

// WhatsApp
const waModal = document.getElementById('wa-modal');
let currentWaInc = null;
function openWaModal(inc) {
    currentWaInc = inc;
    const select = document.getElementById('wa-contact-select');
    select.innerHTML = waContacts.map((c, i) => '<option value="' + i + '">' + c.nombre + ' (' + c.cargo + ')</option>').join('');
    waModal.classList.remove('hidden-modal');
}
document.getElementById('wa-cancel-btn')?.addEventListener('click', () => waModal.classList.add('hidden-modal'));
document.getElementById('wa-send-btn')?.addEventListener('click', () => {
    const c = waContacts[document.getElementById('wa-contact-select').value];
    if (!c) return;
    const msg = "*ALERTA*\nTipo: " + currentWaInc.clasificacion + "\nLugar: " + activeSession.location + "\nDetalle: " + currentWaInc.description;
    window.open("https://wa.me/" + c.numero.toString().replace(/\D/g, '') + "?text=" + encodeURIComponent(msg), '_blank');
    waModal.classList.add('hidden-modal');
});

// Audio Record
document.getElementById('record-audio-btn')?.addEventListener('click', async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
        audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const preview = document.getElementById('audio-preview');
        preview.src = URL.createObjectURL(audioBlob);
        preview.classList.remove('hidden');
    };
    mediaRecorder.start();
    document.getElementById('record-audio-btn').classList.add('hidden');
    document.getElementById('stop-audio-btn').classList.remove('hidden');
});
document.getElementById('stop-audio-btn')?.addEventListener('click', () => {
    mediaRecorder?.stop();
    document.getElementById('stop-audio-btn').classList.add('hidden');
    document.getElementById('record-audio-btn').classList.remove('hidden');
});

// --- FINALIZAR ---
document.getElementById('finish-btn')?.addEventListener('click', async () => {
    if (!confirm("¿Deseas finalizar la supervisión?")) return;

    activeSession.endTime = Date.now();
    activeSession.status = 'finished';
    history.unshift(activeSession);
    localStorage.setItem('dp_history', JSON.stringify(history.slice(0, 20)));
    localStorage.removeItem('dp_active_session');

    const sRef = fbRef('sessions/' + activeSession.sessionId);
    if (sRef) await sRef.update({ status: 'finished', endTime: activeSession.endTime, alertaActiva: false });

    const duracionMs = activeSession.endTime - activeSession.startTime;
    const duracionMin = Math.round(duracionMs / 60000);
    const finStr = formatAMPM(new Date(activeSession.endTime));
    await syncWithCloud('finish', {
        sessionId: activeSession.sessionId,
        fin: finStr,
        duracion: duracionMin + ' min',
        observaciones: activeSession.observaciones || ''
    });
    location.reload();
});

// Sync
async function syncWithCloud(action, session, extra = {}) {
    if (!GOOGLE_SHEETS_URL) return;
    try {
        await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ action, ...session, ...extra })
        });
    } catch (e) { console.error(e); }
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = history.map(h =>
        '<div style="padding:10px; border-bottom:1px solid #eee;"><strong>' + (h.location || h.protestName || '—') + '</strong> — ' + new Date(h.startTime).toLocaleDateString('es-PE') + ' · ' + Math.round(((h.endTime || Date.now()) - h.startTime) / 60000) + ' min</div>'
    ).join('') || '<p style="color:#999;font-size:0.9rem; padding:10px;">Sin registros previos.</p>';
}

function exportData() {
    if (!history || history.length === 0) {
        alert('No hay registros para exportar.');
        return;
    }
    const headers = ['ID Sesión','Tipo','Fecha','Turno','Supervisor','Oficina','Protesta','Punto','Inicio','Fin','Duración (min)','Lat Inicio','Lng Inicio'];
    const rows = history.map(h => [
        h.sessionId || '',
        h.type || '',
        h.fecha || '',
        h.turno || '',
        h.name || '',
        h.office || '',
        h.protestName || '',
        h.location || '',
        h.startTime ? formatAMPM(new Date(h.startTime)) : '',
        h.endTime   ? formatAMPM(new Date(h.endTime))   : '',
        h.startTime ? Math.round(((h.endTime || Date.now()) - h.startTime) / 60000) : '',
        h.startLat || '',
        h.startLng || ''
    ]);
    const csv = [headers, ...rows]
        .map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))
        .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'supervisiones_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Exponer funciones usadas desde HTML (onclick/onchange)
window.showMainMenu   = showMainMenu;
window.openModule     = openModule;
window.goToAlertas    = goToAlertas;
window.goToAcciones   = goToAcciones;
window.showAcpForm    = showAcpForm;
window.showPlanForm   = showPlanForm;
window.showSection        = showSection;
window.openWaModal        = openWaModal;
window.adminLogin         = adminLogin;
window.addIncidentFiles   = addIncidentFiles;
window.removeIncidentFile = removeIncidentFile;

// Arranque
document.addEventListener('DOMContentLoaded', init);
