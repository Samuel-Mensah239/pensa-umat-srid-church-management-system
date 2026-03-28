const firebaseConfig = {
  apiKey: "AIzaSyCY2g6OTmGKV7ms9kxBIlt-GZYWUqp8Ass",
  authDomain: "pensa-umat-srid-portal.firebaseapp.com",
  databaseURL: "https://pensa-umat-srid-portal-default-rtdb.firebaseio.com",
  projectId: "pensa-umat-srid-portal",
  storageBucket: "pensa-umat-srid-portal.firebasestorage.app",
  messagingSenderId: "1040077755257",
  appId: "1:1040077755257:web:ca2d1269f1ebf80c6255a8",
};

// Paystack public key (prefer localStorage/meta/window override for safer updates)
// Default Paystack public key used when no meta/window/localStorage override is present.
const PAYSTACK_PUBLIC_KEY_FALLBACK = "pk_test_0a2b406ef0e280e66094bc023dc60aff05c7b620";

// 2. Initialize Firebase (guarded to avoid blocking UI if SDK fails)
let firebaseReady = false;
let auth = null;
let database = null;

function initFirebase() {
  if (firebaseReady && auth && database) return true;
  if (typeof window.firebase === "undefined") {
    console.warn("Firebase SDK not loaded. Running in local-only mode.");
    return false;
  }
  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }
    auth = firebase.auth();
    database = firebase.database();
    firebaseReady = true;
    return true;
  } catch (err) {
    console.error("Firebase initialization failed - script.js:28", err);
    return false;
  }
}

function ensureFirebase() {
  return initFirebase();
}

function getPaystackPublicKey() {
  const meta = document.querySelector('meta[name="paystack-public-key"]');
  if (meta && typeof meta.content === "string" && meta.content.trim())
    return meta.content.trim();
  if (typeof window.PAYSTACK_PUBLIC_KEY === "string" && window.PAYSTACK_PUBLIC_KEY.trim())
    return window.PAYSTACK_PUBLIC_KEY.trim();
  const stored = localStorage.getItem("pensa_paystack_public_key");
  if (stored && stored.trim()) return stored.trim();
  return PAYSTACK_PUBLIC_KEY_FALLBACK;
}

function isValidPaystackKey(key) {
  return typeof key === "string" && /^pk_(test|live)_[A-Za-z0-9]+$/.test(key);
}

// 3. Global Database Object
let db = {
  members: [],
  executives: [],
  finance: [],
  history: [],
  magazines: [],
};
let currentUserMode = "member";
let currentMemberUid = null;
let currentMemberProfile = null;
let cloudDataLoaded = false;

function formatCurrency(value) {
  const v = Number(value);
  if (Number.isNaN(v) || v === 0) return "";
  return v.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseCurrency(value) {
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setupCurrencyField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const raw = el.value.replace(/[^0-9.]/g, "");
    const parts = raw.split(".");
    if (parts.length > 2) el.value = parts[0] + "." + parts.slice(1).join("");
    else el.value = raw;
  });
  el.addEventListener("blur", () => {
    const amount = parseCurrency(el.value);
    if (amount > 0) el.value = formatCurrency(amount);
    else el.value = "";
  });
  el.addEventListener("focus", () => {
    const amount = parseCurrency(el.value);
    if (amount > 0) el.value = amount.toString();
  });
}

