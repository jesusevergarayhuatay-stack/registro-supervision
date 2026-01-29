// Registro de Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado'))
            .catch(err => console.log('Error en Service Worker', err));
    });
}

// CONFIGURACIÓN: Reemplaza esto con la URL que obtendrás de Google Apps Script
const GOOGLE_SHEETS_URL = "";

// Clave simple para el modo Admin
const ADMIN_PASSWORD = "1234";

// Variables de Estado
// Variables de Estado
let activeSession = null;
let history = [];
let timerInterval = null;

// Elementos del DOM
const selectionSection = document.getElementById('selection-section');
const acpSection = document.getElementById('acp-section');
const startSection = document.getElementById('start-section');
const activeSection = document.getElementById('active-section');
const historySection = document.getElementById('history-section');

const choiceAcpBtn = document.getElementById('choice-acp');
const choicePlanBtn = document.getElementById('choice-plan');
const backBtns = document.querySelectorAll('.back-link');

const acpForm = document.getElementById('acp-form');
const startForm = document.getElementById('start-form');

const finishBtn = document.getElementById('finish-btn');
const timerDisplay = document.getElementById('timer');
const historyList = document.getElementById('history-list');
const displayLocation = document.getElementById('display-location');
const displayStart = document.getElementById('display-start');
const exportBtn = document.getElementById('export-btn');
const adminLink = document.getElementById('admin-link');

// Inicialización
function init() {
    activeSession = JSON.parse(localStorage.getItem('dp_active_session'));
    history = JSON.parse(localStorage.getItem('dp_history')) || [];

    // Poner la fecha de hoy por defecto en ambos formularios
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(input => {
        input.valueAsDate = new Date();
    });

    if (activeSession) {
        showActiveSession();
    } else {
        showSelectionScreen();
    }
    renderHistory();
}

// Navegación
function showSelectionScreen() {
    hideAllSections();
    selectionSection.classList.remove('hidden');
    historySection.classList.remove('hidden');
}

function showAcpForm() {
    hideAllSections();
    acpSection.classList.remove('hidden');
    historySection.classList.add('hidden'); // Ocultar historial mientras se llena el form
}

function showPlanForm() {
    hideAllSections();
    startSection.classList.remove('hidden');
    historySection.classList.add('hidden');
}

function hideAllSections() {
    selectionSection.classList.add('hidden');
    acpSection.classList.add('hidden');
    startSection.classList.add('hidden');
    activeSection.classList.add('hidden');
}

// Cambio de Interfaz
function showActiveSession() {
    hideAllSections();
    activeSection.classList.remove('hidden');
    historySection.classList.remove('hidden');

    if (activeSession.type === 'ACP') {
        displayLocation.textContent = `ACP: ${activeSession.acpName}`;
    } else {
        displayLocation.textContent = `${activeSession.location} (${activeSession.category})`;
    }

    displayStart.textContent = new Date(activeSession.startTime).toLocaleTimeString();
    startTimer();
}

// Lógica del Cronómetro
function startTimer() {
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerDisplay.textContent = "00:00:00";
}

function updateTimer() {
    if (!activeSession) return;
    const now = new Date();
    const start = new Date(activeSession.startTime);
    const diff = now - start;

    const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');

    timerDisplay.textContent = `${h}:${m}:${s}`;
}

// Manejadores de Eventos de Navegación
choiceAcpBtn.addEventListener('click', showAcpForm);
choicePlanBtn.addEventListener('click', showPlanForm);
backBtns.forEach(btn => btn.addEventListener('click', showSelectionScreen));

// Manejadores de Formularios
acpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const now = new Date();
    const selectedDate = document.getElementById('acp-date').value;
    const startDateTime = new Date(`${selectedDate}T${now.toTimeString().split(' ')[0]}`);

    activeSession = {
        type: 'ACP',
        name: document.getElementById('acp-supervisor').value,
        office: document.getElementById('acp-office').value,
        date: selectedDate,
        acpName: document.getElementById('acp-name').value,
        observations: document.getElementById('acp-observations').value,
        startTime: startDateTime.getTime()
    };

    saveAndShowActive();
});

startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const now = new Date();
    const selectedDate = document.getElementById('date').value;
    const startDateTime = new Date(`${selectedDate}T${now.toTimeString().split(' ')[0]}`);

    activeSession = {
        type: 'Plan',
        office: document.getElementById('office').value,
        name: document.getElementById('name').value,
        category: document.getElementById('category').value,
        location: document.getElementById('location').value,
        date: selectedDate,
        observations: document.getElementById('observations').value,
        startTime: startDateTime.getTime()
    };

    saveAndShowActive();
});

function saveAndShowActive() {
    localStorage.setItem('dp_active_session', JSON.stringify(activeSession));
    showActiveSession();
}

finishBtn.addEventListener('click', async () => {
    const endTime = new Date().getTime();
    const entry = {
        ...activeSession,
        endTime: endTime,
        duration: endTime - activeSession.startTime,
        isWeekend: isWeekend(new Date(activeSession.startTime))
    };

    history.unshift(entry);
    localStorage.setItem('dp_history', JSON.stringify(history));
    localStorage.removeItem('dp_active_session');

    // Enviar a Google Sheets de forma automática si la URL está configurada
    if (GOOGLE_SHEETS_URL) {
        sendToGoogleSheets(entry);
    }

    activeSession = null;
    showSelectionScreen();
    renderHistory();
    // Limpiar campos
    acpForm.reset();
    startForm.reset();
});

async function sendToGoogleSheets(data) {
    try {
        const durationH = (data.duration / 3600000).toFixed(2);

        const payload = {
            fecha: data.date,
            oficina: data.office,
            supervisor: data.name,
            categoria: data.category,
            punto: data.location,
            inicio: new Date(data.startTime).toLocaleTimeString(),
            fin: new Date(data.endTime).toLocaleTimeString(),
            duracion: durationH,
            fin_de_semana: data.isWeekend ? 'Sí' : 'No',
            observaciones: data.observations || ""
        };

        fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors',
            cache: 'no-cache',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Error enviando a Google Sheets:', error);
    }
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

// Lógica de Administrador
adminLink.addEventListener('click', () => {
    const pass = prompt('Ingrese clave de administrador:');
    if (pass === ADMIN_PASSWORD) {
        if (GOOGLE_SHEETS_URL) {
            const sheetEditUrl = GOOGLE_SHEETS_URL.split('/exec')[0] + '/edit';
            alert('Accediendo a la base de datos central...');
            window.open(sheetEditUrl, '_blank');
        } else {
            alert('Configuración pendiente: Debes poner la URL de tu Google App Script en la línea 12 de app.js');
        }
    } else {
        alert('Clave incorrecta');
    }
});

// Renderizado del Historial
function renderHistory() {
    if (history.length === 0) {
        historyList.innerHTML = '<p class="empty-msg">No hay registros previos.</p>';
        return;
    }

    historyList.innerHTML = history.map(item => {
        const dateStr = item.date;
        const startStr = new Date(item.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endStr = new Date(item.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const durationH = (item.duration / 3600000).toFixed(2);

        return `
            <div class="history-item">
                <div class="header">
                    <span>${item.location} (${item.category})</span>
                    <span>${dateStr}</span>
                </div>
                <div class="details">
                    <p><strong>${item.name}</strong> - ${item.office}</p>
                    <p>${startStr} - ${endStr} 
                        <span class="duration-tag">${durationH}h</span>
                        ${item.isWeekend ? '<span class="weekend-tag">Fin de Semana</span>' : ''}
                    </p>
                    ${item.observations ? `<p class="obs">Obs: ${item.observations}</p>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Exportación Manual a CSV (Respaldo)
exportBtn.addEventListener('click', () => {
    if (history.length === 0) return alert('No hay datos para exportar');

    let csv = 'Fecha,Oficina,Supervisor,Categoría,Ubicación,Inicio,Fin,Duración (h),Fin de Semana,Observaciones\n';
    history.forEach(item => {
        const start = new Date(item.startTime).toLocaleTimeString();
        const end = new Date(item.endTime).toLocaleTimeString();
        const duration = (item.duration / 3600000).toFixed(2);
        const obs = item.observations ? item.observations.replace(/"/g, '""') : "";
        csv += `${item.date},"${item.office}","${item.name}","${item.category}","${item.location}",${start},${end},${duration},${item.isWeekend ? 'Sí' : 'No'},"${obs}"\n`;
    });

    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `supervisiones_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

init();
