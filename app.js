const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwNaXD5Yby9yqS5QHdCuXwS1xRKw500Aq0ZPG5v8nSW3mbBDbOXeZUlOCn2FJldXg-lfQ/exec"; 
const MAX_AGING_MINUTES = 120;
const LOCAL_STORAGE_KEY = "3sixty_cases_cache_v3";

let currentEmployee = null;
let wakeLockObj = null;
let syncIntervalId = null;
let lastRawCasesData = [];
let pendingCompleteRowIndex = null;
let pendingCompleteElapsedMinutes = 0;

// Live Clock & Real-time Aging Sync
function startLiveClock() {
  const clockEl = document.getElementById("liveClockDisplay");
  if (!clockEl) return;

  function updateClockAndAging() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + 
                          now.toLocaleDateString([], { month: 'short', day: 'numeric' });

    if (lastRawCasesData && lastRawCasesData.length > 0) {
      updateAgingProgressBars(now);
    }
  }

  updateClockAndAging();
  setInterval(updateClockAndAging, 1000);
}

// Anti-Screenlock Wake Lock Feature
async function initAntiScreenLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockObj = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (wakeLockObj !== null && document.visibilityState === 'visible') {
          wakeLockObj = await navigator.wakeLock.request('screen');
        }
      });
    } catch (err) {}
  }

  try {
    const canvas = document.getElementById('antiLockCanvas');
    const video = document.getElementById('antiLockVideo');
    if (canvas && video) {
      const ctx = canvas.getContext('2d');
      let colorToggle = false;
      setInterval(() => {
        ctx.fillStyle = colorToggle ? '#000000' : '#010101';
        ctx.fillRect(0, 0, 2, 2);
        colorToggle = !colorToggle;
      }, 1000);

      if (canvas.captureStream) {
        video.srcObject = canvas.captureStream(1);
        video.play().catch(() => {});
      }
    }
  } catch (e) {}
}

function setupLogoToggle() {
  const logoBtn = document.getElementById("brandLogo");
  if (!logoBtn) return;

  logoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    document.body.classList.toggle("ui-hidden");
  });
}

function setNavLock(locked) {
  const navBtns = document.querySelectorAll(".left-nav-container .nav-item-btn");
  navBtns.forEach(btn => {
    if (btn.id === "navAccMgmtBtn") return; 
    if (locked) {
      btn.classList.add("disabled");
    } else {
      btn.classList.remove("disabled");
    }
  });
}

// Apply Role-Based Navigation and View Limits
function applyRolePermissions() {
  const rtaBtn = document.getElementById("navRtaBtn");
  const createdByTh = document.getElementById("thCreatedBy");
  
  const isAgent = currentEmployee && currentEmployee.role === "AGENT";

  if (isAgent) {
    if (rtaBtn) rtaBtn.style.display = "none";
    if (createdByTh) createdByTh.style.display = "none";
  } else {
    if (rtaBtn) rtaBtn.style.display = "flex";
    if (createdByTh) createdByTh.style.display = "table-cell";
  }
}

function switchView(viewId, btnEl) {
  if (btnEl && btnEl.classList.contains("disabled")) return;

  document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(viewId).classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}

function makeApiCall(params, callbackName) {
  const oldScript = document.getElementById("jsonp-loader");
  if (oldScript) oldScript.remove();

  const script = document.createElement("script");
  script.id = "jsonp-loader";
  
  let queryString = `${GOOGLE_SCRIPT_URL}?callback=${callbackName}&_=${Date.now()}`;
  for (let key in params) {
    queryString += `&${key}=${encodeURIComponent(params[key])}`;
  }

  script.src = queryString;
  script.onerror = function() {
    console.error("API Call error");
    resetButtonStates();
  };
  document.body.appendChild(script);
}

function resetButtonStates() {
  const loginBtn = document.getElementById("loginSubmitBtn");
  if (loginBtn) {
    loginBtn.textContent = "Login";
    loginBtn.removeAttribute("disabled");
  }
}

