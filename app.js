// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const API_BASE = window.BACKEND_URL || 'https://cif-apply.onrender.com';
const PLAID_HOST = API_BASE;

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let currentStep = 1;
let bankMethod = 'plaid';
let plaidAccessToken = '';
let plaidAssetToken = '';
let plaidInstitution = '';
let plaidLinkToken = '';
let plaidPolling = null;
let govIdFile = null;
let bankFile = null;

// ═══════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════
function goStep(n) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');

  // Update dots
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`dot-${i}`);
    const lbl = document.getElementById(`lbl-${i}`);
    dot.className = 'step-dot' + (i < n ? ' done' : i === n ? ' active' : '');
    lbl.className = 'step-label' + (i === n ? ' active' : '');
  }
  // Update lines
  for (let i = 1; i <= 2; i++) {
    document.getElementById(`line-${i}`).className = 'step-line' + (i < n ? ' done' : '');
  }
  currentStep = n;
  window.scrollTo({top:0, behavior:'smooth'});
}

function nextStep(from) {
  hideErr(from);
  if (from === 1) {
    const fn = document.getElementById('firstName').value.trim();
    const ln = document.getElementById('lastName').value.trim();
    const em = document.getElementById('email').value.trim();
    const ssn = document.getElementById('ssn4').value.trim();
    if (!fn || !ln) { showErr(1, 'Please fill in your name.'); return; }
    if (!em || !em.includes('@') || !em.includes('.')) { showErr(1, 'Please enter a valid email address.'); return; }
    if (ssn.length !== 4 || !/^\d{4}$/.test(ssn)) { showErr(1, 'Please enter exactly 4 digits for your SSN.'); return; }
  }
  if (from === 2) {
    if (!govIdFile) { showErr(2, 'Please upload your government ID.'); return; }
  }
  goStep(from + 1);
}

function prevStep(from) { goStep(from - 1); }

function showErr(n, msg) {
  const el = document.getElementById(`err-${n}`);
  el.textContent = msg || el.textContent;
  el.classList.add('show');
}
function hideErr(n) { document.getElementById(`err-${n}`).classList.remove('show'); }

// ═══════════════════════════════════════════
// BANK TAB SWITCH
// ═══════════════════════════════════════════
function switchBank(mode) {
  bankMethod = mode;
  document.getElementById('bank-plaid').style.display = mode === 'plaid' ? 'block' : 'none';
  document.getElementById('bank-upload').style.display = mode === 'upload' ? 'block' : 'none';
  document.getElementById('btn-plaid-tab').className = 'bank-btn' + (mode === 'plaid' ? ' active' : '');
  document.getElementById('btn-upload-tab').className = 'bank-btn' + (mode === 'upload' ? ' active' : '');
}

// ═══════════════════════════════════════════
// FILE UPLOAD HELPERS
// ═══════════════════════════════════════════
function onFileSelect(inputId, zoneId, filenameId) {
  const file = document.getElementById(inputId).files[0];
  if (!file) return;
  if (inputId === 'govId') govIdFile = file;
  if (inputId === 'bankStatement') bankFile = file;
  const zone = document.getElementById(zoneId);
  zone.classList.add('has-file');
  document.getElementById(filenameId).textContent = '✓ ' + file.name;
}

function onDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('over');
}
function onDragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove('over');
}
function onDrop(e, inputId, zoneId, filenameId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (inputId === 'govId') govIdFile = file;
  if (inputId === 'bankStatement') bankFile = file;
  document.getElementById(zoneId).classList.add('has-file');
  if (filenameId) document.getElementById(filenameId).textContent = '✓ ' + file.name;
}

// ═══════════════════════════════════════════
// PLAID — copied exactly from apply.cashinflash.com
// ═══════════════════════════════════════════
async function startPlaid() {
  const btn = document.getElementById('plaid-connect-btn');
  const statusEl = document.getElementById('plaid-status-msg');
  if (btn) { btn.disabled = true; }
  try {
    // Exact same call as apply.cashinflash.com/form.html
    const r = await fetch(`${API_BASE}/plaid/link-token`);
    const d = await r.json();
    if (!d.link_token) throw new Error('No link token');

    const handler = Plaid.create({
      token: d.link_token,
      onSuccess: async (public_token, metadata) => {
        plaidInstitution = metadata.institution?.name || 'Your Bank';
        if (statusEl) { statusEl.textContent = '⟳ Connecting...'; statusEl.style.display = 'block'; }
        try {
          const ex = await fetch(`${API_BASE}/plaid/exchange`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({public_token})
          });
          const exd = await ex.json();
          plaidAccessToken = exd.access_token || exd.accessToken || public_token;
          plaidAssetToken = exd.asset_report_token || '';
          showPlaidConnected(plaidInstitution);
        } catch(e) {
          // Exchange failed — still mark connected so user can proceed
          plaidAccessToken = public_token;
          showPlaidConnected(plaidInstitution);
        }
      },
      onExit: (err) => {
        if (btn) { btn.disabled = false; }
        if (err && statusEl) {
          statusEl.textContent = 'Connection cancelled. Try again.';
          statusEl.style.display = 'block';
        }
      }
    });
    handler.open();
  } catch(e) {
    if (btn) { btn.disabled = false; }
    showErr(3, 'Could not connect to Plaid. Please try uploading your bank statement instead.');
    console.error('[Plaid]', e);
  }
}

