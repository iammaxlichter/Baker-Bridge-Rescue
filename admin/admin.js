const supabaseClient = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);

const sections = {
  login: document.getElementById("login-section"),
  mfaEnroll: document.getElementById("mfa-enroll-section"),
  mfaChallenge: document.getElementById("mfa-challenge-section"),
  dashboard: document.getElementById("dashboard-section"),
};
const globalError = document.getElementById("global-error");
const logoutBtn = document.getElementById("logout-btn");
const envBadge = document.getElementById("env-badge");
const welcomeMessage = document.getElementById("welcome-message");

let pendingEnrollFactorId = null;

(function setEnvBadge() {
  const env = (window.APP_CONFIG.ENV || "unknown").toLowerCase();
  envBadge.textContent = env.charAt(0).toUpperCase() + env.slice(1);
  envBadge.className = `env-badge env-${env}`;
})();

async function updateWelcomeMessage() {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) return;
  welcomeMessage.textContent = `Welcome, ${user.email}`;
  welcomeMessage.classList.remove("hidden");
}

function showSection(name) {
  Object.entries(sections).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
  logoutBtn.classList.toggle("hidden", name !== "dashboard");
}

function enterDashboard() {
  showSection("dashboard");
  loadProducts();
  loadMfaFactors();
  updateWelcomeMessage();
  startIdleTimer();
}

// --- Idle session timeout ---
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const REMEMBER_ME_KEY = "bbr_remember_me";
let idleTimer = null;

function isRememberMeEnabled() {
  return localStorage.getItem(REMEMBER_ME_KEY) === "true";
}

function startIdleTimer() {
  clearTimeout(idleTimer);
  if (isRememberMeEnabled()) return;
  idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
}

function clearIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

async function onIdleTimeout() {
  clearIdleTimer();
  localStorage.removeItem(REMEMBER_ME_KEY);
  await supabaseClient.auth.signOut();
  welcomeMessage.classList.add("hidden");
  showError("You were logged out after an hour of inactivity.");
  showSection("login");
}

["mousemove", "mousedown", "keydown", "touchstart", "scroll"].forEach((evt) => {
  window.addEventListener(
    evt,
    () => {
      if (!sections.dashboard.classList.contains("hidden")) {
        startIdleTimer();
      }
    },
    { passive: true }
  );
});

function showError(message) {
  if (!message) {
    globalError.classList.add("hidden");
    globalError.textContent = "";
    return;
  }
  globalError.textContent = message;
  globalError.classList.remove("hidden");
}

// --- Reusable confirm dialog ---
const confirmDialog = document.getElementById("confirm-dialog");
const confirmDialogTitle = document.getElementById("confirm-dialog-title");
const confirmDialogMessage = document.getElementById("confirm-dialog-message");
const confirmDialogCancelBtn = document.getElementById("confirm-dialog-cancel");
const confirmDialogConfirmBtn = document.getElementById("confirm-dialog-confirm");

function showConfirm({ title = "Are you sure?", message = "", confirmText = "Confirm", danger = false } = {}) {
  confirmDialogTitle.textContent = title;
  confirmDialogMessage.textContent = message;
  confirmDialogConfirmBtn.textContent = confirmText;
  confirmDialogConfirmBtn.classList.toggle("btn-danger", danger);
  confirmDialog.classList.remove("hidden");

  return new Promise((resolve) => {
    function onConfirm() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function cleanup(result) {
      confirmDialog.classList.add("hidden");
      confirmDialogConfirmBtn.removeEventListener("click", onConfirm);
      confirmDialogCancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    confirmDialogConfirmBtn.addEventListener("click", onConfirm);
    confirmDialogCancelBtn.addEventListener("click", onCancel);
  });
}

// --- Reusable toast notifications ---
const toastContainer = document.getElementById("toast-container");

function showToast(message, { type = "success", duration = 3000 } = {}) {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

async function init() {
  showError(null);
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showSection("login");
    return;
  }
  await checkMfaStatus();
}

async function checkMfaStatus() {
  const { data, error } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) {
    showError(error.message);
    showSection("login");
    return;
  }

  if (data.currentLevel === "aal2") {
    enterDashboard();
    return;
  }

  const { data: factorsData, error: factorsError } = await supabaseClient.auth.mfa.listFactors();
  if (factorsError) {
    showError(factorsError.message);
    showSection("login");
    return;
  }

  const verifiedTotp = factorsData.totp.find((f) => f.status === "verified");
  if (verifiedTotp) {
    showSection("mfaChallenge");
  } else {
    await startEnrollment();
  }
}