function ensureArray(arr) {
  if (Array.isArray(arr)) return arr;
  if (arr && typeof arr === "object") return Object.values(arr);
  return [];
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(raw) {
  try {
    const u = new URL(raw);
    if (["http:", "https:"].includes(u.protocol)) return u.href;
  } catch (e) {
    return "";
  }
  return "";
}

function setPortalMode(mode) {
  currentUserMode = mode === "admin" ? "admin" : "member";
  if (currentUserMode === "admin") {
    document.body.classList.remove("member-mode");
  } else {
    document.body.classList.add("member-mode");
  }
  localStorage.setItem("pensa_session_mode", currentUserMode);
}

function isAdminMode() {
  return currentUserMode === "admin" && auth && auth.currentUser;
}

// --- AUTHENTICATION LAYER ---
function showAuthChoice() {
  document.getElementById("auth-choice-overlay").style.display = "flex";
  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("member-login-overlay").style.display = "none";
}

function openLogin(type) {
  document.getElementById("auth-choice-overlay").style.display = "none";
  if (type === "admin")
    document.getElementById("login-overlay").style.display = "flex";
  else document.getElementById("member-login-overlay").style.display = "flex";
}

function checkLogin() {
  const email = document.getElementById("adminEmail").value.trim();
  const pass = document.getElementById("adminPassword").value;
  const msg = document.getElementById("login-msg");

  if (!email || !pass) {
    msg.innerText = "Please enter email and password.";
    return;
  }

  if (!ensureFirebase() || !auth) {
    msg.innerText = "Auth service unavailable. Check your connection.";
    return;
  }

  auth
    .signInWithEmailAndPassword(email, pass)
    .then(() => {
      setPortalMode("admin");
      unlockPortal("Access Granted. Welcome Admin.");
      msg.innerText = "";
    })
    .catch((error) => {
      console.error("Auth error - script.js:137", error);
      msg.innerText = "Invalid admin credentials. Please try again.";
      document.getElementById("adminPassword").value = "";
    });
}

function logout() {
  localStorage.removeItem("pensa_session_mode");
  setPortalMode("member");
  if (!auth) return location.reload();
  auth.signOut().finally(() => location.reload());
}

function showMemberSignup() {
  document.getElementById("memberAuthTitle").innerText = "Member Sign Up";
  document.getElementById("memberLoginForm").style.display = "none";
  document.getElementById("memberSignupForm").style.display = "block";
  document.getElementById("member-login-msg").innerText = "";
}

function showMemberLogin() {
  document.getElementById("memberAuthTitle").innerText = "Member Login";
  document.getElementById("memberSignupForm").style.display = "none";
  document.getElementById("memberLoginForm").style.display = "block";
  document.getElementById("member-login-msg").innerText = "";
  const fb = document.getElementById("memberFeedback");
  if (fb) fb.innerText = "";
  const resend = document.getElementById("resendVerifyBtn");
  if (resend) resend.style.display = "none";
  const btn = document.getElementById("memberLoginBtn");
  if (btn) btn.disabled = false;
}

function loadMemberProfile(uid) {
  if (!uid) return;
  if (!ensureFirebase() || !database) {
    console.warn("Database unavailable; skipping member profile load.");
    return;
  }
  database
    .ref("members/" + uid)
    .once("value")
    .then((snapshot) => {
      const profile = snapshot.val();
      if (profile) {
        currentMemberUid = uid;
        currentMemberProfile = profile;
        document.getElementById("payName").value = profile.name || "";
        updateCounts();
        renderAll();
      }
    })
    .catch((err) => {
      console.error("Failed to load member profile - script.js:204", err);
    });
}

function memberLogin() {
  const email = document.getElementById("memberEmail").value.trim();
  const pass = document.getElementById("memberPassword").value;
  if (!email || !pass) {
    document.getElementById("member-login-msg").innerText =
      "Please enter email and password.";
    return;
  }

  if (!ensureFirebase() || !auth) {
    document.getElementById("member-login-msg").innerText =
      "Auth service unavailable. Check your connection.";
    return;
  }

  auth
    .signInWithEmailAndPassword(email, pass)
    .then((userCred) => {
      const user = userCred.user;
      if (!user.emailVerified) {
        document.getElementById("member-login-msg").innerText =
          "Verification required. Check your email.";
        const fb = document.getElementById("memberFeedback");
        if (fb)
          fb.innerText = "Email not verified. Click Resend to send again.";
        const resend = document.getElementById("resendVerifyBtn");
        if (resend) resend.style.display = "block";
        const btn = document.getElementById("memberLoginBtn");
        if (btn) btn.disabled = true;
        return;
      }
      const uid = user.uid;
      setPortalMode("member");
      loadMemberProfile(uid);
      showToast("Login successful. Welcome to Member Hub.", "success");
      unlockPortal("Welcome to the Member Hub");
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("member-login-msg").innerText =
        "Invalid member login. Use registered email and password.";
    });
}

function resendVerification() {
  if (!ensureFirebase() || !auth) {
    showToast("Auth service unavailable. Check your connection.", "error");
    return;
  }
  const user = auth.currentUser;
  if (!user) {
    showToast("Login first to resend verification.", "error");
    return;
  }
  user
    .sendEmailVerification()
    .then(() => {
      showToast("Verification email resent. Check inbox.", "success");
    })
    .catch((err) => {
      console.error(err);
      showToast("Could not resend verification email.", "error");
    });
}

function memberSignup() {
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const phone = document.getElementById("signupPhone").value.trim();
  const course = document.getElementById("signupCourse").value.trim();
  const level = document.getElementById("signupLevel").value;
  const wing = document.getElementById("signupWing").value;
  const password = document.getElementById("signupPassword").value;

  if (
    !name ||
    !email ||
    !phone ||
    !course ||
    !password ||
    password.length < 6
  ) {
    document.getElementById("member-login-msg").innerText =
      "Please fill all fields and use a password at least 6 characters.";
    return;
  }

  if (!ensureFirebase() || !auth || !database) {
    document.getElementById("member-login-msg").innerText =
      "Sign-up service unavailable. Check your connection.";
    return;
  }

  auth
    .createUserWithEmailAndPassword(email, password)
    .then((userCred) => {
      document.getElementById("member-login-msg").innerText =
        "Creating account...";
      const uid = userCred.user.uid;
      const memberData = {
        uid: uid,
        name: escapeHtml(name),
        email: email,
        phone: escapeHtml(phone),
        course: escapeHtml(course),
        level: escapeHtml(level),
        wing: escapeHtml(wing),
        status: "active",
      };
      return database
        .ref("members/" + uid)
        .set(memberData)
        .then(() => {
          db.members.push(memberData);
          saveData();
          // Send verification email after saving data
          userCred.user
            .sendEmailVerification()
            .then(() => {
              document.getElementById("member-login-msg").innerText = "";
              showToast(
                "Registration successful! A verification email has been sent. Please verify your email before login.",
                "success",
              );
              showMemberLogin();
            })
            .catch((verifyError) => {
              console.error(
                "Verification email failed: - script.js:300",
                verifyError,
              );
              document.getElementById("member-login-msg").innerText =
                "Account created, but verification email could not be sent. Please check your email settings or contact admin.";
              showToast(
                "Account created! Please verify your email manually or contact support.",
                "warning",
              );
              showMemberLogin();
            });
        });
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("member-login-msg").innerText =
        err.message || "Sign-up error.";
    });
}

function unlockPortal(msg) {
  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("member-login-overlay").style.display = "none";
  document.getElementById("auth-choice-overlay").style.display = "none"; // Ensure choice is hidden

  const nav = document.getElementById("mainNav");
  const main = document.getElementById("mainContent");
  nav.style.visibility = "visible";
  main.style.visibility = "visible";
  nav.classList.add("zoom-entrance");
  main.classList.add("zoom-entrance");
  showToast(msg);
  renderAll();
}

const saveData = (options = {}) => {
  const { silent = false, onSuccess, onError } = options;
  localStorage.setItem("pensa_db", JSON.stringify(db));
  if (!ensureFirebase() || !database) {
    console.warn("Cloud sync skipped; Firebase unavailable.");
    if (!silent) showToast("Offline mode: saved locally only.", "error");
    updateCounts();
    if (typeof onError === "function")
      onError(new Error("Cloud unavailable"));
    return;
  }
  database
    .ref("pensa_data")
    .update(db)
    .then(() => {
      console.log("Cloud synced successfully! - script.js:376");
      updateCounts();
      if (typeof onSuccess === "function") onSuccess();
    })
    .catch((err) => {
      console.error("Firebase Sync Failed: - script.js:380", err);
      const msg =
        err && err.message
          ? `SAVE FAILED: ${err.message}`
          : "SAVE FAILED: Check network or database permissions.";
      if (!silent) showToast(msg, "error");
      if (typeof onError === "function") onError(err);
    });
};

const loadData = () => {
  const localData = localStorage.getItem("pensa_db");
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      db.members = ensureArray(parsed.members);
      db.finance = ensureArray(parsed.finance);
      db.executives = ensureArray(parsed.executives);
      db.history = ensureArray(parsed.history);
      db.magazines = ensureArray(parsed.magazines);
      renderAll();
    } catch (e) {
      console.warn("Invalid local backing data - script.js:363", e);
    }
  }

  if (!ensureFirebase() || !database) {
    cloudDataLoaded = true;
    console.warn("Cloud data unavailable; using local data only.");
    showToast("Cloud unavailable. Using local data.", "error");
    renderAll();
    return;
  }

  database.ref("pensa_data").on(
    "value",
    (snapshot) => {
      cloudDataLoaded = true;
      const cloudData = snapshot.val();
      if (cloudData) {
        db.members = ensureArray(cloudData.members);
        db.finance = ensureArray(cloudData.finance);
        db.executives = ensureArray(cloudData.executives);
        db.history = ensureArray(cloudData.history);
        db.magazines = ensureArray(cloudData.magazines);
      }
      renderAll();
    },
    (error) => {
      cloudDataLoaded = true;
      console.error("Firebase load failed - script.js:383", error);
      showToast("Unable to load cloud data. Using local data.", "error");
      renderAll();
    },
  );
};

