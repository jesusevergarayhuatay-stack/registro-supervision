// Configuración
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyU39crOG9YAY5gOoVo7FSHXoaV0M7YSYNebqkKLm-qNyvbA3gLVZX1LaTsDZC05OFAWg/exec";

// Elementos
const filterDate = document.getElementById('filter-date');
const filterProtest = document.getElementById('filter-protest');
const filterRegion = document.getElementById('filter-region');
const refreshBtn = document.getElementById('refresh-btn');
const reportsList = document.getElementById('reports-list');
const loadingIndicator = document.getElementById('loading');
const statTotal = document.getElementById('stat-total');
const statSupervisors = document.getElementById('stat-supervisors');
const statIncidents = document.getElementById('stat-incidents');

let allData = [];

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    // Set fecha de hoy por defecto en formato YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    filterDate.value = today;

    fetchData();
});

refreshBtn.addEventListener('click', fetchData);
filterDate.addEventListener('change', renderDashboard);
filterRegion.addEventListener('change', renderDashboard);
filterProtest.addEventListener('change', renderDashboard);

async function fetchData() {
    loadingIndicator.style.display = 'block';
    reportsList.innerHTML = '';

    try {
        const response = await fetch(GOOGLE_SHEETS_URL);
        const json = await response.json();

        // Detectar si es la estructura nueva { registros: [], incidencias: [] }
        if (json.registros && json.incidencias) {
            allData = processRelationalData(json.registros, json.incidencias);
            populateProtestFilter(allData);
            renderDashboard();
        } else if (json.status === 'success') {
            // Soporte fallback (estructura vieja)
            allData = json.data;
            populateProtestFilter(allData);
            renderDashboard();
        } else {
            reportsList.innerHTML = `<div class="empty-msg">Error: Respuesta inesperada del servidor.</div>`;
        }

    } catch (error) {
        console.error("Error fetching data:", error);
        reportsList.innerHTML = `
            <div class="empty-msg" style="color: var(--danger);">
                Error de conexión. Verifica que el script tenga 'doGet' implementado.
            </div>`;
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

// Helper: Convierte Array de Arrays (Sheet) a Array de Objetos
function sheetToObjects(rows) {
    if (!rows || rows.length < 2) return [];

    // Normalizar cabeceras: minúsculas, sin espacios, sin tildes
    const headers = rows[0].map(h =>
        h.toString().toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar tildes
            .replace(/\s+/g, '_') // Espacios a guiones bajos
    );

    return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            // Mapeo seguro, si la fila es más corta que cabeceras
            obj[header] = (row[index] !== undefined) ? row[index] : "";
        });
        return obj;
    });
}

// Función CORE: Une Registros con Incidencias
function processRelationalData(registrosRaw, incidenciasRaw) {
    const registros = sheetToObjects(registrosRaw);
    const incidencias = sheetToObjects(incidenciasRaw);

    // Mapeamos incidencias por ID de Supervision
    // Cabecera esperada en incidencias: id_supervision
    const incMap = {};

    incidencias.forEach(inc => {
        // Normalizar clave ID
        const id = inc.id_supervision;
        if (id) {
            if (!incMap[id]) incMap[id] = [];

            // Convertir objeto de incidencia a formato limpio
            incMap[id].push({
                time: inc.hora_incidencia || "",
                description: inc.descripcion || "",
                fileName: inc.foto_evidencia ? "Foto adjunta" : "",
                fileUrl: inc.foto_evidencia || "" // Guardar URL real
            });
        }
    });

    // Inyectar incidencias en cada registro padre
    registros.forEach(reg => {
        // En registros la última columna es el ID, busquemos cual es
        // Buscamos algo que parezca ID (SUP-...)
        // O usamos la clave mapeada si el header era explicito 'id_supervision'
        // En google_apps_script.js rows[0] terminaba en data.sessionId, pero no tenia header explícito en el appendRow init?
        // Revisando script: appendRow tiene data.sessionId al final. 
        // Si la hoja se creó nueva, tiene headers manuales. Asumiremos que el usuario puso cabeceras o el script las tiene.
        // Si no hay cabecera 'id_supervision' en sheetToObjects, buscamos por 'sessionId' o la última columna.

        const id = reg.id_supervision || reg.sessionid || ""; // Claves normalizadas

        if (id && incMap[id]) {
            reg.incidencias_array = incMap[id];
        } else {
            reg.incidencias_array = [];
        }
    });

    return registros;
}

function populateProtestFilter(data) {
    const protests = new Set();
    data.forEach(item => {
        if (item.nombre_protesta) protests.add(item.nombre_protesta);
    });

    const currentVal = filterProtest.value;
    filterProtest.innerHTML = '<option value="">Todas las protestas</option>';

    protests.forEach(p => {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        filterProtest.appendChild(option);
    });

    filterProtest.value = currentVal;
}

