// =============================================
// MÓDULO: COMPENSACIÓN DE HORAS — ADJUNTÍA
// Solo para personal de la Adjuntía para la
// Prevención de Conflictos Sociales y Gobernabilidad
// =============================================

const COMP_STAFF = [
    { key: 'porfirio', nombre: 'Porfirio Barrenechea', initials: 'PB', color: '#0F6E56', bg: '#E1F5EE' },
    { key: 'jefferson', nombre: 'Jefferson Parra',      initials: 'JP', color: '#854F0B', bg: '#FAEEDA' },
    { key: 'piter',    nombre: 'Piter Vega',            initials: 'PV', color: '#993556', bg: '#FBEAF0' },
    { key: 'alessia',  nombre: 'Alessia Portilla',      initials: 'AP', color: '#534AB7', bg: '#EEEDFE' },
    { key: 'jesus',    nombre: 'Jesús Vergaray',        initials: 'JV', color: '#185FA5', bg: '#E6F1FB' }
];

const COMP_DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const COMP_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ---- CÁLCULO DE HORAS COMPENSABLES ----
function compCalcHoras(fechaStr, horaInicio, horaFin) {
    // fecha en formato YYYY-MM-DD
    const d = new Date(fechaStr + 'T00:00:00');
    const diaSemana = d.getDay(); // 0=Dom, 6=Sab
    const [h1, m1] = horaInicio.split(':').map(Number);
    const [h2, m2] = horaFin.split(':').map(Number);
    const minInicio = h1 * 60 + m1;
    const minFin    = h2 * 60 + m2;

    if (minFin <= minInicio) return 0; // horario inválido

    if (diaSemana === 0 || diaSemana === 6) {
        // Fin de semana: todo cuenta
        return (minFin - minInicio) / 60;
    } else {
        // L-V: solo horas después de 17:30
        const corte = 17 * 60 + 30;
        if (minFin <= corte) return 0;
        const efectivo = minFin - Math.max(minInicio, corte);
        return efectivo / 60;
    }
}

function compFormatHoras(h) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    if (mm === 0) return `${hh} h`;
    return `${hh} h ${mm} min`;
}

function compFechaExpira(fechaSupervision) {
    const d = new Date(fechaSupervision + 'T00:00:00');
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
}

function compEstaExpirado(fechaSupervision) {
    const hoy = new Date().toISOString().split('T')[0];
    return compFechaExpira(fechaSupervision) < hoy;
}

function compFormatFecha(fechaStr) {
    if (!fechaStr) return '—';
    const [y, m, d] = fechaStr.split('-');
    return `${d}/${m}/${y}`;
}

function compTipoDia(fechaStr) {
    const d = new Date(fechaStr + 'T00:00:00').getDay();
    if (d === 0) return { texto: 'Domingo', tipo: 'fds', color: '#27ae60' };
    if (d === 6) return { texto: 'Sábado', tipo: 'fds', color: '#2980b9' };
    return { texto: COMP_DIAS[d].charAt(0).toUpperCase() + COMP_DIAS[d].slice(1), tipo: 'habil', color: '#e67e22' };
}

// ---- FIREBASE REFS ----
function compRef(path) {
    if (typeof fbRef === 'function') return fbRef('compensacion/' + path);
    return null;
}

// ---- ESTADO LOCAL ----
let _compSupervisionesCache = {}; // por staffKey → array
let _compPermisosCache = {};      // por staffKey → array
let _compCiclosCache = {};        // por staffKey → ISO date del último cierre
let _compTabActivo = 'registrar';
let _compStaffActivo = 'jesus';   // por defecto tú
let _compSemanaOffset = 0;        // semanas relativas a la actual (0 = esta semana)

// =============================================
// INICIALIZACIÓN DEL MÓDULO
// =============================================
let _compInited = false;
function initCompensacionModule() {
    if (_compInited) { renderCompPanel(); return; }
    _compInited = true;
    renderCompPanel();
    compCargarDatos();
}

