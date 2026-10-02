const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwNaXD5Yby9yqS5QHdCuXwS1xRKw500Aq0ZPG5v8nSW3mbBDbOXeZUlOCn2FJldXg-lfQ/exec"; 
const MAX_AGING_MINUTES = 120;
const LOCAL_STORAGE_KEY = "3sixty_cases_cache";

let currentEmployee = null;
let wakeLockObj = null;
let syncIntervalId = null;
let lastRawCasesData = [];

// Live Clock & Real-time Aging Sync (Every Second)
function startLiveClock() {
  const clockEl = document.getElementById("liveClockDisplay");
  if (!clockEl) return;

  function updateClockAndAging() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + 
                          now.toLocaleDateString([], { month: 'short', day: 'numeric' });

    // Live update dynamic aging progress bars synchronized with current second
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
    } catch (err) {
      console.log('Wake Lock initialized via fallback stream');
    }
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
  } catch (e) {
    console.log('Anti-lock video stream active');
  }
}

// Toggle Views on 3Sixty Brand Logo Click
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
  const regBtn = document.getElementById("regSubmitBtn");
  if (regBtn) {
    regBtn.textContent = "Submit";
  }
}

// INSTANT FETCH & CACHE WITH LOADING SKELETON
function fetchCases() {
  const cachedData = localStorage.getItem(LOCAL_STORAGE_KEY);
  const tbody = document.getElementById("caseTableBody");

  if (cachedData && tbody && tbody.children.length === 0) {
    try {
      const parsed = JSON.parse(cachedData);
      lastRawCasesData = parsed;
      renderTable(parsed);
    } catch(e) {}
  } else if (tbody && tbody.children.length === 0) {
    renderSkeletonLoader();
  }

  makeApiCall({ action: "getCases" }, "handleData");
}

function renderSkeletonLoader() {
  const tbody = document.getElementById("caseTableBody");
  if (!tbody) return;
  tbody.innerHTML = Array(5).fill(0).map(() => `
    <tr class="case-row" style="opacity: 0.4;">
      <td><div style="height: 18px; width: 110px; background: rgba(255,255,255,0.18); border-radius: 6px;"></div></td>
      <td><div style="height: 18px; width: 140px; background: rgba(255,255,255,0.18); border-radius: 6px;"></div></td>
      <td><div style="height: 24px; width: 160px; background: rgba(255,255,255,0.18); border-radius: 12px;"></div></td>
      <td><div style="height: 12px; width: 100%; background: rgba(255,255,255,0.18); border-radius: 6px;"></div></td>
      <td><div style="height: 24px; width: 80px; background: rgba(255,255,255,0.18); border-radius: 12px;"></div></td>
    </tr>
  `).join("");
}