function renderDashboard() {
    const selectedDate = filterDate.value; // YYYY-MM-DD
    const selectedRegion = filterRegion.value;
    const selectedProtest = filterProtest.value;

    const filtered = allData.filter(item => {
        /* FECHA: 
           Sheets devuelve fecha como objeto Date o string ISO.
           Hay que normalizar a YYYY-MM-DD local
        */
        let itemDateStr = "";
        let rawDate = item.fecha;

        // Si viene como string DD/MM/YYYY
        if (typeof rawDate === 'string' && rawDate.includes('/')) {
            const parts = rawDate.split('/'); // DD, MM, YYYY
            if (parts.length === 3) itemDateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        // Si viene como objeto Date string ISO
        else if (rawDate) {
            const d = new Date(rawDate);
            if (!isNaN(d)) {
                itemDateStr = d.toISOString().split('T')[0];
            }
        }

        /* FILTROS */
        // Usamos claves normalizadas del sheetToObjects (todo minuscula, guiones bajos)
        const type = item.tipo_registro || "";
        const protest = item.nombre_protesta || "";

        const dateMatch = !selectedDate || itemDateStr === selectedDate;
        const regionMatch = !selectedRegion || type === selectedRegion;
        const protestMatch = !selectedProtest || protest === selectedProtest;

        return dateMatch && regionMatch && protestMatch;
    });

    updateStats(filtered);

    reportsList.innerHTML = '';
    if (filtered.length === 0) {
        reportsList.innerHTML = '<div class="empty-msg">No se encontraron reportes para este filtro.</div>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'report-card';

        // Mapeo de campos normalizados
        const punto = item.punto || item.ubicacion || "Punto no especificado";
        const oficina = item.oficina || "";
        const supervisor = item.supervisor || "";

        // Formato horas
        let inicio = item.inicio || "";
        let fin = item.fin || "En curso";
        // Si vienen como objeto Date, formatear
        if (inicio instanceof Date) inicio = inicio.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (fin instanceof Date) fin = fin.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const categoria = item.categoria || "";
        const nombreProtesta = item.nombre_protesta || "";
        const obs = item.observaciones || "";
        const archivo = item.archivo_ / _foto || item.archivo || "";

        // Incidencias (ya procesadas en el Array)
        const incidentsArray = item.incidencias_array || [];
        const incidentCount = incidentsArray.length;
        const hasIncidents = incidentCount > 0;

        let incidentsHtml = '';
        if (hasIncidents) {
            incidentsHtml = `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
                <h4 style="font-size: 0.9rem; color: #e67e22; margin-bottom: 8px;">🔥 Incidencias Reportadas:</h4>
                ${incidentsArray.map(inc => `
                    <div style="background: #fff8f0; padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 0.9rem;">
                        <strong>${inc.time}</strong>: ${inc.description}
                        ${inc.fileUrl ? `<br><a href="${inc.fileUrl}" target="_blank" style="font-size:0.8rem; color:#d35400;">📎 Ver Foto</a>` : ''}
                    </div>
                `).join('')}
            </div>`;
        }

        const statusBadge = hasIncidents
            ? `<span class="badge" style="background: #e67e22;">${incidentCount} Incidencias</span>`
            : `<span class="badge" style="background: #16a34a;">Sin Novedad</span>`;

        const obsHtml = obs
            ? `<p style="margin-top:10px; font-style:italic; color:#444; background:#f8fafc; padding:8px; border-radius:6px;">"${obs}"</p>`
            : '';

        const photoHtml = archivo && archivo.startsWith('http')
            ? `<a href="${archivo}" target="_blank" style="font-size:0.9rem;">📷 Foto General</a>`
            : '';

        card.innerHTML = `
            <div>
                <h3>${punto} <span style="font-weight:400; color:#666;">(${oficina})</span></h3>
                <div class="report-meta">
                    <span>👤 ${supervisor}</span>
                    <span>🕒 ${inicio} - ${fin}</span>
                    <span>${categoria}</span>
                </div>
                ${nombreProtesta ? `<div style="margin-top:5px; font-weight:500;">🚩 ${nombreProtesta}</div>` : ''}
                
                ${obsHtml}
                ${incidentsHtml}
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
                ${statusBadge}
                ${photoHtml}
            </div>
        `;
        reportsList.appendChild(card);
    });
}

function updateStats(data) {
    statTotal.textContent = data.length;

    const uniqueSupervisors = new Set(data.map(d => d.supervisor)).size;
    statSupervisors.textContent = uniqueSupervisors;

    let totalIncidents = 0;
    data.forEach(d => {
        if (d.incidencias_array) totalIncidents += d.incidencias_array.length;
    });
    statIncidents.textContent = totalIncidents;
}