// --- Login ---
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(null);
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const rememberMe = document.getElementById("login-remember-me").checked;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showError(error.message);
    return;
  }
  localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
  await checkMfaStatus();
});

// --- MFA enrollment ---
function generateFactorName() {
  return `factor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function startEnrollment() {
  showError(null);
  const { data, error } = await supabaseClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: generateFactorName(),
  });
  if (error) {
    showError(error.message);
    showSection("login");
    return;
  }

  pendingEnrollFactorId = data.id;
  document.getElementById("mfa-qr").innerHTML = data.totp.qr_code;
  document.getElementById("mfa-secret-text").textContent = data.totp.secret;
  showSection("mfaEnroll");
}

document.getElementById("mfa-enroll-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(null);
  const code = document.getElementById("mfa-enroll-code").value.trim();

  const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({
    factorId: pendingEnrollFactorId,
  });
  if (challengeError) {
    showError(challengeError.message);
    return;
  }

  const { error: verifyError } = await supabaseClient.auth.mfa.verify({
    factorId: pendingEnrollFactorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) {
    showError(verifyError.message);
    return;
  }

  pendingEnrollFactorId = null;
  enterDashboard();
});

// --- MFA challenge (returning session) ---
document.getElementById("mfa-challenge-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(null);
  const code = document.getElementById("mfa-challenge-code").value.trim();

  const { data: factorsData, error: factorsError } = await supabaseClient.auth.mfa.listFactors();
  if (factorsError) {
    showError(factorsError.message);
    return;
  }
  const totpFactor = factorsData.totp.find((f) => f.status === "verified");
  if (!totpFactor) {
    showError("No verified authenticator found.");
    return;
  }

  const { error } = await supabaseClient.auth.mfa.challengeAndVerify({
    factorId: totpFactor.id,
    code,
  });
  if (error) {
    showError(error.message);
    return;
  }

  enterDashboard();
});

// --- Logout ---
logoutBtn.addEventListener("click", async () => {
  clearIdleTimer();
  localStorage.removeItem(REMEMBER_ME_KEY);
  await supabaseClient.auth.signOut();
  welcomeMessage.classList.add("hidden");
  showError(null);
  showSection("login");
});

// --- Products dashboard ---
const PAW_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="12" cy="16.2" rx="4.4" ry="3.9"/><ellipse cx="4.9" cy="10.6" rx="1.9" ry="2.5" transform="rotate(-22 4.9 10.6)"/><ellipse cx="9.3" cy="6.9" rx="2" ry="2.7" transform="rotate(-8 9.3 6.9)"/><ellipse cx="14.7" cy="6.9" rx="2" ry="2.7" transform="rotate(8 14.7 6.9)"/><ellipse cx="19.1" cy="10.6" rx="1.9" ry="2.5" transform="rotate(22 19.1 10.6)"/></svg>';

function emptyStateHTML(message) {
  return `<div class="empty-state">${PAW_SVG}<p>${message}</p></div>`;
}

const productsListEl = document.getElementById("products-list");
const saveLayoutBtn = document.getElementById("save-layout-btn");
const tabButtons = document.querySelectorAll(".tab-btn");
let currentProducts = [];
let sortableInstance = null;
let layoutDirty = false;
let activeTab = "shop";

function markLayoutDirty() {
  layoutDirty = true;
  saveLayoutBtn.disabled = false;
}

function markLayoutClean() {
  layoutDirty = false;
  saveLayoutBtn.disabled = true;
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (btn.dataset.tab === activeTab) return;

    const proceed = await confirmContinueWithUnsavedLayout();
    if (!proceed) return;

    activeTab = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    saveLayoutBtn.classList.toggle("hidden", activeTab !== "shop");
    markLayoutClean();
    renderProducts(currentProducts);
  });
});

async function loadProducts() {
  productsListEl.innerHTML = '<p class="muted">Loading products&hellip;</p>';

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    productsListEl.innerHTML = "";
    showError(error.message);
    return;
  }

  currentProducts = data;
  markLayoutClean();
  renderProducts(data);
}

function buildImageCarousel(images, altText) {
  const wrap = document.createElement("div");
  wrap.className = "product-card-image-wrap";

  const img = document.createElement("img");
  img.alt = altText || "";
  // Broken/missing images fade out to reveal the styled paw fallback behind
  img.addEventListener("error", () => img.classList.add("img-broken"));
  img.addEventListener("load", () => img.classList.remove("img-broken"));
  if (images[0]) {
    img.src = images[0];
  } else {
    img.classList.add("img-broken");
  }
  wrap.appendChild(img);

  if (images.length <= 1) {
    return wrap;
  }

  let currentIndex = 0;

  const dots = document.createElement("div");
  dots.className = "carousel-dots";
  images.forEach(() => {
    const dot = document.createElement("span");
    dot.className = "carousel-dot";
    dots.appendChild(dot);
  });

  function showImage(index) {
    currentIndex = (index + images.length) % images.length;
    img.src = images[currentIndex];
    Array.from(dots.children).forEach((dot, i) => {
      dot.classList.toggle("active", i === currentIndex);
    });
  }

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "carousel-arrow carousel-prev";
  prevBtn.setAttribute("aria-label", "Previous image");
  prevBtn.textContent = "‹";
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showImage(currentIndex - 1);
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "carousel-arrow carousel-next";
  nextBtn.setAttribute("aria-label", "Next image");
  nextBtn.textContent = "›";
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showImage(currentIndex + 1);
  });

  showImage(0);
  wrap.appendChild(prevBtn);
  wrap.appendChild(nextBtn);
  wrap.appendChild(dots);

  return wrap;
}

function renderProducts(products) {
  const filtered = products.filter((product) => (activeTab === "shop" ? product.active : !product.active));

  updateTabLabels(products);

  if (!filtered.length) {
    productsListEl.innerHTML = emptyStateHTML(
      activeTab === "shop" ? "No active products yet." : "No deactivated products."
    );
    if (sortableInstance) {
      sortableInstance.destroy();
      sortableInstance = null;
    }
    return;
  }

  productsListEl.innerHTML = "";
  filtered.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.dataset.id = product.id;

    if (activeTab === "shop") {
      const handle = document.createElement("div");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.textContent = "☰";
      card.appendChild(handle);
    }

    const images = [product.image_url, ...(product.image_urls || [])].filter(Boolean);
    card.appendChild(buildImageCarousel(images, product.name));

    const info = document.createElement("div");
    info.className = "product-info";
    info.innerHTML = `
      <div class="name">${escapeHtml(product.name)}</div>
      ${product.price != null ? `<div class="price">${formatPrice(product.price)}</div>` : ""}
      <span class="status-badge ${product.active ? "active" : "inactive"}">
        ${product.active ? "Active" : "Inactive"}
      </span>
      ${product.shop_url ? `<div><a href="${escapeAttr(product.shop_url)}" target="_blank" rel="noopener">Shop link</a></div>` : ""}
    `;
    card.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "product-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-secondary btn-small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openEditDrawer(product));
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn btn-secondary btn-small";
    toggleBtn.textContent = product.active ? "Deactivate" : "Activate";
    toggleBtn.addEventListener("click", () => toggleActive(product));
    actions.appendChild(toggleBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger btn-small";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteProduct(product));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    productsListEl.appendChild(card);
  });

  if (activeTab === "shop") {
    initSortable();
  } else if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
}

function updateTabLabels(products) {
  const activeCount = products.filter((p) => p.active).length;
  const inactiveCount = products.length - activeCount;
  document.getElementById("tab-shop-btn").textContent = `Shop (${activeCount})`;
  document.getElementById("tab-deactivated-btn").textContent = `Deactivated (${inactiveCount})`;
}

function initSortable() {
  if (sortableInstance) {
    sortableInstance.destroy();
  }
  sortableInstance = new Sortable(productsListEl, {
    handle: ".drag-handle",
    animation: 150,
    onEnd: markLayoutDirty,
  });
}

saveLayoutBtn.addEventListener("click", async () => {
  showError(null);
  saveLayoutBtn.disabled = true;

  const cards = Array.from(productsListEl.querySelectorAll(".product-card"));
  const updates = cards.map((card, index) => {
    const id = card.dataset.id;
    const sort_order = index + 1;
    const product = currentProducts.find((p) => p.id === id);
    if (product) product.sort_order = sort_order;
    return supabaseClient.from("products").update({ sort_order }).eq("id", id);
  });

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) {
    showError(failed.error.message);
    saveLayoutBtn.disabled = false;
    return;
  }

  markLayoutClean();
  showToast("Layout saved");
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || "").replace(/"/g, "&quot;");
}

function formatPrice(price) {
  return `$${Number(price).toFixed(2)}`;
}

function nextSortOrder() {
  if (!currentProducts.length) return 1;
  return Math.max(...currentProducts.map((p) => p.sort_order || 0)) + 1;
}

async function confirmContinueWithUnsavedLayout() {
  if (!layoutDirty) return true;
  return showConfirm({
    title: "Unsaved layout changes",
    message:
      "You've reordered products but haven't saved the layout yet. Continuing will discard that reordering. Continue anyway?",
    confirmText: "Continue anyway",
    danger: true,
  });
}

async function toggleActive(product) {
  const proceed = await confirmContinueWithUnsavedLayout();
  if (!proceed) return;

  showError(null);
  const newActive = !product.active;
  const { error } = await supabaseClient
    .from("products")
    .update({ active: newActive })
    .eq("id", product.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadProducts();
  showToast(`"${product.name}" ${newActive ? "activated" : "deactivated"}`);
}

async function deleteProduct(product) {
  const message = layoutDirty
    ? `Delete "${product.name}"? This cannot be undone. You also have an unsaved product order — deleting will discard it.`
    : `Delete "${product.name}"? This cannot be undone.`;

  const confirmed = await showConfirm({
    title: "Delete product?",
    message,
    confirmText: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  showError(null);
  const { error } = await supabaseClient.from("products").delete().eq("id", product.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadProducts();
  showToast(`"${product.name}" deleted`);
}

// --- Add / edit product drawer ---
const addProductDrawer = document.getElementById("add-product-drawer");
const addProductForm = document.getElementById("add-product-form");
const drawerTitle = document.getElementById("drawer-title");
const drawerSubmitBtn = document.getElementById("drawer-submit-btn");
const productIdInput = document.getElementById("product-id");
const additionalImagesList = document.getElementById("additional-images-list");

function addImageUrlRow(value = "") {
  const row = document.createElement("div");
  row.className = "image-url-row";

  const input = document.createElement("input");
  input.type = "url";
  input.className = "additional-image-input";
  input.placeholder = "https://...";
  input.value = value;
  row.appendChild(input);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-icon";
  removeBtn.setAttribute("aria-label", "Remove image");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());
  row.appendChild(removeBtn);

  additionalImagesList.appendChild(row);
}

document.getElementById("add-image-url-btn").addEventListener("click", () => addImageUrlRow());

// --- Image uploads (Supabase Storage) ---
const STORAGE_BUCKET = "product-images";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const imageFileInput = document.getElementById("image-file-input");
const uploadThumbnailBtn = document.getElementById("upload-thumbnail-btn");
const uploadImagesBtn = document.getElementById("upload-images-btn");
let uploadTarget = null;

uploadThumbnailBtn.addEventListener("click", () => {
  uploadTarget = "thumbnail";
  imageFileInput.multiple = false;
  imageFileInput.click();
});

uploadImagesBtn.addEventListener("click", () => {
  uploadTarget = "additional";
  imageFileInput.multiple = true;
  imageFileInput.click();
});

function setUploadingState(uploading) {
  uploadThumbnailBtn.disabled = uploading;
  uploadImagesBtn.disabled = uploading;
  uploadThumbnailBtn.textContent = uploading ? "Uploading…" : "Upload";
  uploadImagesBtn.textContent = uploading ? "Uploading…" : "Upload images";
}

imageFileInput.addEventListener("change", async () => {
  const files = Array.from(imageFileInput.files);
  imageFileInput.value = ""; // allow re-selecting the same file later
  if (!files.length) return;

  showError(null);
  setUploadingState(true);

  const uploaded = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      showError(`"${file.name}" is over 5 MB — please use a smaller image.`);
      continue;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file);
    if (error) {
      showError(error.message);
      continue;
    }
    const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    uploaded.push(data.publicUrl);
  }

  setUploadingState(false);
  if (!uploaded.length) return;

  if (uploadTarget === "thumbnail") {
    document.getElementById("product-image-url").value = uploaded[0];
  } else {
    uploaded.forEach((url) => addImageUrlRow(url));
  }
  showToast(`${uploaded.length} image${uploaded.length > 1 ? "s" : ""} uploaded`);
});

function openAddDrawer() {
  addProductForm.reset();
  productIdInput.value = "";
  additionalImagesList.innerHTML = "";
  drawerTitle.textContent = "Add product";
  drawerSubmitBtn.textContent = "Add product";
  addProductDrawer.classList.remove("hidden");
}

function openEditDrawer(product) {
  productIdInput.value = product.id;
  document.getElementById("product-name").value = product.name || "";
  document.getElementById("product-description").value = product.description || "";
  document.getElementById("product-price").value = product.price != null ? product.price : "";
  document.getElementById("product-image-url").value = product.image_url || "";
  document.getElementById("product-shop-url").value = product.shop_url || "";
  additionalImagesList.innerHTML = "";
  (product.image_urls || []).forEach((url) => addImageUrlRow(url));
  drawerTitle.textContent = "Edit product";
  drawerSubmitBtn.textContent = "Save changes";
  addProductDrawer.classList.remove("hidden");
}

function closeAddDrawer() {
  addProductDrawer.classList.add("hidden");
}

document.getElementById("open-add-drawer-btn").addEventListener("click", openAddDrawer);
document.getElementById("close-add-drawer-btn").addEventListener("click", closeAddDrawer);
document.getElementById("drawer-overlay").addEventListener("click", closeAddDrawer);

addProductForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const proceed = await confirmContinueWithUnsavedLayout();
  if (!proceed) return;

  showError(null);

  const id = productIdInput.value;
  const name = document.getElementById("product-name").value.trim();
  const description = document.getElementById("product-description").value.trim();
  const priceRaw = document.getElementById("product-price").value;
  const price = priceRaw === "" ? null : Number(priceRaw);
  const image_url = document.getElementById("product-image-url").value.trim();
  const shop_url = document.getElementById("product-shop-url").value.trim();
  const image_urls = Array.from(document.querySelectorAll(".additional-image-input"))
    .map((input) => input.value.trim())
    .filter((url) => url !== "");

  const payload = { name, description, price, image_url, shop_url, image_urls };

  const { error } = id
    ? await supabaseClient.from("products").update(payload).eq("id", id)
    : await supabaseClient.from("products").insert({
        ...payload,
        active: true,
        sort_order: nextSortOrder(),
      });

  if (error) {
    showError(error.message);
    return;
  }

  e.target.reset();
  additionalImagesList.innerHTML = "";
  closeAddDrawer();
  loadProducts();
  showToast(id ? "Product updated" : "Product added");
});

// --- MFA management (backup authenticators) ---
const mfaFactorsListEl = document.getElementById("mfa-factors-list");
const mfaAddDrawer = document.getElementById("mfa-add-drawer");
const mfaToggleBtn = document.getElementById("mfa-toggle-btn");
const mfaCollapsibleContent = document.getElementById("mfa-collapsible-content");
let pendingBackupFactorId = null;

mfaToggleBtn.addEventListener("click", () => {
  const nowHidden = mfaCollapsibleContent.classList.toggle("hidden");
  mfaToggleBtn.textContent = nowHidden ? "+" : "−";
  mfaToggleBtn.setAttribute("aria-expanded", String(!nowHidden));
});

async function loadMfaFactors() {
  mfaFactorsListEl.innerHTML = '<p class="muted">Loading&hellip;</p>';

  const { data, error } = await supabaseClient.auth.mfa.listFactors();
  if (error) {
    mfaFactorsListEl.innerHTML = "";
    showError(error.message);
    return;
  }

  renderMfaFactors(data.totp.filter((f) => f.status === "verified"));
}

function renderMfaFactors(factors) {
  if (!factors.length) {
    mfaFactorsListEl.innerHTML = emptyStateHTML("No authenticators enrolled.");
    return;
  }

  mfaFactorsListEl.innerHTML = "";
  factors.forEach((factor, index) => {
    const row = document.createElement("div");
    row.className = "mfa-factor-row";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "mfa-factor-name";
    name.textContent = `Authenticator ${index + 1}`;
    info.appendChild(name);

    const date = document.createElement("div");
    date.className = "mfa-factor-date";
    date.textContent = `Added ${new Date(factor.created_at).toLocaleDateString()}`;
    info.appendChild(date);

    row.appendChild(info);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-danger btn-small";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeMfaFactor(factor, factors.length));
    row.appendChild(removeBtn);

    mfaFactorsListEl.appendChild(row);
  });
}

async function removeMfaFactor(factor, totalCount) {
  const message =
    totalCount === 1
      ? "This is your only authenticator. Removing it means your account won't require 2FA to log in until you enroll a new one. Continue?"
      : "Remove this authenticator from your account?";

  const confirmed = await showConfirm({
    title: "Remove authenticator?",
    message,
    confirmText: "Remove",
    danger: true,
  });
  if (!confirmed) return;

  showError(null);
  const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: factor.id });
  if (error) {
    showError(error.message);
    return;
  }
  loadMfaFactors();
  showToast("Authenticator removed");
}

function closeMfaDrawer() {
  mfaAddDrawer.classList.add("hidden");
}

async function openMfaDrawer() {
  showError(null);
  const { data, error } = await supabaseClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: generateFactorName(),
  });
  if (error) {
    showError(error.message);
    return;
  }

  pendingBackupFactorId = data.id;
  document.getElementById("mfa-add-qr").innerHTML = data.totp.qr_code;
  document.getElementById("mfa-add-secret-text").textContent = data.totp.secret;
  mfaAddDrawer.classList.remove("hidden");
}

document.getElementById("open-mfa-drawer-btn").addEventListener("click", openMfaDrawer);
document.getElementById("close-mfa-drawer-btn").addEventListener("click", closeMfaDrawer);
document.getElementById("mfa-drawer-overlay").addEventListener("click", closeMfaDrawer);

document.getElementById("mfa-add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(null);
  const code = document.getElementById("mfa-add-code").value.trim();

  const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({
    factorId: pendingBackupFactorId,
  });
  if (challengeError) {
    showError(challengeError.message);
    return;
  }

  const { error: verifyError } = await supabaseClient.auth.mfa.verify({
    factorId: pendingBackupFactorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) {
    showError(verifyError.message);
    return;
  }

  pendingBackupFactorId = null;
  e.target.reset();
  closeMfaDrawer();
  loadMfaFactors();
  showToast("Backup authenticator added");
});

init();