function renderCompPanel() {
    const panel = document.getElementById('panel-compensacion');
    if (!panel) return;

    panel.innerHTML = `
    <div style="background:white; border-radius:20px; box-shadow:var(--shadow); padding:20px; margin-bottom:20px;">
        <!-- Cabecera -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
            <div>
                <h2 style="margin:0; font-size:1.15rem; color:var(--primary);">⏱️ Compensación de Horas — Adjuntía</h2>
                <p style="margin:4px 0 0; font-size:0.8rem; color:#777;">Solo personal de la Adjuntía para la Prevención de Conflictos Sociales y Gobernabilidad</p>
            </div>
        </div>

        <!-- Selector de persona -->
        <div id="comp-staff-selector" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px;">
            ${COMP_STAFF.map(s => `
            <button onclick="compSeleccionarStaff('${s.key}')"
                id="comp-staff-btn-${s.key}"
                style="display:flex; align-items:center; gap:8px; padding:8px 14px; border-radius:10px;
                       border:2px solid ${s.bg}; background:${s.bg}; cursor:pointer;
                       font-size:0.85rem; font-weight:600; transition:all 0.2s;">
                <span style="width:28px; height:28px; border-radius:50%; background:${s.color}; color:white;
                             display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700;">${s.initials}</span>
                ${s.nombre.split(' ')[0]}
            </button>`).join('')}
        </div>

        <!-- Saldo rápido de la persona seleccionada -->
        <div id="comp-saldo-banner" style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:12px;">
            <div style="background:#f9fafb; border-radius:12px; padding:14px; text-align:center;">
                <p style="font-size:0.75rem; color:#777; margin:0 0 4px;">Horas ganadas</p>
                <p id="comp-total-ganadas" style="font-size:1.5rem; font-weight:700; margin:0; color:#27ae60;">0 h</p>
                <p style="font-size:0.7rem; color:#aaa; margin:2px 0 0;">sin expirar</p>
            </div>
            <div style="background:#f9fafb; border-radius:12px; padding:14px; text-align:center;">
                <p style="font-size:0.75rem; color:#777; margin:0 0 4px;">Horas usadas</p>
                <p id="comp-total-usadas" style="font-size:1.5rem; font-weight:700; margin:0; color:#e67e22;">0 h</p>
                <p style="font-size:0.7rem; color:#aaa; margin:2px 0 0;">compensadas</p>
            </div>
            <div style="background:#f9fafb; border-radius:12px; padding:14px; text-align:center;">
                <p style="font-size:0.75rem; color:#777; margin:0 0 4px;">Saldo disponible</p>
                <p id="comp-saldo-disponible" style="font-size:1.5rem; font-weight:700; margin:0; color:#2980b9;">0 h</p>
                <p style="font-size:0.7rem; color:#aaa; margin:2px 0 0;">para pedir permiso</p>
            </div>
        </div>
        <!-- Indicador de ciclo activo + botón nueva compensación -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:20px; padding:10px 14px; background:#f0f4f8; border-radius:10px;">
            <p id="comp-ciclo-label" style="margin:0; font-size:0.78rem; color:#555;">⏱️ Ciclo activo: <strong id="comp-ciclo-desde">—</strong></p>
            <button onclick="compNuevoCiclo()" style="background:white; border:1.5px solid #e74c3c; color:#e74c3c; border-radius:8px; padding:6px 14px; font-size:0.78rem; font-weight:700; cursor:pointer;">
                🔄 Nueva compensación general
            </button>
        </div>

        <!-- Sub-tabs -->
        <div style="display:flex; gap:4px; border-bottom:2px solid #f0f0f0; margin-bottom:20px;">
            <button class="comp-subtab active" id="comp-tab-registrar" onclick="compCambiarTab('registrar')">📅 Registrar supervisión</button>
            <button class="comp-subtab" id="comp-tab-planificar" onclick="compCambiarTab('planificar')">✅ Programar compensación</button>
            <button class="comp-subtab" id="comp-tab-resumen" onclick="compCambiarTab('resumen')">👥 Resumen del equipo</button>
        </div>

        <!-- TAB: REGISTRAR SUPERVISIÓN -->
        <div id="comp-panel-registrar">
            <div style="background:#f9fafb; border-radius:14px; padding:16px; margin-bottom:16px;">
                <h4 style="margin:0 0 14px; font-size:0.95rem; color:var(--primary);">Nueva supervisión compensable</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                        <label class="comp-label">Comisionado/a</label>
                        <select id="comp-reg-staff" style="width:100%;" onchange="compActualizarCalculo()">
                            ${COMP_STAFF.map(s => `<option value="${s.key}">${s.nombre}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="comp-label">Fecha de supervisión</label>
                        <input type="date" id="comp-reg-fecha" style="width:100%;" onchange="compActualizarCalculo()">
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                        <label class="comp-label">Hora de inicio</label>
                        <input type="time" id="comp-reg-inicio" style="width:100%;" onchange="compActualizarCalculo()">
                    </div>
                    <div>
                        <label class="comp-label">Hora de término</label>
                        <input type="time" id="comp-reg-fin" style="width:100%;" onchange="compActualizarCalculo()">
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <label class="comp-label">Nombre / referencia de la supervisión</label>
                    <input type="text" id="comp-reg-nombre" placeholder="Ej: Marcha convocada — Congreso" style="width:100%;">
                </div>

                <!-- Vista previa cálculo -->
                <div id="comp-reg-preview" style="background:white; border-radius:10px; padding:12px; margin-bottom:12px; border:1.5px solid #e8edf3; display:none;">
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <span id="comp-preview-dia" style="font-size:0.82rem; font-weight:600;"></span>
                        <span id="comp-preview-tipo" style="font-size:0.78rem; padding:3px 10px; border-radius:20px; font-weight:600;"></span>
                        <span id="comp-preview-horas" style="font-size:0.88rem; font-weight:700;"></span>
                        <span id="comp-preview-expira" style="font-size:0.75rem; color:#e67e22;"></span>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end;">
                    <button onclick="compGuardarSupervision()" style="background:var(--primary); color:white; border:none; border-radius:8px; padding:9px 20px; font-weight:700; cursor:pointer;">
                        Guardar supervisión ✅
                    </button>
                </div>
            </div>

            <!-- Lista de supervisiones registradas -->
            <h4 style="font-size:0.9rem; color:var(--primary); margin-bottom:10px;">Supervisiones registradas</h4>
            <div id="comp-lista-supervisiones">
                <p style="text-align:center; color:#aaa; font-size:0.85rem; padding:20px 0;">Cargando...</p>
            </div>
        </div>

        <!-- TAB: PROGRAMAR PERMISO -->
        <div id="comp-panel-planificar" style="display:none;">
            <div style="background:#f9fafb; border-radius:14px; padding:16px; margin-bottom:16px;">
                <h4 style="margin:0 0 14px; font-size:0.95rem; color:var(--primary);">Registrar día de compensación</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                        <label class="comp-label">Comisionado/a</label>
                        <select id="comp-plan-staff" style="width:100%;" onchange="compActualizarPreviewPlan()">
                            ${COMP_STAFF.map(s => `<option value="${s.key}">${s.nombre}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="comp-label">Fecha del permiso</label>
                        <input type="date" id="comp-plan-fecha" style="width:100%;" onchange="compActualizarPreviewPlan()">
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                        <label class="comp-label">Hora de inicio del permiso</label>
                        <input type="time" id="comp-plan-inicio" style="width:100%;" value="09:00" onchange="compActualizarPreviewPlan()">
                    </div>
                    <div>
                        <label class="comp-label">Hora de término del permiso</label>
                        <input type="time" id="comp-plan-fin" style="width:100%;" value="13:00" onchange="compActualizarPreviewPlan()">
                    </div>
                </div>

                <!-- Vista previa del descuento -->
                <div id="comp-plan-preview" style="background:white; border-radius:10px; padding:12px; margin-bottom:12px; border:1.5px solid #e8edf3; display:none;">
                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; align-items:center;">
                        <span style="font-size:0.82rem; color:#555;">Horas a descontar: <strong id="comp-plan-descuento" style="color:var(--primary);"></strong></span>
                        <span style="font-size:0.82rem; color:#555;">Saldo actual: <strong id="comp-plan-saldo-actual" style="color:#27ae60;"></strong></span>
                        <span style="font-size:0.82rem; color:#555;">Saldo tras el permiso: <strong id="comp-plan-saldo-post" style=""></strong></span>
                    </div>
                    <div id="comp-plan-aviso" style="margin-top:8px; font-size:0.78rem; color:#c0392b; display:none;"></div>
                </div>

                <div style="display:flex; justify-content:flex-end;">
                    <button onclick="compGuardarPermiso()" style="background:var(--primary); color:white; border:none; border-radius:8px; padding:9px 20px; font-weight:700; cursor:pointer;">
                        Registrar permiso ✅
                    </button>
                </div>
            </div>

            <!-- Vista previa de la programación de la persona seleccionada -->
            <div id="comp-plan-programa-wrap">
                <h4 style="font-size:0.9rem; color:var(--primary); margin-bottom:10px;">Mi programación de compensación</h4>
                <div id="comp-lista-permisos">
                    <p style="text-align:center; color:#aaa; font-size:0.85rem; padding:20px 0;">Cargando...</p>
                </div>
            </div>
        </div>

        <!-- TAB: RESUMEN DEL EQUIPO -->
        <div id="comp-panel-resumen" style="display:none;">

            <!-- Navegación semanal -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                <div>
                    <p id="comp-semana-label" style="font-size:0.85rem; font-weight:700; color:var(--primary); margin:0;"></p>
                    <p id="comp-semana-sublabel" style="font-size:0.75rem; color:#777; margin:2px 0 0;"></p>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button onclick="compNavSemana(-1)"
                        style="background:white; border:1.5px solid #ddd; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:0.9rem;">◀</button>
                    <button onclick="compNavSemana(0)"
                        style="background:#f0f4f8; border:1.5px solid #ddd; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:0.78rem; font-weight:700; color:#555;">Hoy</button>
                    <button onclick="compNavSemana(1)"
                        style="background:white; border:1.5px solid #ddd; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:0.9rem;">▶</button>
                </div>
            </div>

            <!-- Calendario semanal -->
            <div id="comp-calendario" style="overflow-x:auto; margin-bottom:16px;">
                <p style="text-align:center; color:#aaa; font-size:0.85rem; padding:20px 0;">Cargando...</p>
            </div>

            <!-- Resumen semanal + botón correo -->
            <div id="comp-semana-footer" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background:#f9fafb; border-radius:10px; padding:12px 16px; margin-bottom:16px;">
                <div id="comp-semana-stats" style="font-size:0.82rem; color:#555;"></div>
                <button onclick="compGenerarTextoCorreo()"
                    style="background:var(--primary); color:white; border:none; border-radius:8px; padding:9px 16px; font-weight:700; cursor:pointer; white-space:nowrap;">
                    ✉️ Generar correo para el adjunto
                </button>
            </div>

            <!-- Saldos individuales -->
            <h4 style="font-size:0.88rem; color:var(--primary); margin-bottom:10px; margin-top:4px;">Saldos individuales</h4>
            <div id="comp-resumen-saldos"></div>

            <!-- Texto del correo -->
            <div id="comp-correo-wrap" style="display:none; margin-top:20px;">
                <h4 style="font-size:0.9rem; color:var(--primary); margin-bottom:8px;">📧 Texto para correo al Adjunto</h4>
                <div id="comp-correo-texto" style="background:white; border:1.5px solid #e8edf3; border-radius:10px; padding:14px; font-size:0.83rem; line-height:1.7; white-space:pre-wrap; color:#333;"></div>
                <div style="display:flex; gap:10px; margin-top:10px; justify-content:flex-end;">
                    <button onclick="compCopiarCorreo()"
                        style="background:#27ae60; color:white; border:none; border-radius:8px; padding:8px 16px; font-weight:700; cursor:pointer;">
                        📋 Copiar texto
                    </button>
                </div>
            </div>
        </div>

    </div>
    `;

    // Estilos locales
    if (!document.getElementById('comp-styles')) {
        const st = document.createElement('style');
        st.id = 'comp-styles';
        st.textContent = `
        .comp-subtab {
            padding: 8px 16px; border: none; background: transparent;
            font-size: 0.85rem; font-weight: 600; cursor: pointer;
            color: #777; border-bottom: 3px solid transparent; margin-bottom:-2px;
        }
        .comp-subtab.active { color: var(--primary); border-bottom-color: var(--primary); }
        .comp-label { display:block; font-size:0.78rem; font-weight:600; color:#555; margin-bottom:4px; }
        .comp-sup-card {
            background:white; border:1px solid #eef0f3; border-radius:10px;
            padding:12px 14px; margin-bottom:8px; display:flex;
            align-items:flex-start; justify-content:space-between; gap:10px;
        }
        .comp-sup-card.expirado { border-color:#fdecea; background:#fffafa; }
        .comp-permiso-card {
            background:white; border:1px solid #eef0f3; border-radius:10px;
            padding:11px 14px; margin-bottom:8px; display:flex;
            align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
        }
        select, input[type="date"], input[type="time"], input[type="text"], input[type="number"] {
            padding: 8px 10px; border-radius: 8px; border: 1.5px solid #ddd;
            font-size: 0.85rem; font-family: inherit;
        }
        select:focus, input:focus { outline: none; border-color: var(--primary); }
        `;
        document.head.appendChild(st);
    }

    // Inicializar fechas por defecto
    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const el = v => document.getElementById(v);
    if (el('comp-reg-fecha')) el('comp-reg-fecha').value = hoy;
    if (el('comp-plan-fecha')) el('comp-plan-fecha').value = hoy;
    if (el('comp-rango-desde')) el('comp-rango-desde').value = hace30;
    if (el('comp-rango-hasta')) el('comp-rango-hasta').value = hoy;

    // Seleccionar persona activa
    compSeleccionarStaff(_compStaffActivo, false);
}

// =============================================
// CARGA DE DATOS DESDE FIREBASE
// =============================================
function compCargarDatos() {
    COMP_STAFF.forEach(s => {
        const refSup = compRef(`supervisiones/${s.key}`);
        if (refSup) {
            refSup.on('value', snap => {
                const data = snap.val() || {};
                _compSupervisionesCache[s.key] = Object.entries(data).map(([id, v]) => ({ id, ...v }));
                _compSupervisionesCache[s.key].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
                compActualizarUI();
            });
        }

        const refPlan = compRef(`permisos/${s.key}`);
        if (refPlan) {
            refPlan.on('value', snap => {
                const data = snap.val() || {};
                _compPermisosCache[s.key] = Object.entries(data).map(([id, v]) => ({ id, ...v }));
                _compPermisosCache[s.key].sort((a, b) => (b.fechaPermiso || '').localeCompare(a.fechaPermiso || ''));
                compActualizarUI();
            });
        }

        // Ciclos: fecha ISO del último cierre de ciclo
        const refCiclo = compRef(`ciclos/${s.key}`);
        if (refCiclo) {
            refCiclo.on('value', snap => {
                _compCiclosCache[s.key] = snap.val() || null; // string ISO o null
                compActualizarUI();
            });
        }
    });
}

// =============================================
// GUARDAR SUPERVISIÓN
// =============================================
function compGuardarSupervision() {
    const staffKey = document.getElementById('comp-reg-staff')?.value;
    const fecha    = document.getElementById('comp-reg-fecha')?.value;
    const inicio   = document.getElementById('comp-reg-inicio')?.value;
    const fin      = document.getElementById('comp-reg-fin')?.value;
    const nombre   = document.getElementById('comp-reg-nombre')?.value?.trim();

    if (!staffKey || !fecha || !inicio || !fin) {
        alert('Completa todos los campos de fecha y horario.');
        return;
    }
    if (fin <= inicio) {
        alert('La hora de término debe ser posterior a la de inicio.');
        return;
    }

    const horas = compCalcHoras(fecha, inicio, fin);
    const expira = compFechaExpira(fecha);
    const tipoDia = compTipoDia(fecha);

    const registro = {
        fecha, horaInicio: inicio, horaFin: fin,
        nombre: nombre || 'Supervisión',
        horasCompensables: Math.round(horas * 100) / 100,
        tipoDia: tipoDia.tipo,
        expira,
        timestamp: Date.now()
    };

    const ref = compRef(`supervisiones/${staffKey}`);
    if (ref) {
        ref.push(registro)
            .then(() => {
                showToast && showToast('✅ Supervisión registrada correctamente', '#27ae60');
                document.getElementById('comp-reg-nombre').value = '';
                document.getElementById('comp-reg-inicio').value = '';
                document.getElementById('comp-reg-fin').value = '';
                document.getElementById('comp-reg-preview').style.display = 'none';
            })
            .catch(err => alert('Error al guardar: ' + err.message));
    } else {
        // Demo sin Firebase
        if (!_compSupervisionesCache[staffKey]) _compSupervisionesCache[staffKey] = [];
        _compSupervisionesCache[staffKey].unshift({ id: Date.now().toString(), ...registro });
        compActualizarUI();
        showToast && showToast('✅ Supervisión registrada (modo local)', '#27ae60');
    }
}

// =============================================
// GUARDAR PERMISO
// =============================================
function compGuardarPermiso() {
    const staffKey = document.getElementById('comp-plan-staff')?.value;
    const fecha    = document.getElementById('comp-plan-fecha')?.value;
    const inicio   = document.getElementById('comp-plan-inicio')?.value;
    const fin      = document.getElementById('comp-plan-fin')?.value;

    if (!staffKey || !fecha || !inicio || !fin) {
        alert('Completa todos los campos de fecha y horario del permiso.');
        return;
    }
    if (fin <= inicio) {
        alert('La hora de término debe ser posterior a la de inicio.');
        return;
    }

    const [h1, m1] = inicio.split(':').map(Number);
    const [h2, m2] = fin.split(':').map(Number);
    const horas = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;

    const { ganadas, usadas } = compCalcularSaldo(staffKey);
    const saldo = ganadas - usadas;

    if (horas > saldo + 0.01) {
        if (!confirm(`⚠️ Las horas del permiso (${compFormatHoras(horas)}) superan el saldo disponible (${compFormatHoras(saldo)}). ¿Deseas registrar de todas formas?`)) return;
    }

    const permiso = {
        fechaPermiso: fecha,
        horaInicio: inicio,
        horaFin: fin,
        horas: Math.round(horas * 100) / 100,
        timestamp: Date.now()
    };

    const ref = compRef(`permisos/${staffKey}`);
    if (ref) {
        ref.push(permiso)
            .then(() => {
                showToast && showToast('✅ Permiso registrado correctamente', '#27ae60');
                document.getElementById('comp-plan-preview').style.display = 'none';
            })
            .catch(err => alert('Error al guardar: ' + err.message));
    } else {
        if (!_compPermisosCache[staffKey]) _compPermisosCache[staffKey] = [];
        _compPermisosCache[staffKey].unshift({ id: Date.now().toString(), ...permiso });
        compActualizarUI();
        showToast && showToast('✅ Permiso registrado (modo local)', '#27ae60');
    }
}

// =============================================
// CALCULAR SALDO
// =============================================
function compCalcularSaldo(staffKey) {
    // Fecha de inicio del ciclo activo (null = desde siempre)
    const inicioCiclo = _compCiclosCache[staffKey] || null;

    const sups = _compSupervisionesCache[staffKey] || [];
    // Solo supervisiones NO expiradas y dentro del ciclo activo
    const ganadas = sups
        .filter(s => !compEstaExpirado(s.fecha) && (!inicioCiclo || s.fecha >= inicioCiclo))
        .reduce((acc, s) => acc + (s.horasCompensables || 0), 0);

    const permisos = _compPermisosCache[staffKey] || [];
    // Solo permisos dentro del ciclo activo
    const usadas = permisos
        .filter(p => !inicioCiclo || p.fechaPermiso >= inicioCiclo)
        .reduce((acc, p) => acc + (p.horas || 0), 0);

    return { ganadas, usadas, inicioCiclo };
}

// =============================================
// ACTUALIZAR UI (SALDO BANNER + LISTAS)
// =============================================
function compActualizarUI() {
    const staff = _compStaffActivo;
    const { ganadas, usadas, inicioCiclo } = compCalcularSaldo(staff);
    const saldo = Math.max(0, ganadas - usadas);

    const g = document.getElementById('comp-total-ganadas');
    const u = document.getElementById('comp-total-usadas');
    const d = document.getElementById('comp-saldo-disponible');
    if (g) g.textContent = compFormatHoras(ganadas);
    if (u) u.textContent = compFormatHoras(usadas);
    if (d) { d.textContent = compFormatHoras(saldo); d.style.color = saldo <= 0 ? '#e74c3c' : '#2980b9'; }

    // Etiqueta del ciclo activo
    const cicloDesde = document.getElementById('comp-ciclo-desde');
    if (cicloDesde) {
        cicloDesde.textContent = inicioCiclo
            ? compFormatFecha(inicioCiclo)
            : 'inicio del registro';
    }

    compRenderListaSupervisiones();
    compRenderListaPermisos();
    compRenderResumen();
}

// =============================================
// RENDER LISTA SUPERVISIONES
// =============================================
function compRenderListaSupervisiones() {
    const container = document.getElementById('comp-lista-supervisiones');
    if (!container) return;
    const sups = _compSupervisionesCache[_compStaffActivo] || [];

    if (!sups.length) {
        container.innerHTML = '<p style="text-align:center; color:#aaa; font-size:0.85rem; padding:20px 0;">No hay supervisiones registradas.</p>';
        return;
    }

    const inicioCiclo = _compCiclosCache[_compStaffActivo] || null;

    container.innerHTML = sups.map(s => {
        const expirado = compEstaExpirado(s.fecha);
        const esCicloAnterior = inicioCiclo && s.fecha < inicioCiclo;
        const tipoDia = compTipoDia(s.fecha);
        const diasRestantes = expirado ? 0 : Math.floor((new Date(s.expira + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24));
        return `
        <div class="comp-sup-card ${expirado || esCicloAnterior ? 'expirado' : ''}">
            <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
                    <strong style="font-size:0.88rem; color:${expirado || esCicloAnterior ? '#aaa' : 'var(--primary)'};">${s.nombre || 'Supervisión'}</strong>
                    <span style="font-size:0.73rem; padding:2px 8px; border-radius:20px; font-weight:600;
                                 background:${tipoDia.tipo === 'fds' ? '#eaf7f0' : '#fef9e7'};
                                 color:${tipoDia.color};">${tipoDia.texto}</span>
                    ${esCicloAnterior ? '<span style="font-size:0.73rem; padding:2px 8px; border-radius:20px; background:#f0f0f0; color:#888; font-weight:600;">📦 Ciclo anterior</span>' : ''}
                    ${expirado && !esCicloAnterior ? '<span style="font-size:0.73rem; padding:2px 8px; border-radius:20px; background:#fdecea; color:#c0392b; font-weight:600;">⚠️ Expirado</span>' : ''}
                </div>
                <div style="font-size:0.8rem; color:#777; display:flex; gap:14px; flex-wrap:wrap;">
                    <span>📅 ${compFormatFecha(s.fecha)}</span>
                    <span>🕐 ${s.horaInicio} – ${s.horaFin}</span>
                    ${!expirado ? `<span style="color:#e67e22;">Expira en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''} (${compFormatFecha(s.expira)})</span>` : `<span style="color:#c0392b;">Expiró el ${compFormatFecha(s.expira)}</span>`}
                </div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
                <div style="font-size:1.1rem; font-weight:700; color:${expirado ? '#ccc' : '#27ae60'};">${compFormatHoras(s.horasCompensables || 0)}</div>
                <div style="font-size:0.72rem; color:#aaa;">compensables</div>
                <button onclick="compEliminarSupervision('${_compStaffActivo}', '${s.id}')"
                    style="margin-top:6px; background:none; border:none; color:#e74c3c; cursor:pointer; font-size:0.75rem; padding:0;">🗑️ Eliminar</button>
            </div>
        </div>`;
    }).join('');
}

// =============================================
// RENDER LISTA PERMISOS (vista previa plan)
// =============================================
function compRenderListaPermisos() {
    const container = document.getElementById('comp-lista-permisos');
    if (!container) return;
    const hoy = new Date().toISOString().split('T')[0];
    const permisos = _compPermisosCache[_compStaffActivo] || [];

    if (!permisos.length) {
        container.innerHTML = '<p style="text-align:center; color:#aaa; font-size:0.85rem; padding:20px 0;">No hay días de compensación registrados.</p>';
        return;
    }

    const inicioCicloP = _compCiclosCache[_compStaffActivo] || null;

    container.innerHTML = permisos.map(p => {
        const tomado = p.fechaPermiso <= hoy;
        const esCicloAnteriorP = inicioCicloP && p.fechaPermiso < inicioCicloP;
        return `
        <div class="comp-permiso-card" style="${esCicloAnteriorP ? 'opacity:0.5;' : ''}">
            <div>
                <span style="font-size:0.88rem; font-weight:600; color:${esCicloAnteriorP ? '#aaa' : tomado ? '#27ae60' : '#2980b9'};">
                    ${esCicloAnteriorP ? '📦' : tomado ? '✅' : '🗓️'} ${compFormatFecha(p.fechaPermiso)}
                </span>
                ${esCicloAnteriorP ? '<span style="font-size:0.72rem; color:#aaa; margin-left:8px;">ciclo anterior</span>' : ''}
                <span style="font-size:0.8rem; color:#777; margin-left:10px;">
                    ${p.horaInicio} – ${p.horaFin}
                </span>
                <span style="font-size:0.75rem; padding:2px 8px; border-radius:20px; margin-left:8px;
                             background:${tomado ? '#eaf7f0' : '#eaf0fb'};
                             color:${tomado ? '#27ae60' : '#2980b9'}; font-weight:600;">
                    ${tomado ? 'Tomado' : 'Planificado'}
                </span>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <strong style="font-size:0.95rem; color:var(--primary);">${compFormatHoras(p.horas || 0)}</strong>
                <button onclick="compEliminarPermiso('${_compStaffActivo}', '${p.id}')"
                    style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:0.75rem; padding:0;">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

// =============================================
// HELPERS DE SEMANA
// =============================================
function compGetLunesDeSemana(offset) {
    const hoy = new Date();
    const diaSemana = hoy.getDay(); // 0=Dom
    const diffLunes = (diaSemana === 0) ? -6 : 1 - diaSemana;
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + diffLunes + offset * 7);
    lunes.setHours(0, 0, 0, 0);
    return lunes;
}

function compFechaISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function compNombreDia(date) {
    return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][date.getDay()];
}

// =============================================
// NAVEGACIÓN DE SEMANA
// =============================================
function compNavSemana(delta) {
    if (delta === 0) {
        _compSemanaOffset = 0;
    } else {
        _compSemanaOffset += delta;
    }
    compRenderResumen();
    // Ocultar correo anterior al navegar
    const wrap = document.getElementById('comp-correo-wrap');
    if (wrap) wrap.style.display = 'none';
}

// =============================================
// RENDER RESUMEN EQUIPO (CALENDARIO SEMANAL)
// =============================================
function compRenderResumen() {
    const calContainer = document.getElementById('comp-calendario');
    const labelEl      = document.getElementById('comp-semana-label');
    const sublabelEl   = document.getElementById('comp-semana-sublabel');
    const statsEl      = document.getElementById('comp-semana-stats');
    const saldosEl     = document.getElementById('comp-resumen-saldos');
    if (!calContainer) return;

    // --- Calcular días de la semana ---
    const lunes = compGetLunesDeSemana(_compSemanaOffset);
    const dias = [];
    for (let i = 0; i < 5; i++) {
        const d = new Date(lunes);
        d.setDate(lunes.getDate() + i);
        dias.push(d);
    }
    const desde = compFechaISO(dias[0]);
    const hasta = compFechaISO(dias[4]);

    // --- Etiquetas de semana ---
    const hoyISO = new Date().toISOString().split('T')[0];
    const esEstaS = _compSemanaOffset === 0;
    const esPasada = _compSemanaOffset < 0;
    const esFutura = _compSemanaOffset > 0;
    if (labelEl) {
        const mesDesde = COMP_MESES[dias[0].getMonth()];
        const mesHasta = COMP_MESES[dias[4].getMonth()];
        const mesStr = mesDesde === mesHasta
            ? `${dias[0].getDate()} al ${dias[4].getDate()} de ${mesDesde}`
            : `${dias[0].getDate()} de ${mesDesde} al ${dias[4].getDate()} de ${mesHasta}`;
        labelEl.textContent = `Semana del ${mesStr} de ${dias[0].getFullYear()}`;
    }
    if (sublabelEl) {
        sublabelEl.textContent = esEstaS ? 'Semana actual' : esPasada ? `Hace ${Math.abs(_compSemanaOffset)} semana${Math.abs(_compSemanaOffset) > 1 ? 's' : ''}` : `En ${_compSemanaOffset} semana${_compSemanaOffset > 1 ? 's' : ''}`;
    }

    // --- Construir calendario ---
    const COL_PERSON = '90px';
    const COL_DIA = '1fr';

    let calHtml = `<div style="min-width:520px;">`;

    // Fila de cabecera
    calHtml += `<div style="display:grid; grid-template-columns:${COL_PERSON} repeat(5,${COL_DIA}); gap:4px; margin-bottom:4px;">`;
    calHtml += `<div></div>`;
    dias.forEach(d => {
        const esHoy = compFechaISO(d) === hoyISO;
        calHtml += `<div style="text-align:center; font-size:0.75rem; font-weight:${esHoy ? '700' : '500'};
                        color:${esHoy ? 'var(--primary)' : '#777'};
                        padding:4px 2px; border-bottom:${esHoy ? '2px solid var(--primary)' : '1px solid #eee'};">
                        ${compNombreDia(d)}<br>${d.getDate()}
                    </div>`;
    });
    calHtml += `</div>`;

    // Filas por persona
    let totalPermisosSemana = 0;
    let totalHorasSemana = 0;
    let personasConPermiso = 0;

    COMP_STAFF.forEach(s => {
        const permisos = _compPermisosCache[s.key] || [];
        const permisosPorDia = {};
        permisos.forEach(p => { if (p.fechaPermiso >= desde && p.fechaPermiso <= hasta) permisosPorDia[p.fechaPermiso] = p; });

        const tieneAlgo = Object.keys(permisosPorDia).length > 0;
        if (tieneAlgo) personasConPermiso++;

        calHtml += `<div style="display:grid; grid-template-columns:${COL_PERSON} repeat(5,${COL_DIA}); gap:4px; margin-bottom:4px; align-items:stretch;">`;

        // Nombre
        calHtml += `<div style="display:flex; align-items:center; gap:6px; padding-right:4px;">
            <span style="width:22px; height:22px; border-radius:50%; background:${s.color}; color:white;
                         display:inline-flex; align-items:center; justify-content:center;
                         font-size:0.65rem; font-weight:700; flex-shrink:0;">${s.initials}</span>
            <span style="font-size:0.78rem; color:#555; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.nombre.split(' ')[0]}</span>
        </div>`;

        // Celdas de días
        dias.forEach(d => {
            const iso = compFechaISO(d);
            const p = permisosPorDia[iso];
            const esHoy = iso === hoyISO;
            if (p) {
                totalPermisosSemana++;
                totalHorasSemana += p.horas || 0;
                const tomado = iso <= hoyISO;
                calHtml += `<div style="border-radius:6px; background:${s.bg}; border:1px solid ${s.color}40;
                                padding:5px 6px; min-height:38px;">
                    <div style="font-size:0.72rem; font-weight:600; color:${s.color}; line-height:1.3;">${p.horaInicio}–${p.horaFin}</div>
                    <div style="font-size:0.67rem; color:${s.color}; opacity:0.8;">${compFormatHoras(p.horas || 0)}</div>
                    ${tomado ? `<div style="font-size:0.62rem; color:${s.color}; opacity:0.7;">✓ tomado</div>` : ''}
                </div>`;
            } else {
                calHtml += `<div style="border-radius:6px; min-height:38px;
                                background:${esHoy ? '#f0f4f8' : '#fafbfc'};
                                border:1px solid ${esHoy ? '#c5d5e8' : '#eee'};"></div>`;
            }
        });

        calHtml += `</div>`;
    });

    calHtml += `</div>`;
    calContainer.innerHTML = calHtml;

    // --- Stats de la semana ---
    if (statsEl) {
        statsEl.innerHTML = `
            <span style="margin-right:16px;">Personas con permiso: <strong>${personasConPermiso}</strong></span>
            <span style="margin-right:16px;">Días registrados: <strong>${totalPermisosSemana}</strong></span>
            <span>Total horas: <strong>${compFormatHoras(totalHorasSemana)}</strong></span>`;
    }

    // --- Saldos individuales ---
    if (saldosEl) {
        let sHtml = `<div style="overflow-x:auto; border-radius:10px; border:1px solid #eee;">
        <table style="width:100%; border-collapse:collapse; font-size:0.8rem; background:white;">
            <thead>
                <tr style="background:#f5f7fa;">
                    <th style="padding:8px 12px; text-align:left; font-weight:700; color:#555;">Comisionado/a</th>
                    <th style="padding:8px 12px; text-align:center; color:#27ae60;">Ganadas</th>
                    <th style="padding:8px 12px; text-align:center; color:#e67e22;">Usadas</th>
                    <th style="padding:8px 12px; text-align:center; color:#2980b9;">Saldo</th>
                    <th style="padding:8px 12px; text-align:center; color:#e74c3c;">Vencen pronto</th>
                </tr>
            </thead>
            <tbody>`;

        COMP_STAFF.forEach(s => {
            const { ganadas, usadas } = compCalcularSaldo(s.key);
            const saldo = Math.max(0, ganadas - usadas);
            // Supervisiones que vencen en los próximos 7 días
            const hoy = new Date();
            const en7 = new Date(hoy); en7.setDate(hoy.getDate() + 7);
            const en7ISO = compFechaISO(en7);
            const hoyISO2 = compFechaISO(hoy);
            const proxVencer = (_compSupervisionesCache[s.key] || [])
                .filter(sv => !compEstaExpirado(sv.fecha) && sv.expira <= en7ISO && sv.expira >= hoyISO2);

            sHtml += `<tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:8px 12px;">
                    <div style="display:flex; align-items:center; gap:7px;">
                        <span style="width:22px; height:22px; border-radius:50%; background:${s.color}; color:white;
                                     display:inline-flex; align-items:center; justify-content:center;
                                     font-size:0.65rem; font-weight:700;">${s.initials}</span>
                        ${s.nombre}
                    </div>
                </td>
                <td style="padding:8px 12px; text-align:center; color:#27ae60; font-weight:700;">${compFormatHoras(ganadas)}</td>
                <td style="padding:8px 12px; text-align:center; color:#e67e22; font-weight:700;">${compFormatHoras(usadas)}</td>
                <td style="padding:8px 12px; text-align:center; font-weight:700; color:${saldo <= 0 ? '#e74c3c' : '#2980b9'};">${compFormatHoras(saldo)}</td>
                <td style="padding:8px 12px; text-align:center;">
                    ${proxVencer.length > 0
                        ? `<span style="color:#e74c3c; font-weight:700;">${proxVencer.length} superv.</span>`
                        : '<span style="color:#aaa;">—</span>'}
                </td>
            </tr>`;
        });

        sHtml += `</tbody></table></div>`;
        saldosEl.innerHTML = sHtml;
    }
}