function showPlaidConnected(institution) {
  document.getElementById('plaid-connect-box').style.display = 'none';
  document.getElementById('plaid-done-box').style.display = 'block';
  document.getElementById('plaid-institution-name').textContent = institution + ' connected';
}

// ═══════════════════════════════════════════
// SUBMIT
// ═══════════════════════════════════════════
async function submitForm() {
  hideErr(3);

  // Validate bank
  if (bankMethod === 'plaid' && !plaidAccessToken) {
    showErr(3, 'Please connect your bank account using Plaid.');
    return;
  }
  if (bankMethod === 'upload' && !bankFile) {
    showErr(3, 'Please upload your bank statement PDF.');
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const firstName = document.getElementById('firstName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const ssn4      = document.getElementById('ssn4').value.trim();

    // Build form data payload matching the existing /submit endpoint
    // Mark as "lead" source so the dashboard shows the Lead badge
    const email = document.getElementById('email').value.trim();
    const formData = {
      firstName, lastName,
      email,                         // captured for denial emails
      ssn4,                          // last 4 only — stored for Vergent matching
      source: 'lead',                // triggers Lead badge in dashboard
      loanAmount: '255',             // leads are pre-qualified, default to max
      bankMethod: bankMethod === 'plaid' ? 'Plaid' : 'Upload',
      // Pass through minimal fields the backend needs
      phone: '', address: '', city: '', state: 'CA', zip: '',
      employer: '', sourceOfIncome: '', payFrequency: '', lastPayDate: '',
    };

    let pdfB64 = '';
    let assetToken = '';

    if (bankMethod === 'upload') {
      // Read PDF as base64
      pdfB64 = await readFileAsBase64(bankFile);
    }

    // Gov ID as base64 for storage
    const govIdB64 = govIdFile ? await readFileAsBase64(govIdFile) : '';

    // Submit to the existing backend
    const payload = {
      formData,
      pdfB64,
      govIdB64,
      govIdFilename: govIdFile ? govIdFile.name : '',
      bankFilename: bankFile ? bankFile.name : '',
    };

    if (bankMethod === 'plaid') {
      // Send assetReportToken — the server uses this to fetch the Plaid asset report PDF
      // accessToken is kept as fallback in case asset report is still generating
      payload.assetReportToken = plaidAssetToken;
      payload.accessToken = plaidAccessToken;
      payload.institution = plaidInstitution;
    }

    const resp = await fetch(`${API_BASE}/submit`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Submission failed');

    showSuccess(firstName + ' ' + lastName);

  } catch(e) {
    btn.classList.remove('loading');
    btn.disabled = false;
    showErr(3, 'Submission failed: ' + (e.message || 'Please try again.'));
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════
// SUCCESS
// ═══════════════════════════════════════════
function showSuccess(name) {
  document.getElementById('form-screen').style.display = 'none';
  const s = document.getElementById('success-screen');
  s.style.display = 'flex';
  document.getElementById('success-name').textContent = name;
  window.scrollTo({top:0, behavior:'smooth'});
}

// ═══════════════════════════════════════════
// SSN — digits only
// ═══════════════════════════════════════════
document.getElementById('ssn4').addEventListener('input', function() {
  this.value = this.value.replace(/\D/g,'').slice(0,4);
});

// Plaid token check from redirect (iOS return)
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('plaid_connected') === '1') {
    const token = params.get('access_token');
    const inst  = params.get('institution') || 'Your Bank';
    if (token) {
      plaidAccessToken = token;
      plaidInstitution = inst;
      goStep(3);
      showPlaidConnected(inst);
    }
  }
});

// Mobile menu toggle
(function(){
  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('mobile-menu');
  const overlay = document.getElementById('mobile-overlay');
  if (!toggle || !menu) return;
  const open = () => { toggle.classList.add('active'); menu.classList.add('open'); overlay.classList.add('open'); document.body.style.overflow='hidden'; };
  const close = () => { toggle.classList.remove('active'); menu.classList.remove('open'); overlay.classList.remove('open'); document.body.style.overflow=''; };
  toggle.addEventListener('click', () => menu.classList.contains('open') ? close() : open());
  overlay.addEventListener('click', close);
  const cb = document.getElementById('mobile-close-btn');
  if (cb) cb.addEventListener('click', close);
})();
