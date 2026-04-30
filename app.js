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
    const ssnRaw = document.getElementById('ssn').value;
    const ssnDigits = (ssnRaw || '').replace(/\D/g, '');
    const dob = document.getElementById('dob').value.trim();
    if (!fn || !ln) { showErr(1, 'Please fill in your name.'); return; }
    if (!em || !em.includes('@') || !em.includes('.')) { showErr(1, 'Please enter a valid email address.'); return; }
    if (ssnDigits.length !== 9) { showErr(1, 'Please enter your full 9-digit Social Security Number.'); return; }
    // DOB shape: MM/DD/YYYY (matches apply.cashinflash.com — text
    // input with numeric keypad + auto-slash via fmtDOB, much
    // better mobile UX than type=date's native picker).
    if (!dob || !/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) { showErr(1, 'Please enter your date of birth (MM/DD/YYYY).'); return; }
    // Sanity: must be a real date and ≥ 18 years old. Vergent's
    // V1 PostCustomerData rejects customer-create without a valid
    // BirthDate, and underwriting requires legal-adult applicants.
    const dobMs = Date.parse(dob);
    if (isNaN(dobMs)) { showErr(1, 'Please enter a valid date of birth.'); return; }
    const ageYears = (Date.now() - dobMs) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18 || ageYears > 120) { showErr(1, 'Applicants must be at least 18 years old.'); return; }
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
// DEBIT CARD (optional) — matches apply.cashinflash.com behavior
// ═══════════════════════════════════════════
function toggleCard() {
  const on = document.getElementById('cardOptIn').checked;
  const box = document.getElementById('cardFields');
  box.style.display = on ? 'block' : 'none';
  if (!on) {
    ['cardFirst','cardLast','cardNum','cardExp','cardCvv','cardZip'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const typeEl = document.getElementById('cardType'); if (typeEl) { typeEl.value = ''; typeEl.disabled = true; }
    const ack = document.getElementById('cardAck'); if (ack) ack.checked = false;
    const st = document.getElementById('cardStatus'); if (st) { st.textContent = ''; st.className = 'card-status'; }
  }
}

function detectBrand(d) {
  if (/^4/.test(d)) return 'Visa';
  if (/^(34|37)/.test(d)) return 'Amex';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return 'MasterCard';
  if (/^(6011|65|64[4-9])/.test(d)) return 'Discover';
  return '';
}

function onCardNum() {
  const el = document.getElementById('cardNum');
  const d = el.value.replace(/\D/g,'').slice(0,19);
  el.value = d.replace(/(.{4})/g,'$1 ').trim();
  const brand = detectBrand(d);
  const typeEl = document.getElementById('cardType');
  if (brand) { typeEl.value = brand; typeEl.disabled = true; }
  else       { typeEl.value = '';    typeEl.disabled = true; }
  const st = document.getElementById('cardStatus');
  if (st) {
    if (brand) { st.textContent = '✓ ' + brand; st.className = 'card-status'; }
    else       { st.textContent = '';            st.className = 'card-status'; }
  }
}

function onCardExp() {
  const el = document.getElementById('cardExp');
  const d = el.value.replace(/\D/g,'').slice(0,4);
  el.value = d.length <= 2 ? d : d.slice(0,2) + '/' + d.slice(2);
}

// ═══════════════════════════════════════════
// SUBMIT — payload format matches apply.cashinflash.com so docs
// applications go through the same underwriting + reporting pipeline
// (Firebase reports/, Claude underwriting, email, admin dashboard).
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

  // Card opt-in validation — when the customer chooses instant
  // debit-card funding, every card field is required AND they must
  // explicitly check the Push-to-Card Authorization box. Without
  // this we can't legally push funds to the card.
  const _v = id => (document.getElementById(id)?.value || '').trim();
  const _optedIn = document.getElementById('cardOptIn')?.checked === true;
  if (_optedIn) {
    const missing = [];
    if (!_v('cardFirst')) missing.push('cardholder first name');
    if (!_v('cardLast'))  missing.push('cardholder last name');
    const cardDigits = _v('cardNum').replace(/\D/g,'');
    if (cardDigits.length < 13 || cardDigits.length > 19) missing.push('valid debit card number');
    const expDigits = _v('cardExp').replace(/\D/g,'');
    if (expDigits.length !== 4) missing.push('expiration (MM/YY)');
    if (_v('cardCvv').length < 3) missing.push('CVV');
    if (!_v('cardZip')) missing.push('billing ZIP');
    if (document.getElementById('cardAck')?.checked !== true) {
      missing.push('Push-to-Card authorization acknowledgment');
    }
    if (missing.length) {
      showErr(3, 'Please complete the debit card section: ' + missing.join(', ') + '.');
      return;
    }
  }

  const btn = document.getElementById('submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const firstName = v('firstName');
    const lastName  = v('lastName');
    const ssnDigits = (v('ssn') || '').replace(/\D/g, '');
    const ssn4      = ssnDigits.slice(-4);
    const email     = v('email');
    const dob       = v('dob');

    // Source 'docs' is the dedicated value for docs.cashinflash.com
    // submissions — cif-apply server.py allowlists it alongside
    // 'web-apply', and cif-dashboard renders it with a distinct
    // purple "📄 Docs" pill so the admin can spot docs-originated
    // applications at a glance. Same Firebase reports/ + Vergent
    // auto-search + email notification pipeline as apply.cashinflash.com.
    // Full SSN populates applicationData.ssn (used by Vergent's
    // SSN-first search ladder); ssn4 also stays in the payload
    // because cif-apply's /submit handler stores it at the record
    // top level (server.py:1675) for legacy compatibility.
    const formData = {
      firstName, middleName: '', lastName,
      email,
      ssn: ssnDigits, ssn4,
      source: 'docs',
      loanAmount: '255',
      bankMethod: bankMethod === 'plaid' ? 'Plaid (Connected)' : 'PDF Upload',
      language: 'en',
      phone: '', dob, address: '', address2: '', city: '', state: 'CA', zip: '',
      sourceOfIncome: '', employer: '', payFrequency: '', payDay: '',
      lastPayDate: '', paymentMethod: '', grossPay: '',
      accountType: '', routingNumber: '', accountNumber: '', bankName: '',
      housingStatus: '', bankruptcy: '', military: '', consent: 'true',
      hasGovernmentId: !!govIdFile,
    };

    let pdfBase64 = '';
    if (bankMethod === 'upload') {
      pdfBase64 = await readFileAsBase64(bankFile);
    }
    const govIdB64 = govIdFile ? await readFileAsBase64(govIdFile) : '';

    // Debit card opt-in — server forwards this into the Firebase
    // record's debitCard sub-object, which the admin dashboard's
    // Debit Card tab reads directly.
    const cardOptIn = document.getElementById('cardOptIn')?.checked === true;
    const cardBrand = document.getElementById('cardType')?.value || '';
    const cardLast4 = (v('cardNum').replace(/\D/g,'').slice(-4)) || '';
    let cardData = null;
    if (cardOptIn) {
      const expRaw = v('cardExp').replace(/\D/g,'');
      cardData = {
        cardholderFirst: v('cardFirst'),
        cardholderLast:  v('cardLast'),
        cardNumber:      v('cardNum').replace(/\D/g,''),
        cvv:             v('cardCvv'),
        expMonth:        parseInt(expRaw.slice(0,2),10) || 0,
        expYear:         2000 + (parseInt(expRaw.slice(2,4),10) || 0),
        billingZip:      v('cardZip'),
        brand:           cardBrand,
        acknowledged:    document.getElementById('cardAck')?.checked === true,
      };
    }

    const payload = {
      formData,
      pdfBase64,
      govIdB64,
      govIdFilename: govIdFile ? govIdFile.name : '',
      bankFilename: bankFile ? bankFile.name : '',
      assetReportToken: bankMethod === 'plaid' ? (plaidAssetToken || '') : '',
      plaidAccessToken: bankMethod === 'plaid' ? (plaidAccessToken || '') : '',
      institution: bankMethod === 'plaid' ? plaidInstitution : '',
      cardOptIn,
      cardBrand,
      cardLast4,
      cardData,
    };

    const resp = await fetch(`${API_BASE}/submit`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    const result = await resp.json();
    if (!resp.ok || result.success === false) {
      throw new Error(result.error || 'Submission failed');
    }

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
// SSN auto-formatter — strip non-digits, cap at 9, render as XXX-XX-XXXX.
// Mirrors the helper used on apply.cashinflash.com so the field feels
// identical between the two forms. Bound via inline oninput on #ssn.
function fmtSSN(el) {
  const digits = (el.value || '').replace(/\D/g, '').slice(0, 9);
  let out = digits;
  if (digits.length > 5) {
    out = digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5);
  } else if (digits.length > 3) {
    out = digits.slice(0, 3) + '-' + digits.slice(3);
  }
  el.value = out;
}

// DOB auto-formatter — strip non-digits, cap at 8, render as
// MM/DD/YYYY. Inline copy of apply.cashinflash.com's fmtDOB so the
// numeric-keypad + auto-slash UX is identical between the two forms.
function fmtDOB(el) {
  let v = (el.value || '').replace(/\D/g, '');
  if (v.length > 4) {
    v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4, 8);
  } else if (v.length > 2) {
    v = v.slice(0, 2) + '/' + v.slice(2);
  }
  el.value = v;
}

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