// =============================================
// GENERAR TEXTO PARA CORREO AL ADJUNTO
// =============================================
function compGenerarTextoCorreo() {
    // Usar la semana visible en el calendario
    const lunes = compGetLunesDeSemana(_compSemanaOffset);
    const viernes = new Date(lunes);
    viernes.setDate(lunes.getDate() + 4);
    const desde = compFechaISO(lunes);
    const hasta  = compFechaISO(viernes);

    const fmtDesde = `${lunes.getDate()} de ${COMP_MESES[lunes.getMonth()]}`;
    const fmtHasta = `${viernes.getDate()} de ${COMP_MESES[viernes.getMonth()]} de ${viernes.getFullYear()}`;
    const fmtRango = `${fmtDesde} al ${fmtHasta}`;

    const ahora = new Date();
    const hoy = `${ahora.getDate()} de ${COMP_MESES[ahora.getMonth()]} de ${ahora.getFullYear()}`;

    // Recolectar permisos de la semana, ordenados por fecha
    const todasLineas = [];
    COMP_STAFF.forEach(s => {
        const permisosSemana = (_compPermisosCache[s.key] || [])
            .filter(p => p.fechaPermiso >= desde && p.fechaPermiso <= hasta)
            .sort((a, b) => a.fechaPermiso.localeCompare(b.fechaPermiso));
        if (!permisosSemana.length) return;

        todasLineas.push({ nombre: s.nombre, permisos: permisosSemana });
    });

    // Construir tabla de texto alineada
    let tablaLineas = [];
    const cabecera = ['Comisionado/a', 'Día', 'Fecha', 'Horario', 'Horas'];
    const filas = [];
    todasLineas.forEach(({ nombre, permisos }) => {
        permisos.forEach(p => {
            const fecha = new Date(p.fechaPermiso + 'T00:00:00');
            const diaNombre = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][fecha.getDay()];
            filas.push([
                nombre,
                diaNombre.charAt(0).toUpperCase() + diaNombre.slice(1),
                compFormatFecha(p.fechaPermiso),
                `${p.horaInicio} – ${p.horaFin}`,
                compFormatHoras(p.horas || 0)
            ]);
        });
    });

    // Calcular anchos de columna
    const anchos = cabecera.map((c, i) => Math.max(c.length, ...filas.map(f => f[i].length)));
    const fmtFila = f => f.map((v, i) => v.padEnd(anchos[i])).join('  |  ');
    const separador = anchos.map(a => '-'.repeat(a)).join('--+--');

    const tablaTexto = filas.length
        ? [fmtFila(cabecera), separador, ...filas.map(fmtFila)].join('\n')
        : '(No se registraron días de compensación para esta semana.)';

    const totalHoras = filas.reduce((acc, f) => {
        const match = f[4].match(/(\d+)\s*h(?:\s*(\d+)\s*min)?/);
        if (!match) return acc;
        return acc + parseInt(match[1] || 0) + (parseInt(match[2] || 0) / 60);
    }, 0);

    const texto = `Lima, ${hoy}

De  : Personal de la Adjuntía para la Prevención de Conflictos Sociales y Gobernabilidad
Para: Adjunto para la Prevención de Conflictos Sociales y Gobernabilidad

Asunto: Solicitud de compensación de horas — semana del ${fmtRango}

Estimado Adjunto,

Por medio del presente, el personal de la Adjuntía solicita su aprobación para hacer uso de la compensación de horas correspondiente a supervisiones realizadas fuera del horario habitual de trabajo (horas posteriores a las 17:30 en días hábiles, y jornadas de sábado y domingo), conforme a lo establecido.

Los días y horarios de compensación programados para la semana del ${fmtRango} son los siguientes:

${tablaTexto}

Total de horas en el período: ${compFormatHoras(totalHoras)}

Quedamos a disposición para cualquier consulta adicional.

Atentamente,
Personal de la Adjuntía para la Prevención de Conflictos Sociales y Gobernabilidad`;

    const wrap = document.getElementById('comp-correo-wrap');
    const textoEl = document.getElementById('comp-correo-texto');
    if (wrap) { wrap.style.display = 'block'; wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (textoEl) textoEl.textContent = texto;
}