// --- INPUT VALIDATION LAYER ---
function validateInput(id, type) {
  const el = document.getElementById(id);
  if (!el) return false;
  const val = el.value.trim();
  let isValid = true;
  if (!val) isValid = false;
  if (type === "phone" && !/^[0-9]{10}$/.test(val)) isValid = false;
  if (type === "email" && !/\S+@\S+\.\S+/.test(val)) isValid = false;
  if (!isValid) el.classList.add("error");
  else el.classList.remove("error");
  return isValid;
}

// --- SEARCH & FILTERING ---
function filterTable() {
  const query = document.getElementById("memberSearch").value.toLowerCase();
  const rows = document.querySelectorAll(
    "#activeTable tbody tr, #alumniTable tbody tr",
  );
  rows.forEach((row) => {
    row.style.display = row.innerText.toLowerCase().includes(query)
      ? ""
      : "none";
  });
}

function filterExecs() {
  const query = document.getElementById("execSearch").value.toLowerCase();
  const rows = document.querySelectorAll("#execTable tbody tr");
  rows.forEach((row) => {
    row.style.display = row.innerText.toLowerCase().includes(query)
      ? ""
      : "none";
  });
}

// --- PROFESSIONAL TOAST SYSTEM ---
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${type === "success" ? "fa-check-circle" : "fa-exclamation-circle"}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// --- PROFESSIONAL PDF & CSV GENERATION ---
function generateFinancePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text("PENSA UMaT-SRID FINANCIAL REPORT", 14, 22);
  const rows = db.finance
    .filter((f) => f.status !== "deleted")
    .map((f) => [
      f.date,
      f.name,
      f.type,
      `GHS ${f.amount.toFixed(2)}`,
      f.method,
    ]);
  doc.autoTable({
    startY: 40,
    head: [["Date", "Name", "Type", "Amount", "Method"]],
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [26, 35, 126] },
  });
  doc.save(`PENSA_Finance_${Date.now()}.pdf`);
}