window.handleData = function(result) {
  if (result && result.status === "success" && result.data) {
    lastRawCasesData = result.data;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(result.data));
    renderTable(result.data);
  } else if (result && result.status === "success" && result.data.length === 0) {
    document.getElementById("caseTableBody").innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: #cbd5e1;">
          No active cases found in Google Sheet ("raw").
        </td>
      </tr>`;
  }
};

// HIGH-PERFORMANCE DOCUMENT FRAGMENT BATCH RENDERING
function renderTable(cases) {
  const tbody = document.getElementById("caseTableBody");
  if (!tbody) return;

  const now = new Date();
  const fragment = document.createDocumentFragment();

  const processedCases = cases.map(item => {
    let agentStr = item.agent || "";
    let dateStr = item.dateTime || "";

    if ((agentStr.includes("GMT") || agentStr.includes("2026") || agentStr.includes("2025")) && !dateStr.includes("GMT")) {
      const temp = agentStr;
      agentStr = dateStr;
      dateStr = temp;
    }

    let cleanDateStr = dateStr.replace(/\(.*\)/, '').trim();
    let caseTime = new Date(cleanDateStr);

    if (isNaN(caseTime.getTime()) && dateStr) {
      caseTime = new Date(dateStr);
    }

    const isValidDate = !isNaN(caseTime.getTime());
    const elapsedMs = isValidDate ? (now - caseTime) : 0;
    const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / (1000 * 60)));

    return {
      agent: agentStr || "Unassigned",
      caseId: item.caseId || "N/A",
      status: item.status || "ONGOING",
      dateTime: dateStr,
      caseTime,
      isValidDate,
      elapsedMinutes
    };
  });

  processedCases.sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);

  processedCases.forEach(item => {
    const tr = document.createElement("tr");
    tr.className = "case-row";
    tr.setAttribute("data-case-id", item.caseId);
    tr.setAttribute("data-time-ms", item.isValidDate ? item.caseTime.getTime() : 0);
    tr.setAttribute("data-raw-status", item.status);

    const elapsedMinutes = item.elapsedMinutes;
    let isOngoing = item.status === "ONGOING";
    let isCompleted = item.status === "COMPLETED";
    let isUnfulfilled = item.status === "UNFULFILLED";

    if (elapsedMinutes >= MAX_AGING_MINUTES && isOngoing) {
      isUnfulfilled = true;
      isOngoing = false;
    }

    let percent = Math.min(100, (elapsedMinutes / MAX_AGING_MINUTES) * 100);

    let barColor = "#eab308";
    if (elapsedMinutes >= MAX_AGING_MINUTES || isUnfulfilled) {
      barColor = "#ef4444";
    } else if (elapsedMinutes >= 90) {
      barColor = "#f97316";
    }

    const formattedDate = item.isValidDate 
      ? item.caseTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : (item.dateTime || "N/A");

    let elapsedText = "";
    if (elapsedMinutes >= 60) {
      const hours = Math.floor(elapsedMinutes / 60);
      const mins = elapsedMinutes % 60;
      elapsedText = `${hours}h ${mins}m elapsed`;
    } else {
      elapsedText = `${elapsedMinutes} mins elapsed`;
    }

    let statusBadgeHtml = "";
    let shouldAnimate = isOngoing && !isCompleted && !isUnfulfilled;

    if (isCompleted) {
      statusBadgeHtml = `<span class="status-pill status-completed">COMPLETED</span>`;
    } else if (isUnfulfilled) {
      statusBadgeHtml = `<span class="status-pill status-unfulfilled">UNFULFILLED</span>`;
    } else {
      statusBadgeHtml = `<span class="status-pill status-ongoing">ONGOING</span>`;
    }

    tr.innerHTML = `
      <td style="color: #cbd5e1; font-size: 0.9rem;">${formattedDate}</td>
      <td><span class="agent-name">${item.agent}</span></td>
      <td><span class="case-id-tag">${item.caseId}</span></td>
      <td>
        <div class="aging-wrapper">
          <div class="aging-track">
            <div class="aging-fill ${shouldAnimate ? 'animated' : ''}" 
                 style="width: ${percent}%; background-color: ${barColor};">
            </div>
          </div>
          <div class="aging-meta">
            <span class="elapsed-text-label">${elapsedText}</span>
            <span class="status-label">${isCompleted ? 'Completed' : (isUnfulfilled ? 'Expired (2h)' : 'Max 2 Hours')}</span>
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

// REAL-TIME SECOND-BY-SECOND AGING SYNC
function updateAgingProgressBars(now) {
  const rows = document.querySelectorAll("#caseTableBody tr.case-row");
  rows.forEach(tr => {
    const timeMs = parseInt(tr.getAttribute("data-time-ms") || "0", 10);
    const rawStatus = tr.getAttribute("data-raw-status") || "ONGOING";

    if (!timeMs) return;

    const elapsedMs = Math.max(0, now.getTime() - timeMs);
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

    let isOngoing = rawStatus === "ONGOING";
    let isCompleted = rawStatus === "COMPLETED";
    let isUnfulfilled = rawStatus === "UNFULFILLED";

    if (elapsedMinutes >= MAX_AGING_MINUTES && isOngoing) {
      isUnfulfilled = true;
      isOngoing = false;
    }

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
    const statusCell = tr.querySelector(".status-cell");

    if (fillEl) {
      fillEl.style.width = `${percent}%`;
      fillEl.style.backgroundColor = barColor;

      if (isOngoing && !isCompleted && !isUnfulfilled) {
        fillEl.classList.add("animated");
      } else {
        fillEl.classList.remove("animated");
      }
    }

    if (elapsedLabel) {
      if (elapsedMinutes >= 60) {
        const hours = Math.floor(elapsedMinutes / 60);
        const mins = elapsedMinutes % 60;
        elapsedLabel.textContent = `${hours}h ${mins}m elapsed`;
      } else {
        elapsedLabel.textContent = `${elapsedMinutes} mins elapsed`;
      }
    }

    if (statusLabel) {
      statusLabel.textContent = isCompleted ? 'Completed' : (isUnfulfilled ? 'Expired (2h)' : 'Max 2 Hours');
    }

    if (statusCell) {
      if (isCompleted) {
        statusCell.innerHTML = `<span class="status-pill status-completed">COMPLETED</span>`;
      } else if (isUnfulfilled) {
        statusCell.innerHTML = `<span class="status-pill status-unfulfilled">UNFULFILLED</span>`;
      } else {
        statusCell.innerHTML = `<span class="status-pill status-ongoing">ONGOING</span>`;
      }
    }
  });
}

function validatePasswordRules(pass) {
  if (!pass || pass.length < 8) return false;
  const hasUpper = /[A-Z]/.test(pass);
  const hasDigit = /[0-9]/.test(pass);
  const hasSpecial = /[^A-Za-z0-9]/.test(pass);
  return hasUpper && hasDigit && hasSpecial;
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
  } else if (passMismatch && ansMismatch) {
    notif.textContent = "Password and security answer mismatched!";
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
  } else if (currentEmployee.requiresPasswordSetup) {
    const a1 = document.getElementById("accSecA").value;
    const a2 = document.getElementById("accSecARetype").value;
    let ansMismatch = (a1 !== a2) && (a1 !== "" || a2 !== "");

    if (passMismatch && ansMismatch) {
      notif.textContent = "Password and security answer mismatched!";
    } else if (passMismatch) {
      notif.textContent = "Password mismatch!";
    } else if (ansMismatch) {
      notif.textContent = "Security answer mismatch!";
    } else {
      notif.textContent = "";
    }
  } else {
    if (passMismatch) {
      notif.textContent = "Password mismatch!";
    } else {
      notif.textContent = "";
    }
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
        document.getElementById("accSubtext").textContent = "Initial password setup required before accessing portal views.";
      } else {
        setNavLock(false);
        switchView("prodView", document.getElementById("navProdBtn"));
        document.getElementById("accSubtext").textContent = "Manage your credentials and security preferences.";

        fetchCases();
        if (syncIntervalId) clearInterval(syncIntervalId);
        syncIntervalId = setInterval(fetchCases, 10000);
      }
    } else if (res.status === "denied") {
      notif.textContent = "Login denied: Account is not ACTIVE.";
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