function compCopiarCorreo() {
    const texto = document.getElementById('comp-correo-texto')?.textContent || '';
    if (navigator.clipboard) {
        navigator.clipboard.writeText(texto).then(() => {
            showToast && showToast('📋 Texto copiado al portapapeles', '#27ae60');
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = texto;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast && showToast('📋 Texto copiado', '#27ae60');
    }
}

// =============================================
// VISTA PREVIA EN TIEMPO REAL — SUPERVISIÓN
// =============================================
function compActualizarCalculo() {
    const fecha  = document.getElementById('comp-reg-fecha')?.value;
    const inicio = document.getElementById('comp-reg-inicio')?.value;
    const fin    = document.getElementById('comp-reg-fin')?.value;
    const preview = document.getElementById('comp-reg-preview');
    if (!preview) return;
    if (!fecha || !inicio || !fin) { preview.style.display = 'none'; return; }

    const horas = compCalcHoras(fecha, inicio, fin);
    const tipoDia = compTipoDia(fecha);
    const expira = compFechaExpira(fecha);
    const diasExp = Math.floor((new Date(expira + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24));

    const elDia   = document.getElementById('comp-preview-dia');
    const elTipo  = document.getElementById('comp-preview-tipo');
    const elHoras = document.getElementById('comp-preview-horas');
    const elExp   = document.getElementById('comp-preview-expira');

    if (elDia)   elDia.textContent = `📅 ${compFormatFecha(fecha)} — ${tipoDia.texto}`;
    if (elTipo) {
        elTipo.textContent = tipoDia.tipo === 'fds' ? '📌 Fin de semana: todo el período cuenta' : '📌 Día hábil: horas después de las 17:30';
        elTipo.style.background = tipoDia.tipo === 'fds' ? '#eaf7f0' : '#fef9e7';
        elTipo.style.color = tipoDia.color;
    }
    if (elHoras) {
        elHoras.textContent = horas > 0 ? `✅ ${compFormatHoras(horas)} compensables` : '⚠️ Sin horas compensables (antes de las 17:30)';
        elHoras.style.color = horas > 0 ? '#27ae60' : '#e74c3c';
    }
    if (elExp)   elExp.textContent = `⏳ Vence el ${compFormatFecha(expira)} (${diasExp} días)`;

    preview.style.display = 'block';
}

// =============================================
// VISTA PREVIA EN TIEMPO REAL — PERMISO
// =============================================
function compActualizarPreviewPlan() {
    const staffKey = document.getElementById('comp-plan-staff')?.value;
    const inicio   = document.getElementById('comp-plan-inicio')?.value;
    const fin      = document.getElementById('comp-plan-fin')?.value;
    const preview  = document.getElementById('comp-plan-preview');
    if (!preview || !inicio || !fin || !staffKey) { if (preview) preview.style.display = 'none'; return; }

    const [h1, m1] = inicio.split(':').map(Number);
    const [h2, m2] = fin.split(':').map(Number);
    const horas = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
    if (horas <= 0) { preview.style.display = 'none'; return; }

    const { ganadas, usadas } = compCalcularSaldo(staffKey);
    const saldo = ganadas - usadas;
    const saldoPost = saldo - horas;

    const elDesc    = document.getElementById('comp-plan-descuento');
    const elSaldo   = document.getElementById('comp-plan-saldo-actual');
    const elPost    = document.getElementById('comp-plan-saldo-post');
    const elAviso   = document.getElementById('comp-plan-aviso');

    if (elDesc)  elDesc.textContent  = compFormatHoras(horas);
    if (elSaldo) elSaldo.textContent = compFormatHoras(saldo);
    if (elPost) {
        elPost.textContent = compFormatHoras(Math.abs(saldoPost));
        elPost.style.color = saldoPost < 0 ? '#e74c3c' : '#27ae60';
        elPost.textContent = saldoPost < 0
            ? `−${compFormatHoras(Math.abs(saldoPost))} (déficit)`
            : compFormatHoras(saldoPost);
    }
    if (elAviso) {
        if (saldoPost < -0.01) {
            elAviso.style.display = 'block';
            elAviso.textContent = `⚠️ Este permiso supera el saldo disponible. Se registrará como anticipado.`;
        } else {
            elAviso.style.display = 'none';
        }
    }

    preview.style.display = 'block';
}

// =============================================
// CAMBIAR PERSONA ACTIVA
// =============================================
function compSeleccionarStaff(key, updateSelects = true) {
    _compStaffActivo = key;

    // Resaltar botón activo
    COMP_STAFF.forEach(s => {
        const btn = document.getElementById(`comp-staff-btn-${s.key}`);
        if (!btn) return;
        if (s.key === key) {
            btn.style.border = `2px solid ${s.color}`;
            btn.style.boxShadow = `0 0 0 2px ${s.color}40`;
        } else {
            btn.style.border = `2px solid ${s.bg}`;
            btn.style.boxShadow = 'none';
        }
    });

    // Sincronizar selects con la persona activa
    if (updateSelects) {
        const regStaff  = document.getElementById('comp-reg-staff');
        const planStaff = document.getElementById('comp-plan-staff');
        if (regStaff)  regStaff.value  = key;
        if (planStaff) planStaff.value = key;
    }

    compActualizarUI();
}

// =============================================
// CAMBIAR SUB-TAB
// =============================================
function compCambiarTab(tab) {
    _compTabActivo = tab;
    ['registrar','planificar','resumen'].forEach(t => {
        const btn   = document.getElementById(`comp-tab-${t}`);
        const panel = document.getElementById(`comp-panel-${t}`);
        if (btn)   btn.classList.toggle('active', t === tab);
        if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    });
    if (tab === 'resumen') { _compSemanaOffset = 0; compRenderResumen(); }
    if (tab === 'planificar') compActualizarPreviewPlan();
}

// =============================================
// ELIMINAR REGISTROS
// =============================================
function compEliminarSupervision(staffKey, id) {
    if (!confirm('¿Eliminar esta supervisión?')) return;
    const ref = compRef(`supervisiones/${staffKey}/${id}`);
    if (ref) {
        ref.remove().catch(err => alert('Error: ' + err.message));
    } else {
        _compSupervisionesCache[staffKey] = (_compSupervisionesCache[staffKey] || []).filter(s => s.id !== id);
        compActualizarUI();
    }
}

function compEliminarPermiso(staffKey, id) {
    if (!confirm('¿Eliminar este permiso?')) return;
    const ref = compRef(`permisos/${staffKey}/${id}`);
    if (ref) {
        ref.remove().catch(err => alert('Error: ' + err.message));
    } else {
        _compPermisosCache[staffKey] = (_compPermisosCache[staffKey] || []).filter(p => p.id !== id);
        compActualizarUI();
    }
}

// =============================================
// NUEVA COMPENSACIÓN GENERAL (cerrar ciclo)
// =============================================
function compNuevoCiclo() {
    const staff = _compStaffActivo;
    const staffInfo = COMP_STAFF.find(s => s.key === staff);
    const nombre = staffInfo ? staffInfo.nombre : staff;

    const hoy = new Date().toISOString().split('T')[0];
    const { ganadas, usadas } = compCalcularSaldo(staff);
    const saldo = Math.max(0, ganadas - usadas);

    const msg = saldo > 0
        ? `¿Cerrar el ciclo actual de ${nombre} y abrir una nueva compensación general?\n\nOjo: quedan ${compFormatHoras(saldo)} de saldo que NO se trasladarán. Los registros anteriores quedan en el historial pero no contarán en el nuevo ciclo.`
        : `¿Cerrar el ciclo actual de ${nombre} y abrir una nueva compensación general?\n\nEl saldo actual es 0. Los nuevos registros comenzarán desde hoy (${compFormatFecha(hoy)}).`;

    if (!confirm(msg)) return;

    const ref = compRef(`ciclos/${staff}`);
    if (ref) {
        ref.set(hoy)
            .then(() => {
                showToast && showToast(`🔄 Nuevo ciclo iniciado para ${nombre.split(' ')[0]} (${compFormatFecha(hoy)})`, '#2980b9');
            })
            .catch(err => alert('Error: ' + err.message));
    } else {
        // Modo local (sin Firebase)
        _compCiclosCache[staff] = hoy;
        compActualizarUI();
        showToast && showToast(`🔄 Nuevo ciclo iniciado (modo local)`, '#2980b9');
    }
}

// =============================================
// EXPORTS GLOBALES
// =============================================
window.initCompensacionModule    = initCompensacionModule;
window.compSeleccionarStaff      = compSeleccionarStaff;
window.compCambiarTab            = compCambiarTab;
window.compActualizarCalculo     = compActualizarCalculo;
window.compActualizarPreviewPlan = compActualizarPreviewPlan;
window.compGuardarSupervision    = compGuardarSupervision;
window.compGuardarPermiso        = compGuardarPermiso;
window.compEliminarSupervision   = compEliminarSupervision;
window.compEliminarPermiso       = compEliminarPermiso;
window.compRenderResumen         = compRenderResumen;
window.compNavSemana             = compNavSemana;
window.compGenerarTextoCorreo    = compGenerarTextoCorreo;
window.compCopiarCorreo          = compCopiarCorreo;
window.compNuevoCiclo            = compNuevoCiclo;