function generateSingleReceipt(id) {
  const f = db.finance.find((x) => x.id === id);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(20);
  doc.setTextColor(26, 35, 126);
  doc.text("PENSA UMaT-SRID", 105, 20, { align: "center" });
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text("OFFICIAL PAYMENT RECEIPT", 105, 30, { align: "center" });
  doc.setTextColor(0);
  doc.text(`Reference: ${f.ref}`, 14, 50);
  doc.text(`Name: ${f.name}`, 14, 60);
  doc.text(`Amount: GHS ${f.amount.toFixed(2)}`, 14, 70);
  doc.text(`Category: ${f.type}`, 14, 80);
  doc.text(`Date: ${f.date}`, 14, 90);
  doc.save(`Receipt_${f.ref}.pdf`);
}

function exportToCSV(type) {
  let csvContent = "data:text/csv;charset=utf-8,";
  let fileName = "";
  let dataToExport = [];
  const clean = (val) => `"${String(val).replace(/"/g, '""')}"`;
  if (type === "members") {
    fileName = `PENSA_Members_${new Date().toLocaleDateString()}.csv`;
    csvContent += "Name,Phone,Course,Level,Wing,Status\n";
    dataToExport = db.members.filter((m) => m.status !== "deleted");
    dataToExport.forEach((m) => {
      csvContent +=
        [
          clean(m.name),
          clean(m.phone),
          clean(m.course),
          m.level,
          clean(m.wing),
          m.level === "Alumni" ? "Graduated" : "Active",
        ].join(",") + "\n";
    });
  } else if (type === "finance") {
    fileName = `PENSA_Finance_Report_${new Date().toLocaleDateString()}.csv`;
    csvContent += "Date,Name,Type,Amount (GHS),Reference,Method\n";
    dataToExport = db.finance.filter((f) => f.status !== "deleted");
    dataToExport.forEach((f) => {
      csvContent +=
        [
          f.date,
          clean(f.name),
          f.type,
          f.amount.toFixed(2),
          clean(f.ref),
          f.method,
        ].join(",") + "\n";
    });
  }
  if (dataToExport.length === 0)
    return showToast("No data available!", "error");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- SMART PROMOTION ---
function promoteAllLevels() {
  if (!confirm("Promote all students? Level 400s will become Alumni.")) return;
  db.members.forEach((m) => {
    if (m.status !== "deleted") {
      if (m.level === "400") m.level = "Alumni";
      else if (m.level === "300") m.level = "400";
      else if (m.level === "200") m.level = "300";
      else if (m.level === "100") m.level = "200";
    }
  });
  saveData();
  renderMembers();
  showToast("Members promoted successfully!");
}

function payWithPaystack() {
  if (
    !validateInput("payName") ||
    !validateInput("payEmail", "email") ||
    !validateInput("payAmount")
  )
    return showToast("Check fields", "error");

  const name = document.getElementById("payName").value;
  const email = document.getElementById("payEmail").value;
  const amount = parseCurrency(document.getElementById("payAmount").value);
  const type = document.getElementById("payType").value;
  if (!amount || amount <= 0)
    return showToast("Enter a valid amount > 0", "error");

  if (typeof window.PaystackPop === "undefined") {
    return showToast(
      "Payment service unavailable. Check your network/ad blocker.",
      "error",
    );
  }

  const publicKey = getPaystackPublicKey();
  if (!isValidPaystackKey(publicKey)) {
    return showToast(
      "Paystack public key missing/invalid. Set a valid pk_test_... key.",
      "error",
    );
  }

  const handler = PaystackPop.setup({
    key: publicKey,
    email: email,
    amount: amount * 100,
    currency: "GHS",
    callback: function (response) {
      const newEntry = {
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        name: escapeHtml(name),
        amount: parseFloat(amount),
        type: escapeHtml(type),
        method: "MOMO",
        ref: escapeHtml(response.reference || "N/A"),
        uid: currentMemberUid || null,
        status: "active",
      };
      db.finance.push(newEntry);
      renderFinance();
      updateCounts();
      saveData({
        silent: true,
        onSuccess: () => showToast("Payment Recorded in Cloud!"),
        onError: (err) => {
          const msg =
            err && err.message
              ? `Saved locally, cloud sync failed: ${err.message}`
              : "Saved locally, cloud sync failed.";
          showToast(msg, "error");
        },
      });
    },
  });
  handler.openIframe();
}

function addFinance() {
  if (!validateInput("fName") || !validateInput("fAmount")) return;
  const name = document.getElementById("fName").value;
  const amount = parseCurrency(document.getElementById("fAmount").value);
  const type = document.getElementById("fType").value;

  if (!amount || amount <= 0) {
    showToast("Amount must be a positive number.", "error");
    return;
  }

  const newEntry = {
    id: Date.now(),
    date: new Date().toLocaleDateString(),
    name: escapeHtml(name),
    type: escapeHtml(type),
    amount: amount,
    method: "Cash",
    ref: "CASH-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000),
    uid: currentMemberUid || null,
    status: "active",
  };
  db.finance.push(newEntry);
  renderFinance();
  updateCounts();
  saveData({
    silent: true,
    onSuccess: () => showToast("Cash Entry Saved!"),
    onError: (err) => {
      const msg =
        err && err.message
          ? `Saved locally, cloud sync failed: ${err.message}`
          : "Saved locally, cloud sync failed.";
      showToast(msg, "error");
    },
  });
  document.getElementById("fName").value = "";
  document.getElementById("fAmount").value = "";
}

function renderFinance() {
  const body = document.querySelector("#financeTable tbody");
  if (!body) return;
  const loggedInName = document.getElementById("payName").value;

  body.innerHTML = db.finance
    .filter((f) => {
      if (f.status === "deleted") return false;
      if (isAdminMode()) return true;
      if (currentMemberUid) return f.uid === currentMemberUid;
      return f.name === loggedInName;
    })
    .reverse()
    .map(
      (f) => `
        <tr>
            <td>${escapeHtml(f.date)}</td><td><strong>${escapeHtml(f.name)}</strong></td><td>${escapeHtml(f.type)}</td>
            <td style="color:var(--green); font-weight:600;">GH₵ ${parseFloat(f.amount || 0).toFixed(2)}</td>
            <td style="font-family:monospace;">${escapeHtml(f.ref)}</td>
            <td>
                ${
                  isAdminMode()
                    ? `<button class="btn btn-delete" onclick="deleteItem('finance', ${f.id})"><i class="fas fa-trash"></i></button>`
                    : `<button class="btn btn-gold" onclick="generateSingleReceipt(${f.id})">Receipt</button>`
                }
            </td>
        </tr>`,
    )
    .join("");
}

// --- MEMBER MANAGEMENT ---
let editMemberId = null;
function addMember() {
  if (!validateInput("mName") || !validateInput("mPhone", "phone")) return;
  const member = {
    id: editMemberId || Date.now(),
    name: escapeHtml(document.getElementById("mName").value),
    phone: escapeHtml(document.getElementById("mPhone").value),
    course: escapeHtml(document.getElementById("mCourse").value),
    level: escapeHtml(document.getElementById("mLevel").value),
    wing: escapeHtml(document.getElementById("mWing").value),
    status: "active",
  };
  if (editMemberId) {
    const index = db.members.findIndex((m) => m.id === editMemberId);
    db.members[index] = member;
    editMemberId = null;
    document.getElementById("memberBtn").innerText = "Save Member";
  } else {
    db.members.push(member);
  }
  saveData();
  renderMembers();
  resetMemberForm();
}

function renderMembers() {
  const activeBody = document.querySelector("#activeTable tbody");
  const alumniBody = document.querySelector("#alumniTable tbody");
  if (!activeBody || !alumniBody) return;
  activeBody.innerHTML = "";
  alumniBody.innerHTML = "";
  db.members
    .filter((m) => m.status !== "deleted")
    .forEach((m) => {
      const isAlumni = m.level === "Alumni";
      const row = `<tr>
            <td><strong>${escapeHtml(m.name)}</strong></td><td>${escapeHtml(m.phone)}</td><td>${escapeHtml(m.course)}</td>
            <td><span class="badge">${isAlumni ? "GRADUATED" : "L-" + escapeHtml(m.level)}</span></td>
            <td>${escapeHtml(m.wing)}</td>
            <td>
                <button class="btn btn-edit" onclick="editMember(${m.id})"><i class="fas fa-pen"></i></button>
                <button class="btn btn-delete" onclick="deleteItem('members', ${m.id})"><i class="fas fa-trash"></i></button>
            </td></tr>`;
      if (isAlumni) alumniBody.innerHTML += row;
      else activeBody.innerHTML += row;
    });
}

function editMember(id) {
  const m = db.members.find((m) => m.id === id);
  if (!m) return;
  editMemberId = id;
  document.getElementById("mName").value = m.name;
  document.getElementById("mPhone").value = m.phone;
  document.getElementById("mCourse").value = m.course;
  document.getElementById("mLevel").value = m.level;
  document.getElementById("mWing").value = m.wing;
  document.getElementById("memberBtn").innerText = "Update Member";
  showSection("members");
}

function resetMemberForm() {
  ["mName", "mPhone", "mCourse"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function addExecutive() {
  const name = document.getElementById("eName").value.trim();
  const pos = document.getElementById("ePosition").value.trim();
  const year = document.getElementById("eYear").value.trim();
  if (!name || !pos) return showToast("Fill all fields", "error");

  const newExec = {
    id: Date.now(),
    name,
    position: pos,
    year,
    status: "active",
  };
  db.executives.push(newExec);
  saveData();
  renderExecutives();
  showToast("Executive Archived!");
  document.getElementById("eName").value = "";
  document.getElementById("ePosition").value = "";
  document.getElementById("eYear").value = "";
}

function renderExecutives() {
  const body = document.querySelector("#execTable tbody");
  if (!body) return;
  body.innerHTML = db.executives
    .filter((e) => e.status !== "deleted")
    .reverse()
    .map(
      (e) => `
        <tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.position)}</td><td>${escapeHtml(e.year)}</td>
        <td><button class="btn btn-delete" onclick="deleteItem('executives', ${e.id})"><i class="fas fa-trash"></i></button></td></tr>`,
    )
    .join("");
}

function addMagLink() {
  const linkInput = document.getElementById("magLink");
  const linkValue = sanitizeUrl(linkInput.value.trim());

  if (!linkValue) {
    showToast("Please paste a valid HTTP(S) link first!", "error");
    return;
  }

  const newMag = {
    id: Date.now(),
    link: linkValue,
    date: new Date().toLocaleDateString(),
    status: "active",
  };
  db.magazines.push(newMag);
  saveData();
  renderMagazines();
  linkInput.value = "";
  showToast("Magazine link saved successfully!");
}

function renderMagazines() {
  const magazineList = document.getElementById("magazineList");
  if (!magazineList) return;

  const content = db.magazines
    .filter((m) => m.status !== "deleted")
    .map((m) => {
      const sanitizedLink = sanitizeUrl(m.link);
      return `
            <div class="mag-item" style="border: 1px solid #ccc; padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <p style="margin:0; font-size: 0.8rem; color: #666;">Added: ${escapeHtml(m.date)}</p>
                    <a href="${sanitizedLink}" target="_blank" style="color: var(--navy); font-weight: bold;">View Magazine PDF</a>
                </div>
                ${isAdminMode() ? `<button class="btn-delete" onclick="deleteMag(${m.id})" style="background:none; border:none; color:red; cursor:pointer;"><i class="fas fa-trash"></i></button>` : ""}
            </div>
        `;
    })
    .join("");

  magazineList.innerHTML =
    content || '<p style="color:#555;">No magazine links yet.</p>';
}

function deleteMag(id) {
  if (!confirm("Delete this magazine link?")) return;
  const index = db.magazines.findIndex((m) => m.id === id);
  if (index >= 0) {
    db.magazines[index].status = "deleted";
    saveData();
    renderMagazines();
    showToast("Magazine link removed.");
  }
}

function addHistory() {
  const year = document.getElementById("histYear").value;
  const event = document.getElementById("histEvent").value;
  const imageInput = document.getElementById("histImage");
  const file = imageInput ? imageInput.files[0] : null;

  if (!year || !event) return showToast("Year and Event required", "error");

  if (file) {
    if (file.size > 1024 * 1024) {
      showToast("Image too large. Choose a file under 1MB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      saveHistoryEntry(year, event, e.target.result);
    };
    reader.readAsDataURL(file);
  } else {
    saveHistoryEntry(year, event, null);
  }
}

function saveHistoryEntry(year, event, imageData) {
  db.history.push({
    id: Date.now(),
    year: year,
    event: event,
    image: imageData,
    status: "active",
  });
  saveData();
  renderHistory();
  document.getElementById("histYear").value = "";
  document.getElementById("histEvent").value = "";
  if (document.getElementById("histImage"))
    document.getElementById("histImage").value = "";
  showToast("Historical Milestone Added!");
}

function renderHistory() {
  const timeline = document.getElementById("historyTimeline");
  if (!timeline) return;

  if (!window.initialHistoryHTML) {
    window.initialHistoryHTML = timeline.innerHTML;
  }

  const dynamicContent = db.history
    .filter((h) => h.status !== "deleted")
    .sort((a, b) => parseInt(a.year) - parseInt(b.year))
    .map((h) => {
      const imagePart = h.image
        ? `<div class="hist-img-container"><img src="${escapeHtml(h.image)}" class="hist-img"></div>`
        : "";
      const deleteBtn = isAdminMode()
        ? `<button onclick="deleteItem('history', ${h.id})" style="color:var(--red); background:none; border:none; cursor:pointer;"><i class="fas fa-trash"></i></button>`
        : "";
      return `
        <div class="history-card">
            <div class="history-content">
                ${imagePart}
                <div class="history-text-area">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h3>Year: ${escapeHtml(h.year)}</h3>
                        ${deleteBtn}
                    </div>
                    <p style="white-space:pre-wrap; line-height:1.6; color:#444;">${escapeHtml(h.event)}</p>
                </div>
            </div>
        </div>`;
    })
    .join("");

  timeline.innerHTML = window.initialHistoryHTML + dynamicContent;
}

function deleteItem(type, id) {
  if (!confirm("Archive this record?")) return;
  const item = db[type].find((i) => i.id === id);
  if (item) item.status = "deleted";
  saveData();
  renderAll();
}

function toggleMemberTable(type) {
  document.getElementById("activeContainer").style.display =
    type === "active" ? "block" : "none";
  document.getElementById("alumniContainer").style.display =
    type === "alumni" ? "block" : "none";
  document
    .getElementById("tabActive")
    .classList.toggle("active", type === "active");
  document
    .getElementById("tabAlumni")
    .classList.toggle("active", type === "alumni");
}

function showSection(id) {
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) target.classList.add("active");

  document.querySelectorAll("#mainNav ul li").forEach((li) => {
    li.classList.remove("active");
    if (li.innerText.toLowerCase().includes(id)) li.classList.add("active");
  });
}

function updateCounts() {
  const update = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  const membersList = db.members || [];
  const execList = db.executives || [];
  const financeList = db.finance || [];
  const magazinesList = db.magazines || [];

  update(
    "activeCount",
    membersList.filter((m) => m.level !== "Alumni" && m.status !== "deleted")
      .length,
  );
  update(
    "alumniCount",
    membersList.filter((m) => m.level === "Alumni" && m.status !== "deleted")
      .length,
  );
  update(
    "execCountDisplay",
    execList.filter((e) => e.status !== "deleted").length,
  );
  update(
    "magCountDisplay",
    magazinesList.filter((m) => m.status !== "deleted").length,
  );

  const total = financeList
    .filter((f) => f.status !== "deleted")
    .reduce((sum, f) => sum + (f.amount || 0), 0);
  update("totalFundsDisplay", `GH₵ ${total.toLocaleString()}`);
}

function renderAll() {
  renderMembers();
  renderFinance();
  renderExecutives();
  renderMagazines();
  renderHistory();
  updateCounts();
}

function exportBackup() {
  const dataStr =
    "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db));
  const link = document.createElement("a");
  link.setAttribute("href", dataStr);
  link.setAttribute("download", "PENSA_Backup.json");
  link.click();
}

function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported || typeof imported !== "object") {
        showToast("Invalid backup format", "error");
        return;
      }
      db.members = ensureArray(imported.members);
      db.executives = ensureArray(imported.executives);
      db.finance = ensureArray(imported.finance);
      db.history = ensureArray(imported.history);
      db.magazines = ensureArray(imported.magazines);
      saveData();
      renderAll();
      showToast("Backup restored successfully.", "success");
    } catch (err) {
      console.error("Import backup failed - script.js:994", err);
      showToast("Failed to read backup JSON.", "error");
    }
  };
  reader.readAsText(file);
}