// FETCH DATA & RENDER ALL VIEWS
function fetchCases() {
  const cachedData = localStorage.getItem(LOCAL_STORAGE_KEY);
  const tbody = document.getElementById("caseTableBody");

  if (cachedData && tbody && tbody.children.length === 0) {
    try {
      const parsed = JSON.parse(cachedData);
      lastRawCasesData = parsed;
      renderProductionTable(parsed);
      renderRtaTable(parsed);
      renderAgentTable(parsed);
    } catch(e) {}
  }

  makeApiCall({ action: "getCases" }, "handleData");
}

window.handleData = function(result) {
  if (result && result.status === "success" && result.data) {
    lastRawCasesData = result.data;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(result.data));
    renderProductionTable(result.data);
    renderRtaTable(result.data);
    renderAgentTable(result.data);
  }
};

// PRODUCTION PERSPECTIVE TABLE RENDER
function renderProductionTable(cases) {
  const tbody = document.getElementById("caseTableBody");
  if (!tbody) return;

  if (!cases || cases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #cbd5e1;">No cases found in Google Sheet ("raw").</td></tr>`;
    return;
  }

  const now = new Date();
  const fragment = document.createDocumentFragment();
  const isAgentRole = currentEmployee && currentEmployee.role === "AGENT";

  const processedCases = cases.map(row => {
    const caseTitle = row[3] || "N/A";
    const guestContact = row[6] || "N/A";
    const customer = row[7] || "N/A";
    const createdBy = row[11] || "Unassigned";
    const firstEmailOn = row[12] || "";
    const colUStatus = (row[20] || "ONGOING").toString().trim().toUpperCase();
    const completedTimeStamp = row[21] || "";
    const sheetRowIndex = row[22];

    let cleanDateStr = firstEmailOn.replace(/\(.*\)/, '').trim();
    let emailTime = new Date(cleanDateStr);
    if (isNaN(emailTime.getTime()) && firstEmailOn) {
      emailTime = new Date(firstEmailOn);
    }

    const isValidDate = !isNaN(emailTime.getTime());
    const elapsedMs = isValidDate ? (now - emailTime) : 0;
    const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / (1000 * 60)));

    return {
      caseTitle,
      guestContact,
      customer,
      createdBy,
      firstEmailOn,
      colUStatus,
      completedTimeStamp,
      sheetRowIndex,
      emailTime,
      isValidDate,
      elapsedMinutes
    };
  });

  processedCases.sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);

  processedCases.forEach(item => {
    const tr = document.createElement("tr");
    tr.className = "case-row";
    tr.setAttribute("data-email-time-ms", item.isValidDate ? item.emailTime.getTime() : 0);
    tr.setAttribute("data-raw-status", item.colUStatus);

    const elapsedMinutes = item.elapsedMinutes;
    let isCompleted = item.colUStatus.startsWith("COMPLETED");
    let isUnfulfilled = item.colUStatus === "UNFULFILLED" || (elapsedMinutes >= MAX_AGING_MINUTES && !isCompleted);
    let isOngoing = !isCompleted && !isUnfulfilled;

    let percent = Math.min(100, (elapsedMinutes / MAX_AGING_MINUTES) * 100);

    let barColor = "#eab308";
    if (elapsedMinutes >= MAX_AGING_MINUTES || isUnfulfilled) {
      barColor = "#ef4444";
    } else if (elapsedMinutes >= 90) {
      barColor = "#f97316";
    }

    const formattedDate = item.isValidDate 
      ? item.emailTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : (item.firstEmailOn || "N/A");

    let elapsedText = elapsedMinutes >= 60 
      ? `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m elapsed` 
      : `${elapsedMinutes} mins elapsed`;

    let statusBadgeHtml = "";
    if (isCompleted) {
      statusBadgeHtml = `<span class="status-pill status-completed" onclick="openCompletedNote('${escapeQuotes(item.completedTimeStamp || 'N/A')}')">${item.colUStatus}</span>`;
    } else if (isUnfulfilled) {
      statusBadgeHtml = `<span class="status-pill status-unfulfilled">UNFULFILLED</span>`;
    } else {
      statusBadgeHtml = `<span class="status-pill status-ongoing">${item.colUStatus}</span>`;
    }

    let shouldAnimate = isOngoing;
    let createdByCell = isAgentRole ? '' : `<td><span class="agent-name">${item.createdBy}</span></td>`;

    tr.innerHTML = `
      <td style="color: #cbd5e1; font-size: 0.9rem;">${formattedDate}</td>
      ${createdByCell}
      <td>
        <span class="guest-contact-clickable" onclick="openGuestContactNote('${escapeQuotes(item.caseTitle)}', '${escapeQuotes(item.guestContact)}', '${escapeQuotes(item.customer)}')">
          ${item.guestContact}
          <i class="fa-solid fa-circle-info fa-xs"></i>
        </span>
      </td>
      <td>
        <div class="aging-wrapper">
          <div class="aging-track">
            <div class="aging-fill ${shouldAnimate ? 'animated' : ''}" 
                 style="width: ${percent}%; background-color: ${barColor};">
            </div>
          </div>
          <div class="aging-meta">
            <span class="elapsed-text-label">${elapsedText}</span>
            <span class="status-label">${isCompleted ? item.colUStatus : (isUnfulfilled ? 'Expired (2h)' : 'Max 2 Hours')}</span>
          </div>
        </div>
      </td>
      <td class="status-cell">${statusBadgeHtml}</td>
    `;

    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

// AGENT PERSPECTIVE TABLE RENDER
function renderAgentTable(cases) {
  const tbody = document.getElementById("agentTableBody");
  if (!tbody) return;

  if (!currentEmployee || !currentEmployee.name) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #cbd5e1;">Please log in to view assigned agent cases.</td></tr>`;
    return;
  }

  const empName = currentEmployee.name.trim().toLowerCase();
  const now = new Date();
  const fragment = document.createDocumentFragment();

  const filteredCases = cases.filter(row => {
    const createdBy = (row[11] || "").toString().trim().toLowerCase();
    return createdBy === empName;
  });

  if (filteredCases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #cbd5e1;">No cases assigned to ${currentEmployee.name}.</td></tr>`;
    return;
  }

  filteredCases.forEach(row => {
    const caseTitle = row[3] || "N/A";
    const guestContact = row[6] || "N/A";
    const customer = row[7] || "N/A";
    const firstEmailOn = row[12] || "";
    const colUStatus = (row[20] || "ONGOING").toString().trim().toUpperCase();
    const sheetRowIndex = row[22];

    let cleanDateStr = firstEmailOn.replace(/\(.*\)/, '').trim();
    let emailTime = new Date(cleanDateStr);
    if (isNaN(emailTime.getTime()) && firstEmailOn) {
      emailTime = new Date(firstEmailOn);
    }

    const isValidDate = !isNaN(emailTime.getTime());
    const elapsedMs = isValidDate ? (now - emailTime) : 0;
    const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / (1000 * 60)));

    let isCompleted = colUStatus.startsWith("COMPLETED");
    let isUnfulfilled = colUStatus === "UNFULFILLED" || (elapsedMinutes >= MAX_AGING_MINUTES && !isCompleted);
    let isOngoing = !isCompleted && !isUnfulfilled;

    let percent = Math.min(100, (elapsedMinutes / MAX_AGING_MINUTES) * 100);

    let barColor = "#eab308";
    if (elapsedMinutes >= MAX_AGING_MINUTES || isUnfulfilled) {
      barColor = "#ef4444";
    } else if (elapsedMinutes >= 90) {
      barColor = "#f97316";
    }

    const formattedDate = isValidDate 
      ? emailTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : (firstEmailOn || "N/A");

    let elapsedText = elapsedMinutes >= 60 
      ? `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m elapsed` 
      : `${elapsedMinutes} mins elapsed`;

    let actionCellHtml = "";
    if (isCompleted) {
      actionCellHtml = `<span class="status-pill status-completed">${colUStatus}</span>`;
    } else {
      actionCellHtml = `
        <button class="btn-complete-action" onclick="promptCompleteTask(${sheetRowIndex}, ${elapsedMinutes}, '${escapeQuotes(formattedDate)}', '${escapeQuotes(caseTitle)}', '${escapeQuotes(guestContact)}', '${escapeQuotes(customer)}')">
          <i class="fa-solid fa-circle-check"></i> Complete
        </button>`;
    }

    const tr = document.createElement("tr");
    tr.className = "case-row";
    tr.setAttribute("data-email-time-ms", isValidDate ? emailTime.getTime() : 0);
    tr.setAttribute("data-raw-status", colUStatus);

    tr.innerHTML = `
      <td style="color: #cbd5e1; font-size: 0.9rem;">${formattedDate}</td>
      <td style="font-weight: 700; color: #ffffff;">${caseTitle}</td>
      <td>
        <span class="guest-contact-clickable" onclick="openGuestContactNote('${escapeQuotes(caseTitle)}', '${escapeQuotes(guestContact)}', '${escapeQuotes(customer)}')">
          ${guestContact}
          <i class="fa-solid fa-circle-info fa-xs"></i>
        </span>
      </td>
      <td style="color: #cbd5e1;">${customer}</td>
      <td>
        <div class="aging-wrapper">
          <div class="aging-track">
            <div class="aging-fill ${isOngoing ? 'animated' : ''}" 
                 style="width: ${percent}%; background-color: ${barColor};">
            </div>
          </div>
          <div class="aging-meta">
            <span class="elapsed-text-label">${elapsedText}</span>
            <span class="status-label">${isCompleted ? colUStatus : (isUnfulfilled ? 'Expired (2h)' : 'Max 2 Hours')}</span>
          </div>
        </div>
      </td>
      <td>${actionCellHtml}</td>
    `;

    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

// RTA PERSPECTIVE TABLE RENDER (Col D to Col T)
function renderRtaTable(cases) {
  const tbody = document.getElementById("rtaTableBody");
  if (!tbody) return;

  if (!cases || cases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" style="text-align: center; padding: 2rem; color: #cbd5e1;">No cases found in Google Sheet ("raw").</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  cases.forEach(row => {
    const tr = document.createElement("tr");
    tr.className = "case-row";

    let rowHtml = "";
    for (let c = 3; c < 20; c++) {
      let cellVal = row[c] || "";
      if (cellVal.includes("T") && cellVal.includes("Z") && !isNaN(Date.parse(cellVal))) {
        cellVal = new Date(cellVal).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      rowHtml += `<td style="font-size: 0.88rem; color: #cbd5e1;">${cellVal || "-"}</td>`;
    }

    tr.innerHTML = rowHtml;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

// SECOND-BY-SECOND AGING SYNC
function updateAgingProgressBars(now) {
  const rows = document.querySelectorAll("#caseTableBody tr.case-row, #agentTableBody tr.case-row");
  rows.forEach(tr => {
    const timeMs = parseInt(tr.getAttribute("data-email-time-ms") || "0", 10);
    const rawStatus = (tr.getAttribute("data-raw-status") || "ONGOING").toUpperCase();

    if (!timeMs) return;

    const elapsedMs = Math.max(0, now.getTime() - timeMs);
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

    let isCompleted = rawStatus.startsWith("COMPLETED");
    let isUnfulfilled = rawStatus === "UNFULFILLED" || (elapsedMinutes >= MAX_AGING_MINUTES && !isCompleted);
    let isOngoing = !isCompleted && !isUnfulfilled;

    let percent = Math.min(100, (elapsedMinutes / MAX_AGING_MINUTES) * 100);

    let barColor = "#eab308";
    if (elapsedMinutes >= MAX_AGING_MINUTES || isUnfulfilled) {
      barColor = "#ef4444";
    } else if (elapsedMinutes >= 90) {
      barColor = "#f97316";
    }

    const fillEl = tr.querySelector(".aging-fill");
    const elapsedLabel = tr.querySelector(".elapsed-text-label");
    const statusLabel = tr.querySelector(".status-label");

    if (fillEl) {
      fillEl.style.width = `${percent}%`;
      fillEl.style.backgroundColor = barColor;

      if (isOngoing) {
        fillEl.classList.add("animated");
      } else {
        fillEl.classList.remove("animated");
      }
    }

    if (elapsedLabel) {
      elapsedLabel.textContent = elapsedMinutes >= 60 
        ? `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m elapsed` 
        : `${elapsedMinutes} mins elapsed`;
    }

    if (statusLabel) {
      statusLabel.textContent = isCompleted ? rawStatus : (isUnfulfilled ? 'Expired (2h)' : 'Max 2 Hours');
    }
  });
}

// PROMPT COMPLETE TASK DIALOG
function promptCompleteTask(rowIndex, elapsedMinutes, firstEmail, caseTitle, guestContact, customer) {
  pendingCompleteRowIndex = rowIndex;
  pendingCompleteElapsedMinutes = elapsedMinutes;

  document.getElementById("confirmFirstEmail").textContent = firstEmail || "N/A";
  document.getElementById("confirmCaseTitle").textContent = caseTitle || "N/A";
  document.getElementById("confirmGuestContact").textContent = guestContact || "N/A";
  document.getElementById("confirmCustomer").textContent = customer || "N/A";
  document.getElementById("completeConfirmModal").style.display = "flex";
}

// CONFIRM COMPLETE TASK PROCEED WITH DYNAMIC STATUS TAGGING
function confirmProceedComplete() {
  if (!pendingCompleteRowIndex) return;

  const proceedBtn = document.getElementById("proceedCompleteBtn");
  proceedBtn.textContent = "Processing...";
  proceedBtn.setAttribute("disabled", "true");

  // Determine if completion is within 2 hours or overdue
  const statusTag = pendingCompleteElapsedMinutes <= MAX_AGING_MINUTES 
    ? "COMPLETED | On-time" 
    : "COMPLETED | Overdue";

  makeApiCall({
    action: "completeTask",
    rowIndex: pendingCompleteRowIndex,
    statusTag: statusTag
  }, "handleCompleteTaskResponse");
}

window.handleCompleteTaskResponse = function(res) {
  const proceedBtn = document.getElementById("proceedCompleteBtn");
  proceedBtn.textContent = "Proceed";
  proceedBtn.removeAttribute("disabled");

  document.getElementById("completeConfirmModal").style.display = "none";

  if (res && res.status === "success") {
    showBottomToast(`Task completed! (${res.statusTag || 'COMPLETED'})`);
    fetchCases();
  } else {
    alert("Error completing task. Please try again.");
  }
};

// SHOW BOTTOM TOAST
function showBottomToast(msg) {
  const toast = document.getElementById("bottomToast");
  const msgEl = document.getElementById("toastMsg");
  if (!toast || !msgEl) return;

  msgEl.textContent = msg;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}

function openGuestContactNote(caseTitle, guestContact, customer) {
  document.getElementById("noteCaseTitle").textContent = caseTitle || "N/A";
  document.getElementById("noteGuestContact").textContent = guestContact || "N/A";
  document.getElementById("noteCustomer").textContent = customer || "N/A";
  document.getElementById("guestNoteModal").style.display = "flex";
}

function openCompletedNote(completedTimeStamp) {
  document.getElementById("completedTimeVal").textContent = completedTimeStamp || "N/A";
  document.getElementById("completedNoteModal").style.display = "flex";
}

function escapeQuotes(str) {
  if (!str) return "";
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// EXCEL IMPORT HANDLER
function setupExcelImport() {
  const importBtn = document.getElementById("importFileBtn");
  const fileInput = document.getElementById("xlsxFileInput");

  if (!importBtn || !fileInput) return;

  importBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".xlsx")) {
      showImportNotification("Error: Invalid file format! Please upload a valid raw.xlsx file.", true);
      fileInput.value = "";
      return;
    }

    showImportNotification("Reading file contents...", false);

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const sheetJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (sheetJson.length < 2) {
          showImportNotification("Error: File contains no data rows below header.", true);
          fileInput.value = "";
          return;
        }

        const dataRows = sheetJson.slice(1).map(r => {
          let rowArr = [];
          for (let i = 0; i < 20; i++) {
            rowArr.push(r[i] !== undefined && r[i] !== null ? r[i].toString() : "");
          }
          return rowArr;
        });

        showImportNotification(`Uploading ${dataRows.length} imported rows to Google Sheets...`, false);

        fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "appendRawData",
            rows: dataRows
          })
        })
        .then(res => res.json())
        .then(resData => {
          if (resData && resData.status === "success") {
            showImportNotification(`Success: ${resData.message || 'Import completed!'}`, false);
            fetchCases();
          } else {
            showImportNotification(`Error: ${resData.message || 'Failed to import records.'}`, true);
          }
        })
        .catch(err => {
          showImportNotification("Error uploading records to server.", true);
        })
        .finally(() => {
          fileInput.value = "";
        });

      } catch (err) {
        showImportNotification("Error parsing Excel file.", true);
        fileInput.value = "";
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

function showImportNotification(msg, isError) {
  const notifEl = document.getElementById("importNotif");
  if (!notifEl) return;
  notifEl.style.display = "block";
  notifEl.style.color = isError ? "#ef4444" : "#10b981";
  notifEl.textContent = msg;

  if (!isError) {
    setTimeout(() => { notifEl.style.display = "none"; }, 5000);
  }
}

function validatePasswordRules(pass) {
  if (!pass || pass.length < 8) return false;
  return /[A-Z]/.test(pass) && /[0-9]/.test(pass) && /[^A-Za-z0-9]/.test(pass);
}

function checkRegistrationForm() {
  const p1 = document.getElementById("regPass").value;
  const p2 = document.getElementById("regPassRetype").value;
  const a1 = document.getElementById("regSecA").value;
  const a2 = document.getElementById("regSecARetype").value;
  const name = document.getElementById("regName").value;
  const q = document.getElementById("regSecQ").value;
  const notif = document.getElementById("regNotif");
  const submitBtn = document.getElementById("regSubmitBtn");

  let passMismatch = (p1 !== p2) && (p1 !== "" || p2 !== "");
  let ansMismatch = (a1 !== a2) && (a1 !== "" || a2 !== "");

  if (p1 && p1.length < 8) {
    notif.textContent = "Password must be a minimum of 8 total characters!";
  } else if (passMismatch) {
    notif.textContent = "Password mismatch!";
  } else if (ansMismatch) {
    notif.textContent = "Security answer mismatch!";
  } else {
    notif.textContent = "";
  }

  const isPassValid = validatePasswordRules(p1);
  const allFilled = name && p1 && p2 && q && a1 && a2;
  
  if (allFilled && !passMismatch && !ansMismatch && isPassValid) {
    submitBtn.removeAttribute("disabled");
  } else {
    submitBtn.setAttribute("disabled", "true");
  }
}

function checkAccountManagementForm() {
  const p1 = document.getElementById("accNewPass").value;
  const p2 = document.getElementById("accNewPassRetype").value;
  const notif = document.getElementById("accNotif");

  if (!currentEmployee) return;

  let passMismatch = (p1 !== p2) && (p1 !== "" || p2 !== "");

  if (p1 && p1.length < 8) {
    notif.textContent = "Password must be a minimum of 8 total characters!";
  } else if (passMismatch) {
    notif.textContent = "Password mismatch!";
  } else {
    notif.textContent = "";
  }
}

function performLogin() {
  const passInput = document.getElementById("loginPasswordInput");
  const loginBtn = document.getElementById("loginSubmitBtn");
  const pass = passInput.value.trim();
  if (!pass) return;

  const cached = sessionStorage.getItem("auth_emp_" + btoa(pass));
  if (cached) {
    try {
      const res = JSON.parse(cached);
      window.handleLoginResponse(res);
      return;
    } catch(e) {}
  }

  loginBtn.textContent = "Authenticating...";
  loginBtn.setAttribute("disabled", "true");

  makeApiCall({ action: "login", password: pass }, "handleLoginResponse");
}

document.addEventListener("DOMContentLoaded", () => {
  startLiveClock();
  setupLogoToggle();
  initAntiScreenLock();
  setupExcelImport();

  document.getElementById("closeGuestNoteBtn").addEventListener("click", () => {
    document.getElementById("guestNoteModal").style.display = "none";
  });

  document.getElementById("closeCompletedNoteBtn").addEventListener("click", () => {
    document.getElementById("completedNoteModal").style.display = "none";
  });

  document.getElementById("cancelCompleteBtn").addEventListener("click", () => {
    document.getElementById("completeConfirmModal").style.display = "none";
  });

  document.getElementById("proceedCompleteBtn").addEventListener("click", confirmProceedComplete);

  const passInput = document.getElementById("loginPasswordInput");
  document.getElementById("loginSubmitBtn").addEventListener("click", performLogin);

  passInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performLogin();
    }
  });

  window.handleLoginResponse = function(res) {
    resetButtonStates();
    const notif = document.getElementById("loginNotif");
    
    if (res.status === "success") {
      const passVal = document.getElementById("loginPasswordInput").value.trim();
      if (passVal) {
        sessionStorage.setItem("auth_emp_" + btoa(passVal), JSON.stringify(res));
      }

      currentEmployee = res.employee;
      document.getElementById("loginModal").style.display = "none";
      document.getElementById("accName").value = currentEmployee.name;

      // Apply role permissions based on Col H (AGENT / SUPPORT)
      applyRolePermissions();

      if (currentEmployee.secQuestion && currentEmployee.secAnswer) {
        document.getElementById("accSecQDropdownGroup").style.display = "none";
        document.getElementById("accSecQFixedGroup").style.display = "block";
        document.getElementById("accSecQFixed").value = currentEmployee.secQuestion;

        document.getElementById("accSecAGroup").style.display = "none";
        document.getElementById("accSecARetypeGroup").style.display = "none";
        document.getElementById("accVerifySecAGroup").style.display = "block";
      } else {
        document.getElementById("accSecQDropdownGroup").style.display = "block";
        document.getElementById("accSecQFixedGroup").style.display = "none";
        document.getElementById("accSecAGroup").style.display = "block";
        document.getElementById("accSecARetypeGroup").style.display = "block";
        document.getElementById("accVerifySecAGroup").style.display = "none";
      }

      document.body.classList.remove("ui-hidden");

      if (currentEmployee.requiresPasswordSetup) {
        setNavLock(true);
        switchView("accMgmtView", document.getElementById("navAccMgmtBtn"));
      } else {
        setNavLock(false);
        switchView("prodView", document.getElementById("navProdBtn"));

        fetchCases();
        if (syncIntervalId) clearInterval(syncIntervalId);
        syncIntervalId = setInterval(fetchCases, 10000);
      }
    } else if (res.status === "denied") {
      notif.textContent = res.message || "Login denied: Account is not ACTIVE.";
    } else {
      document.getElementById("loginModal").style.display = "none";
      document.getElementById("notFoundModal").style.display = "flex";
    }
  };

  document.getElementById("notFoundNoBtn").addEventListener("click", () => {
    document.getElementById("notFoundModal").style.display = "none";
    document.getElementById("loginModal").style.display = "flex";
  });

  document.getElementById("notFoundYesBtn").addEventListener("click", () => {
    document.getElementById("notFoundModal").style.display = "none";
    document.getElementById("createModal").style.display = "flex";
  });

  document.getElementById("regCancelBtn").addEventListener("click", () => {
    document.getElementById("createModal").style.display = "none";
    document.getElementById("loginModal").style.display = "flex";
  });

  ["regPass", "regPassRetype", "regSecA", "regSecARetype", "regName", "regSecQ"].forEach(id => {
    document.getElementById(id).addEventListener("input", checkRegistrationForm);
    document.getElementById(id).addEventListener("change", checkRegistrationForm);
  });

  ["accNewPass", "accNewPassRetype", "accSecA", "accSecARetype"].forEach(id => {
    document.getElementById(id).addEventListener("input", checkAccountManagementForm);
    document.getElementById(id).addEventListener("change", checkAccountManagementForm);
  });

  document.getElementById("regSubmitBtn").addEventListener("click", () => {
    const regBtn = document.getElementById("regSubmitBtn");
    regBtn.textContent = "Submitting...";
    regBtn.setAttribute("disabled", "true");

    const name = document.getElementById("regName").value;
    const pass = document.getElementById("regPass").value;
    const q = document.getElementById("regSecQ").value;
    const a = document.getElementById("regSecA").value;

    makeApiCall({
      action: "createAccount",
      name: name,
      password: pass,
      secQuestion: q,
      secAnswer: a
    }, "handleCreateAccountResponse");
  });

  window.handleCreateAccountResponse = function(res) {
    resetButtonStates();
    const notif = document.getElementById("regNotif");
    if (res.status === "success") {
      alert("Account created successfully! Please log in.");
      document.getElementById("createModal").style.display = "none";
      document.getElementById("loginModal").style.display = "flex";
    } else if (res.status === "denied") {
      notif.textContent = res.message || "Account is not ACTIVE!";
    } else if (res.status === "unauthorized") {
      notif.textContent = "Unauthorized account creation!";
    } else {
      notif.textContent = res.message || "Error creating account";
    }
  };

  document.getElementById("saveAccBtn").addEventListener("click", () => {
    const notif = document.getElementById("accNotif");
    const newPass = document.getElementById("accNewPass").value;
    const newPassRetype = document.getElementById("accNewPassRetype").value;

    if (!newPass || newPass !== newPassRetype) {
      notif.textContent = "Password mismatch!";
      return;
    }

    if (!validatePasswordRules(newPass)) {
      notif.textContent = "Password must be at least 8 chars with 1 uppercase, 1 digit, and 1 special char!";
      return;
    }

    let secQVal = currentEmployee.secQuestion || "";
    let secAVal = currentEmployee.secAnswer || "";

    if (currentEmployee.secQuestion && currentEmployee.secAnswer) {
      const verifyAns = document.getElementById("accVerifySecA").value;
      if (!verifyAns || verifyAns !== currentEmployee.secAnswer) {
        notif.textContent = "Security answer verification failed!";
        return;
      }
    } else {
      secQVal = document.getElementById("accSecQ").value;
      secAVal = document.getElementById("accSecA").value;
      const secARetype = document.getElementById("accSecARetype").value;

      if (!secQVal || !secAVal || secAVal !== secARetype) {
        notif.textContent = "Security question/answer invalid or mismatched!";
        return;
      }
    }

    makeApiCall({
      action: "updateAccount",
      name: currentEmployee.name,
      password: newPass,
      secQuestion: secQVal,
      secAnswer: secAVal
    }, "handleUpdateAccountResponse");
  });

  window.handleUpdateAccountResponse = function(res) {
    const notif = document.getElementById("accNotif");
    if (res.status === "success") {
      sessionStorage.clear();
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      notif.style.color = "#10b981";
      notif.textContent = "Password updated successfully!";
      
      currentEmployee.requiresPasswordSetup = false;
      setNavLock(false);

      document.getElementById("accNewPass").value = "";
      document.getElementById("accNewPassRetype").value = "";
      document.getElementById("accVerifySecA").value = "";
      
      setTimeout(() => {
        switchView("prodView", document.getElementById("navProdBtn"));
        fetchCases();
        if (syncIntervalId) clearInterval(syncIntervalId);
        syncIntervalId = setInterval(fetchCases, 10000);
      }, 1000);
    } else {
      notif.style.color = "#ef4444";
      notif.textContent = res.message || "Failed to update account";
    }
  };
});