function printMemberReport() {
  const activeTable = document.getElementById("activeTable").cloneNode(true);
  const rows = activeTable.querySelectorAll("tr");
  rows.forEach((row) => {
    if (row.lastElementChild) row.removeChild(row.lastElementChild);
  });

  const printWin = window.open("", "", "width=900,height=600");
  printWin.document.write(`
        <html>
            <head>
                <title>PENSA UMaT-SRID Member Report</title>
                <style>
                    body { font-family: sans-serif; padding: 40px; }
                    h1 { color: #1a237e; text-align: center; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    .footer { margin-top: 30px; font-size: 0.8rem; text-align: center; color: #666; }
                </style>
            </head>
            <body>
                <h1>PENSA UMaT-SRID</h1>
                <h3>Official Membership List - ${new Date().toLocaleDateString()}</h3>
                ${activeTable.outerHTML}
                <div class="footer">Generated via PENSA Digital Portal | © 2026</div>
            </body>
        </html>
    `);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => {
    printWin.print();
    printWin.close();
  }, 500);
}

// --- MERGED INITIALIZATION ---
// --- MERGED INITIALIZATION (MANUAL CONTROL VERSION) ---
function bootPortal() {
  initFirebase();
  // Start loading data from cloud immediately so it's ready when you enter
  loadData();

  // Timeout fallback so page doesn't hang if Firebase can't connect
  setTimeout(() => {
    if (!cloudDataLoaded) {
      console.warn(
        "Firebase load timed out; showing auth choice with local DB fallback.",
      );
      showToast(
        "Could not load cloud data. Proceeding with local copy.",
        "error",
      );
      showAuthChoice();
    }
  }, 8000);

  // Keep the splash visible briefly before showing access level choice
  const screen = document.getElementById("welcome-screen");
  setTimeout(() => {
    showAuthChoice();
    if (screen) {
      screen.style.opacity = "0";
      setTimeout(() => {
        screen.style.display = "none";
      }, 300);
    }
  }, 1300);

  // Professional amount formatting for finance fields
  setupCurrencyField("payAmount");
  setupCurrencyField("fAmount");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPortal);
} else {
  bootPortal();
}
