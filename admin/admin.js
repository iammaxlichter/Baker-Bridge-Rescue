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
const welcomeMessage = document.getElementById("welcome-message");

let pendingEnrollFactorId = null;

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
  loadGalleryPhotos();
  loadTestimonials();
  loadResources();
  loadHomeCards();
  loadMfaFactors();
  updateWelcomeMessage();
  startIdleTimer();
}

// Top-level dashboard tabs: show one .admin-panel at a time so the dashboard
// isn't one long scroll. Initial visibility is set in the HTML.
(function initAdminTabs() {
  const tabs = Array.from(document.querySelectorAll(".admin-tab"));
  const panels = Array.from(document.querySelectorAll(".admin-panel"));
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.panel;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== name));
    });
  });
})();

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
    // Shop and Home preview are both reorderable; Deactivated is not.
    saveLayoutBtn.classList.toggle("hidden", activeTab === "deactivated");
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

function byFeaturedOrder(a, b) {
  const av = a.featured_order == null ? Infinity : a.featured_order;
  const bv = b.featured_order == null ? Infinity : b.featured_order;
  return av - bv;
}

function renderProducts(products) {
  // shop = all active; home = active + featured (in featured_order); deactivated = inactive.
  let filtered;
  if (activeTab === "shop") {
    filtered = products.filter((p) => p.active);
  } else if (activeTab === "home") {
    filtered = products.filter((p) => p.active && p.featured).sort(byFeaturedOrder);
  } else {
    filtered = products.filter((p) => !p.active);
  }

  updateTabLabels(products);

  const reorderable = activeTab === "shop" || activeTab === "home";

  if (!filtered.length) {
    const emptyMsg =
      activeTab === "shop"
        ? "No active products yet."
        : activeTab === "home"
        ? "No products on the home preview yet. In the Shop tab, use a product's ☆ button to add it here."
        : "No deactivated products.";
    productsListEl.innerHTML = emptyStateHTML(emptyMsg);
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

    if (reorderable) {
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
      ${product.featured ? `<span class="status-badge featured">On home</span>` : ""}
      ${product.shop_url ? `<div><a href="${escapeAttr(product.shop_url)}" target="_blank" rel="noopener">Shop link</a></div>` : ""}
    `;
    card.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "product-actions";

    if (activeTab === "home") {
      // The Home preview tab is just about which products show and their order.
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-secondary btn-small";
      removeBtn.textContent = "Remove from home";
      removeBtn.addEventListener("click", () => setFeatured(product, false));
      actions.appendChild(removeBtn);
    } else {
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary btn-small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openEditDrawer(product));
      actions.appendChild(editBtn);

      if (product.active) {
        const featBtn = document.createElement("button");
        featBtn.className = "btn btn-secondary btn-small";
        featBtn.textContent = product.featured ? "★ On home" : "☆ Add to home";
        featBtn.title = product.featured
          ? "Remove from the home page preview"
          : "Show on the home page preview";
        featBtn.addEventListener("click", () => setFeatured(product, !product.featured));
        actions.appendChild(featBtn);
      }

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
    }

    card.appendChild(actions);
    productsListEl.appendChild(card);
  });

  if (reorderable) {
    initSortable();
  } else if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
}

function updateTabLabels(products) {
  const activeCount = products.filter((p) => p.active).length;
  const inactiveCount = products.length - activeCount;
  const homeCount = products.filter((p) => p.active && p.featured).length;
  document.getElementById("tab-shop-btn").textContent = `Shop (${activeCount})`;
  document.getElementById("tab-home-btn").textContent = `Home preview (${homeCount})`;
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

  // Home preview writes featured_order; the shop writes sort_order.
  const field = activeTab === "home" ? "featured_order" : "sort_order";
  const cards = Array.from(productsListEl.querySelectorAll(".product-card"));
  const updates = cards.map((card, index) => {
    const id = card.dataset.id;
    const value = index + 1;
    const product = currentProducts.find((p) => p.id === id);
    if (product) product[field] = value;
    return supabaseClient.from("products").update({ [field]: value }).eq("id", id);
  });

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) {
    showError(failed.error.message);
    saveLayoutBtn.disabled = false;
    return;
  }

  markLayoutClean();
  showToast(activeTab === "home" ? "Home preview order saved" : "Layout saved");
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
  // Pulling a product off the shop also pulls it off the home preview.
  const payload = newActive ? { active: true } : { active: false, featured: false, featured_order: null };
  const { error } = await supabaseClient
    .from("products")
    .update(payload)
    .eq("id", product.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadProducts();
  showToast(`"${product.name}" ${newActive ? "activated" : "deactivated"}`);
}

function nextFeaturedOrder() {
  const featured = currentProducts.filter((p) => p.featured && p.featured_order != null);
  if (!featured.length) return 1;
  return Math.max(...featured.map((p) => p.featured_order || 0)) + 1;
}

// Add or remove a product from the home-page preview. Persists immediately.
async function setFeatured(product, makeFeatured) {
  const proceed = await confirmContinueWithUnsavedLayout();
  if (!proceed) return;

  showError(null);
  const payload = makeFeatured
    ? { featured: true, featured_order: nextFeaturedOrder() }
    : { featured: false, featured_order: null };
  const { error } = await supabaseClient.from("products").update(payload).eq("id", product.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadProducts();
  showToast(
    makeFeatured
      ? `"${product.name}" added to the home preview`
      : `"${product.name}" removed from the home preview`
  );
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

// ===========================================================================
// Gallery photos
//
// Three drop zones — "new" (the sanctuary today), "old" (the rescue that was),
// and "hidden" — backed by one table. A photo's zone is derived from its row:
// inactive photos live in "hidden", everything else sits in its category.
// Dragging is purely local; nothing is written until "Save layout" is pressed,
// which then sends one update per row that actually changed.
// ===========================================================================

const GALLERY_COLS = 3;
const GALLERY_ZONES = [
  { key: "new", label: "The sanctuary today", columns: GALLERY_COLS },
  { key: "old", label: "The rescue years", columns: GALLERY_COLS },
  { key: "hidden", label: "Hidden", columns: 1 },
];

const saveGalleryBtn = document.getElementById("save-gallery-btn");

// One drag list per (zone, column). Visible zones have GALLERY_COLS columns
// that mirror the public gallery; "hidden" is a single bucket.
const galleryLists = [];
GALLERY_ZONES.forEach((zone) => {
  for (let col = 0; col < zone.columns; col++) {
    const id = zone.columns === 1 ? `gallery-list-${zone.key}` : `gallery-list-${zone.key}-${col}`;
    const el = document.getElementById(id);
    if (el) galleryLists.push({ zone: zone.key, col, el });
  }
});
let currentPhotos = [];
let gallerySortables = [];
let galleryDirty = false;

function zoneOf(photo) {
  return photo.active ? photo.category : "hidden";
}

function colOf(photo, zoneKey) {
  if (zoneKey === "hidden") return 0;
  const c = parseInt(photo.column_index, 10);
  return isNaN(c) ? 0 : Math.max(0, Math.min(GALLERY_COLS - 1, c));
}

function bySortOrder(a, b) {
  return (a.sort_order || 0) - (b.sort_order || 0);
}

function zoneLabel(key) {
  const zone = GALLERY_ZONES.find((z) => z.key === key);
  return zone ? zone.label : key;
}

function markGalleryDirty() {
  galleryDirty = true;
  saveGalleryBtn.disabled = false;
}

function markGalleryClean() {
  galleryDirty = false;
  saveGalleryBtn.disabled = true;
}

async function confirmContinueWithUnsavedGallery() {
  if (!galleryDirty) return true;
  return showConfirm({
    title: "Unsaved gallery changes",
    message:
      "You've moved photos around but haven't saved the layout yet. Continuing will discard those moves. Continue anyway?",
    confirmText: "Continue anyway",
    danger: true,
  });
}

async function loadGalleryPhotos() {
  galleryLists.forEach(({ el }) => {
    el.innerHTML = '<p class="muted">Loading photos&hellip;</p>';
  });

  const { data, error } = await supabaseClient
    .from("gallery_photos")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    galleryLists.forEach(({ el }) => (el.innerHTML = ""));
    showError(error.message);
    return;
  }

  currentPhotos = data;
  markGalleryClean();
  renderGallery();
}

function renderGallery() {
  // Fill every (zone, column) list from the stored column + position, so what
  // shows here matches the public page and survives a save.
  galleryLists.forEach(({ zone, col, el }) => {
    const photos = currentPhotos
      .filter((p) => zoneOf(p) === zone && colOf(p, zone) === col)
      .sort(bySortOrder);
    el.innerHTML = "";
    photos.forEach((photo) => el.appendChild(photoCard(photo)));
    if (zone === "hidden" && !photos.length) el.appendChild(galleryPlaceholder("hidden"));
  });

  // Zone counts add up every column in the zone.
  GALLERY_ZONES.forEach(({ key }) => {
    const count = currentPhotos.filter((p) => zoneOf(p) === key).length;
    document.getElementById(`gallery-count-${key}`).textContent = count;
  });

  initGallerySortables();
}

function galleryPlaceholder(zoneKey) {
  const el = document.createElement("p");
  el.className = "gallery-empty";
  el.textContent =
    zoneKey === "hidden" ? "No hidden photos." : "No photos here yet — drag one in, or add photos above.";
  return el;
}

function photoCard(photo) {
  const card = document.createElement("div");
  card.className = "photo-card";
  card.dataset.id = photo.id;

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.title = "Drag to reorder or move between groups";
  handle.textContent = "☰";
  card.appendChild(handle);

  const wrap = document.createElement("div");
  wrap.className = "photo-card-image-wrap";
  const img = document.createElement("img");
  img.alt = photo.alt_text || "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.classList.add("img-broken"));
  img.addEventListener("load", () => img.classList.remove("img-broken"));
  img.src = resolvePhotoSrc(photo.image_url);
  wrap.appendChild(img);
  card.appendChild(wrap);

  const info = document.createElement("div");
  info.className = "photo-info";
  info.innerHTML = `
    <div class="photo-alt">${escapeHtml(photo.alt_text) || '<span class="photo-alt-missing">No alt text</span>'}</div>
    ${photo.caption ? `<div class="photo-caption">${escapeHtml(photo.caption)}</div>` : ""}
  `;
  card.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "photo-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-secondary btn-small";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditPhotoDrawer(photo));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger btn-small";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => deletePhoto(photo));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

/* Seeded photos are stored as site-relative paths ("assets/photos/x.jpg").
   The admin lives one folder down, so those need a "../" to preview here. */
function resolvePhotoSrc(url) {
  if (!url) return "";
  return /^(https?:)?\/\//i.test(url) || url.startsWith("/") ? url : `../${url}`;
}

/* Keeps each zone's count and its "nothing here" placeholder in step with the
   cards actually sitting in it, without a full re-render mid-drag. */
function refreshGalleryZones() {
  GALLERY_ZONES.forEach(({ key, columns }) => {
    let count = 0;
    for (let col = 0; col < columns; col++) {
      const entry = galleryLists.find((l) => l.zone === key && l.col === col);
      if (entry) count += entry.el.querySelectorAll(".photo-card").length;
    }
    document.getElementById(`gallery-count-${key}`).textContent = count;
  });

  // Only the hidden bucket shows a "nothing here" placeholder; empty columns
  // in the visible zones read as droppable space instead.
  const hidden = galleryLists.find((l) => l.zone === "hidden");
  if (hidden) {
    const count = hidden.el.querySelectorAll(".photo-card").length;
    const placeholder = hidden.el.querySelector(".gallery-empty");
    if (count && placeholder) placeholder.remove();
    if (!count && !placeholder) hidden.el.appendChild(galleryPlaceholder("hidden"));
  }
}

function initGallerySortables() {
  gallerySortables.forEach((s) => s.destroy());
  gallerySortables = galleryLists.map(({ el }) =>
    new Sortable(el, {
      group: "bbr-gallery",
      draggable: ".photo-card",
      // Grab anywhere on the card except the action buttons — no tiny handle.
      filter: ".photo-actions, .gallery-empty",
      preventOnFilter: false,
      // Pointer-based dragging with the ghost rendered on <body>. This avoids
      // the native HTML5 drag (which fights the <img> elements) and the ghost
      // being clipped by the cards' overflow:hidden, which made cross-column
      // drops unreliable.
      forceFallback: true,
      fallbackOnBody: true,
      swapThreshold: 0.6,
      animation: 150,
      onEnd: () => {
        markGalleryDirty();
        refreshGalleryZones();
      },
    })
  );
}

saveGalleryBtn.addEventListener("click", async () => {
  showError(null);
  saveGalleryBtn.disabled = true;

  const changed = [];
  galleryLists.forEach(({ zone, col, el }) => {
    const cards = Array.from(el.querySelectorAll(".photo-card"));
    cards.forEach((card, index) => {
      const photo = currentPhotos.find((p) => p.id === card.dataset.id);
      if (!photo) return;

      // The photo's currently-stored column, normalized to 0..COLS-1.
      const curCol = Math.max(0, Math.min(GALLERY_COLS - 1, parseInt(photo.column_index, 10) || 0));

      const next = {
        sort_order: index,
        active: zone !== "hidden",
        // A hidden photo keeps the group and column it came from, so unhiding
        // drops it back where it was.
        category: zone === "hidden" ? photo.category : zone,
        column_index: zone === "hidden" ? curCol : col,
      };

      if (
        next.sort_order !== photo.sort_order ||
        next.active !== photo.active ||
        next.category !== photo.category ||
        next.column_index !== curCol
      ) {
        changed.push({ photo, next });
      }
    });
  });

  if (!changed.length) {
    markGalleryClean();
    showToast("Nothing to save");
    return;
  }

  const results = await Promise.all(
    changed.map(({ photo, next }) => supabaseClient.from("gallery_photos").update(next).eq("id", photo.id))
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    showError(failed.error.message);
    saveGalleryBtn.disabled = false;
    return;
  }

  changed.forEach(({ photo, next }) => Object.assign(photo, next));
  markGalleryClean();
  renderGallery();
  showToast(`Gallery layout saved (${changed.length} photo${changed.length > 1 ? "s" : ""} updated)`);
});

async function deletePhoto(photo) {
  const message = galleryDirty
    ? "Delete this photo? This cannot be undone. You also have unsaved gallery moves — deleting will discard them."
    : "Delete this photo? This cannot be undone.";

  const confirmed = await showConfirm({
    title: "Delete photo?",
    message,
    confirmText: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  showError(null);
  const { error } = await supabaseClient.from("gallery_photos").delete().eq("id", photo.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadGalleryPhotos();
  showToast("Photo deleted");
}

// --- Add / edit photo drawer ---
const photoDrawer = document.getElementById("photo-drawer");
const photoForm = document.getElementById("photo-form");
const photoDrawerTitle = document.getElementById("photo-drawer-title");
const photoSubmitBtn = document.getElementById("photo-submit-btn");
const photoIdInput = document.getElementById("photo-id");
const photoCategorySelect = document.getElementById("photo-category");
const photoRowsEl = document.getElementById("photo-rows");
const photoAddActions = document.getElementById("photo-add-actions");

function addPhotoRow({ url = "", alt = "", caption = "", removable = true } = {}) {
  const row = document.createElement("div");
  row.className = "photo-row";

  const preview = document.createElement("img");
  preview.className = "photo-row-preview";
  preview.alt = "";
  preview.addEventListener("error", () => preview.classList.add("img-broken"));
  preview.addEventListener("load", () => preview.classList.remove("img-broken"));

  const fields = document.createElement("div");
  fields.className = "photo-row-fields";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "photo-row-url";
  urlInput.placeholder = "https://... or assets/photos/name.jpg";
  urlInput.value = url;
  const syncPreview = () => {
    const value = urlInput.value.trim();
    if (value) {
      preview.src = resolvePhotoSrc(value);
    } else {
      preview.removeAttribute("src");
      preview.classList.add("img-broken");
    }
  };
  urlInput.addEventListener("change", syncPreview);
  fields.appendChild(urlInput);

  const altInput = document.createElement("input");
  altInput.type = "text";
  altInput.className = "photo-row-alt";
  altInput.placeholder = "Alt text — describe the photo for screen readers";
  altInput.value = alt;
  fields.appendChild(altInput);

  const captionInput = document.createElement("input");
  captionInput.type = "text";
  captionInput.className = "photo-row-caption";
  captionInput.placeholder = "Caption (optional) — shows under the photo";
  captionInput.value = caption;
  fields.appendChild(captionInput);

  row.appendChild(preview);
  row.appendChild(fields);

  if (removable) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-icon";
    removeBtn.setAttribute("aria-label", "Remove photo");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => row.remove());
    row.appendChild(removeBtn);
  }

  photoRowsEl.appendChild(row);
  syncPreview();
  return row;
}

document.getElementById("add-photo-url-btn").addEventListener("click", () => addPhotoRow());

// --- Photo uploads (Supabase Storage) ---
const GALLERY_BUCKET = "gallery-images";
const photoFileInput = document.getElementById("photo-file-input");
const uploadPhotosBtn = document.getElementById("upload-photos-btn");

uploadPhotosBtn.addEventListener("click", () => {
  // In edit mode there is exactly one photo, so replace its file rather than add
  photoFileInput.multiple = !photoIdInput.value;
  photoFileInput.click();
});

photoFileInput.addEventListener("change", async () => {
  const files = Array.from(photoFileInput.files);
  photoFileInput.value = "";
  if (!files.length) return;

  showError(null);
  uploadPhotosBtn.disabled = true;
  uploadPhotosBtn.textContent = "Uploading…";

  const uploaded = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      showError(`"${file.name}" is over 5 MB — please use a smaller image.`);
      continue;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabaseClient.storage.from(GALLERY_BUCKET).upload(path, file);
    if (error) {
      showError(error.message);
      continue;
    }
    const { data } = supabaseClient.storage.from(GALLERY_BUCKET).getPublicUrl(path);
    uploaded.push(data.publicUrl);
  }

  uploadPhotosBtn.disabled = false;
  uploadPhotosBtn.textContent = "Upload photos";
  if (!uploaded.length) return;

  if (photoIdInput.value) {
    const urlInput = photoRowsEl.querySelector(".photo-row-url");
    urlInput.value = uploaded[0];
    urlInput.dispatchEvent(new Event("change"));
  } else {
    uploaded.forEach((url) => addPhotoRow({ url }));
  }
  showToast(`${uploaded.length} photo${uploaded.length > 1 ? "s" : ""} uploaded`);
});

function openAddPhotoDrawer() {
  photoForm.reset();
  photoIdInput.value = "";
  photoRowsEl.innerHTML = "";
  photoCategorySelect.value = "new";
  photoAddActions.classList.remove("hidden");
  addPhotoRow();
  photoDrawerTitle.textContent = "Add photos";
  photoSubmitBtn.textContent = "Add photos";
  photoDrawer.classList.remove("hidden");
}

function openEditPhotoDrawer(photo) {
  photoIdInput.value = photo.id;
  photoRowsEl.innerHTML = "";
  photoCategorySelect.value = photo.category;
  photoAddActions.classList.remove("hidden");
  addPhotoRow({
    url: photo.image_url,
    alt: photo.alt_text || "",
    caption: photo.caption || "",
    removable: false,
  });
  document.getElementById("add-photo-url-btn").classList.add("hidden");
  photoDrawerTitle.textContent = "Edit photo";
  photoSubmitBtn.textContent = "Save changes";
  photoDrawer.classList.remove("hidden");
}

function closePhotoDrawer() {
  photoDrawer.classList.add("hidden");
  document.getElementById("add-photo-url-btn").classList.remove("hidden");
}

document.getElementById("open-photo-drawer-btn").addEventListener("click", openAddPhotoDrawer);
document.getElementById("close-photo-drawer-btn").addEventListener("click", closePhotoDrawer);
document.getElementById("photo-drawer-overlay").addEventListener("click", closePhotoDrawer);

// New photos drop into the shortest column of their category so the layout
// stays roughly balanced; they can be dragged anywhere afterward.
function nextGallerySlot(category) {
  const counts = new Array(GALLERY_COLS).fill(0);
  currentPhotos
    .filter((p) => p.active && p.category === category)
    .forEach((p) => {
      counts[colOf(p, category)]++;
    });
  let col = 0;
  for (let i = 1; i < GALLERY_COLS; i++) if (counts[i] < counts[col]) col = i;
  return { column_index: col, sort_order: counts[col] };
}

photoForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const proceed = await confirmContinueWithUnsavedGallery();
  if (!proceed) return;

  showError(null);

  const id = photoIdInput.value;
  const category = photoCategorySelect.value;
  const rows = Array.from(photoRowsEl.querySelectorAll(".photo-row"))
    .map((row) => ({
      image_url: row.querySelector(".photo-row-url").value.trim(),
      alt_text: row.querySelector(".photo-row-alt").value.trim() || null,
      caption: row.querySelector(".photo-row-caption").value.trim() || null,
    }))
    .filter((row) => row.image_url !== "");

  if (!rows.length) {
    showError("Add at least one image URL or upload a photo.");
    return;
  }

  let error;
  if (id) {
    ({ error } = await supabaseClient
      .from("gallery_photos")
      .update({ ...rows[0], category })
      .eq("id", id));
  } else {
    const slot = nextGallerySlot(category);
    let order = slot.sort_order;
    ({ error } = await supabaseClient.from("gallery_photos").insert(
      rows.map((row) => ({
        ...row,
        category,
        active: true,
        column_index: slot.column_index,
        sort_order: order++,
      }))
    ));
  }

  if (error) {
    showError(error.message);
    return;
  }

  closePhotoDrawer();
  loadGalleryPhotos();
  showToast(
    id ? "Photo updated" : `${rows.length} photo${rows.length > 1 ? "s" : ""} added to ${zoneLabel(category)}`
  );
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

// ===========================================================================
// Testimonials — the "Happy endings" videos on the home page
// One flat, drag-reorderable list backed by the testimonials table.
// ===========================================================================
const saveTestiBtn = document.getElementById("save-testi-btn");
const testiListEl = document.getElementById("testi-list");
let currentTestimonials = [];
let testiSortable = null;
let testiDirty = false;

function markTestiDirty() {
  testiDirty = true;
  saveTestiBtn.disabled = false;
}

function markTestiClean() {
  testiDirty = false;
  saveTestiBtn.disabled = true;
}

async function confirmContinueWithUnsavedTesti() {
  if (!testiDirty) return true;
  return showConfirm({
    title: "Unsaved video order",
    message:
      "You've reordered the videos but haven't saved yet. Continuing will discard that reordering. Continue anyway?",
    confirmText: "Continue anyway",
    danger: true,
  });
}

function testiYoutubeId(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,})/);
  return m ? m[1] : "";
}

async function loadTestimonials() {
  testiListEl.innerHTML = '<p class="muted">Loading videos&hellip;</p>';

  const { data, error } = await supabaseClient
    .from("testimonials")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    testiListEl.innerHTML = "";
    showError(error.message);
    return;
  }

  currentTestimonials = data;
  markTestiClean();
  renderTestimonials();
}

function renderTestimonials() {
  if (!currentTestimonials.length) {
    testiListEl.innerHTML = emptyStateHTML('No videos yet. Add one with "+ Add video".');
    if (testiSortable) {
      testiSortable.destroy();
      testiSortable = null;
    }
    return;
  }

  testiListEl.innerHTML = "";
  currentTestimonials.forEach((t) => testiListEl.appendChild(testiCard(t)));
  initTestiSortable();
}

function testiCard(t) {
  const card = document.createElement("div");
  card.className = "photo-card";
  card.dataset.id = t.id;

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.title = "Drag to reorder";
  handle.textContent = "☰";
  card.appendChild(handle);

  const wrap = document.createElement("div");
  wrap.className = "photo-card-image-wrap";
  const img = document.createElement("img");
  img.alt = t.name || "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.classList.add("img-broken"));
  img.addEventListener("load", () => img.classList.remove("img-broken"));
  const vid = testiYoutubeId(t.youtube_url);
  if (vid) img.src = `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
  else img.classList.add("img-broken");
  wrap.appendChild(img);
  card.appendChild(wrap);

  const info = document.createElement("div");
  info.className = "photo-info";
  info.innerHTML = `
    <div class="photo-alt">${escapeHtml(t.name)}</div>
    ${t.description ? `<div class="photo-caption">${escapeHtml(t.description)}</div>` : ""}
  `;
  card.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "photo-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-secondary btn-small";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditTestiDrawer(t));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger btn-small";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => deleteTestimonial(t));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

function initTestiSortable() {
  if (testiSortable) testiSortable.destroy();
  testiSortable = new Sortable(testiListEl, {
    handle: ".drag-handle",
    animation: 150,
    onEnd: markTestiDirty,
  });
}

saveTestiBtn.addEventListener("click", async () => {
  showError(null);
  saveTestiBtn.disabled = true;

  const cards = Array.from(testiListEl.querySelectorAll(".photo-card"));
  const updates = cards.map((card, index) => {
    const id = card.dataset.id;
    const sort_order = index + 1;
    const t = currentTestimonials.find((x) => x.id === id);
    if (t) t.sort_order = sort_order;
    return supabaseClient.from("testimonials").update({ sort_order }).eq("id", id);
  });

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) {
    showError(failed.error.message);
    saveTestiBtn.disabled = false;
    return;
  }

  markTestiClean();
  showToast("Video order saved");
});

async function deleteTestimonial(t) {
  const proceed = await confirmContinueWithUnsavedTesti();
  if (!proceed) return;

  const confirmed = await showConfirm({
    title: "Delete video?",
    message: `Delete "${t.name}"? This cannot be undone.`,
    confirmText: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  showError(null);
  const { error } = await supabaseClient.from("testimonials").delete().eq("id", t.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadTestimonials();
  showToast("Video deleted");
}

// --- Add / edit testimonial drawer ---
const testiDrawer = document.getElementById("testi-drawer");
const testiForm = document.getElementById("testi-form");
const testiDrawerTitle = document.getElementById("testi-drawer-title");
const testiSubmitBtn = document.getElementById("testi-submit-btn");
const testiIdInput = document.getElementById("testi-id");

function nextTestiSortOrder() {
  if (!currentTestimonials.length) return 1;
  return Math.max(...currentTestimonials.map((t) => t.sort_order || 0)) + 1;
}

function openAddTestiDrawer() {
  testiForm.reset();
  testiIdInput.value = "";
  testiDrawerTitle.textContent = "Add video";
  testiSubmitBtn.textContent = "Add video";
  testiDrawer.classList.remove("hidden");
}

function openEditTestiDrawer(t) {
  testiIdInput.value = t.id;
  document.getElementById("testi-name").value = t.name || "";
  document.getElementById("testi-url").value = t.youtube_url || "";
  document.getElementById("testi-desc").value = t.description || "";
  testiDrawerTitle.textContent = "Edit video";
  testiSubmitBtn.textContent = "Save changes";
  testiDrawer.classList.remove("hidden");
}

function closeTestiDrawer() {
  testiDrawer.classList.add("hidden");
}

document.getElementById("open-testi-drawer-btn").addEventListener("click", openAddTestiDrawer);
document.getElementById("close-testi-drawer-btn").addEventListener("click", closeTestiDrawer);
document.getElementById("testi-drawer-overlay").addEventListener("click", closeTestiDrawer);

testiForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const proceed = await confirmContinueWithUnsavedTesti();
  if (!proceed) return;

  showError(null);
  const id = testiIdInput.value;
  const name = document.getElementById("testi-name").value.trim();
  const youtube_url = document.getElementById("testi-url").value.trim();
  const description = document.getElementById("testi-desc").value.trim() || null;

  if (!name || !youtube_url) {
    showError("Name and YouTube link are required.");
    return;
  }

  const payload = { name, youtube_url, description };
  const { error } = id
    ? await supabaseClient.from("testimonials").update(payload).eq("id", id)
    : await supabaseClient
        .from("testimonials")
        .insert({ ...payload, active: true, sort_order: nextTestiSortOrder() });

  if (error) {
    showError(error.message);
    return;
  }

  closeTestiDrawer();
  loadTestimonials();
  showToast(id ? "Video updated" : "Video added");
});

// ===========================================================================
// Resources — the link lists on the Resources page
// Four groups, each a drag-reorderable list; drag an item into another group
// to recategorize it. Nothing is written until "Save layout".
// ===========================================================================
const RESOURCE_GROUPS = [
  { key: "emergency", label: "Emergency and medical help for pet families" },
  { key: "shelters", label: "Grants for shelters and rescues" },
  { key: "foster", label: "Foster support" },
  { key: "community", label: "Community based support" },
];

const saveResourcesBtn = document.getElementById("save-resources-btn");
const resourceLists = RESOURCE_GROUPS.map((g) => ({
  key: g.key,
  el: document.getElementById(`resource-list-${g.key}`),
})).filter((l) => l.el);
let currentResources = [];
let resourceSortables = [];
let resourcesDirty = false;

function markResourcesDirty() {
  resourcesDirty = true;
  saveResourcesBtn.disabled = false;
}

function markResourcesClean() {
  resourcesDirty = false;
  saveResourcesBtn.disabled = true;
}

async function confirmContinueWithUnsavedResources() {
  if (!resourcesDirty) return true;
  return showConfirm({
    title: "Unsaved resource order",
    message:
      "You've moved resources around but haven't saved yet. Continuing will discard those moves. Continue anyway?",
    confirmText: "Continue anyway",
    danger: true,
  });
}

// Fall back to the first group if a row's category isn't one we know.
function resourceCategory(r) {
  return RESOURCE_GROUPS.some((g) => g.key === r.category) ? r.category : RESOURCE_GROUPS[0].key;
}

async function loadResources() {
  resourceLists.forEach(({ el }) => {
    el.innerHTML = '<p class="muted">Loading&hellip;</p>';
  });

  const { data, error } = await supabaseClient
    .from("resources")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    resourceLists.forEach(({ el }) => (el.innerHTML = ""));
    showError(error.message);
    return;
  }

  currentResources = data;
  markResourcesClean();
  renderResources();
}

function renderResources() {
  resourceLists.forEach(({ key, el }) => {
    const items = currentResources
      .filter((r) => resourceCategory(r) === key)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    el.innerHTML = "";
    items.forEach((r) => el.appendChild(resourceCard(r)));
    document.getElementById(`resource-count-${key}`).textContent = items.length;
  });
  initResourceSortables();
}

function resourceCard(r) {
  const card = document.createElement("div");
  card.className = "res-admin-item";
  card.dataset.id = r.id;

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.title = "Drag to reorder or move between groups";
  handle.textContent = "☰";
  card.appendChild(handle);

  const info = document.createElement("div");
  info.className = "res-admin-info";
  info.innerHTML = `
    <div class="res-admin-name">${escapeHtml(r.name)}</div>
    ${r.url ? `<a class="res-admin-link" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>` : ""}
    ${r.description ? `<div class="res-admin-desc">${escapeHtml(r.description)}</div>` : ""}
  `;
  card.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "res-admin-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-secondary btn-small";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditResourceDrawer(r));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger btn-small";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => deleteResource(r));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

function refreshResourceCounts() {
  resourceLists.forEach(({ key, el }) => {
    document.getElementById(`resource-count-${key}`).textContent =
      el.querySelectorAll(".res-admin-item").length;
  });
}

function initResourceSortables() {
  resourceSortables.forEach((s) => s.destroy());
  resourceSortables = resourceLists.map(({ el }) =>
    new Sortable(el, {
      group: "bbr-resources",
      draggable: ".res-admin-item",
      filter: ".res-admin-actions",
      preventOnFilter: false,
      forceFallback: true,
      fallbackOnBody: true,
      swapThreshold: 0.6,
      animation: 150,
      onEnd: () => {
        markResourcesDirty();
        refreshResourceCounts();
      },
    })
  );
}

saveResourcesBtn.addEventListener("click", async () => {
  showError(null);
  saveResourcesBtn.disabled = true;

  const changed = [];
  resourceLists.forEach(({ key, el }) => {
    Array.from(el.querySelectorAll(".res-admin-item")).forEach((card, index) => {
      const r = currentResources.find((x) => x.id === card.dataset.id);
      if (!r) return;
      const next = { category: key, sort_order: index + 1 };
      if (next.category !== r.category || next.sort_order !== r.sort_order) {
        changed.push({ r, next });
      }
    });
  });

  if (!changed.length) {
    markResourcesClean();
    showToast("Nothing to save");
    return;
  }

  const results = await Promise.all(
    changed.map(({ r, next }) => supabaseClient.from("resources").update(next).eq("id", r.id))
  );
  const failed = results.find((x) => x.error);
  if (failed) {
    showError(failed.error.message);
    saveResourcesBtn.disabled = false;
    return;
  }

  changed.forEach(({ r, next }) => Object.assign(r, next));
  markResourcesClean();
  renderResources();
  showToast(`Resources saved (${changed.length} updated)`);
});

async function deleteResource(r) {
  const proceed = await confirmContinueWithUnsavedResources();
  if (!proceed) return;

  const confirmed = await showConfirm({
    title: "Delete resource?",
    message: `Delete "${r.name}"? This cannot be undone.`,
    confirmText: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  showError(null);
  const { error } = await supabaseClient.from("resources").delete().eq("id", r.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadResources();
  showToast("Resource deleted");
}

// --- Add / edit resource drawer ---
const resourceDrawer = document.getElementById("resource-drawer");
const resourceForm = document.getElementById("resource-form");
const resourceDrawerTitle = document.getElementById("resource-drawer-title");
const resourceSubmitBtn = document.getElementById("resource-submit-btn");
const resourceIdInput = document.getElementById("resource-id");
const resourceGroupSelect = document.getElementById("resource-group");

function nextResourceSortOrder(category) {
  const inGroup = currentResources.filter((r) => resourceCategory(r) === category);
  if (!inGroup.length) return 1;
  return Math.max(...inGroup.map((r) => r.sort_order || 0)) + 1;
}

function openAddResourceDrawer() {
  resourceForm.reset();
  resourceIdInput.value = "";
  resourceGroupSelect.value = "emergency";
  resourceDrawerTitle.textContent = "Add resource";
  resourceSubmitBtn.textContent = "Add resource";
  resourceDrawer.classList.remove("hidden");
}

function openEditResourceDrawer(r) {
  resourceIdInput.value = r.id;
  resourceGroupSelect.value = resourceCategory(r);
  document.getElementById("resource-name").value = r.name || "";
  document.getElementById("resource-url").value = r.url || "";
  document.getElementById("resource-desc").value = r.description || "";
  resourceDrawerTitle.textContent = "Edit resource";
  resourceSubmitBtn.textContent = "Save changes";
  resourceDrawer.classList.remove("hidden");
}

function closeResourceDrawer() {
  resourceDrawer.classList.add("hidden");
}

document.getElementById("open-resource-drawer-btn").addEventListener("click", openAddResourceDrawer);
document.getElementById("close-resource-drawer-btn").addEventListener("click", closeResourceDrawer);
document.getElementById("resource-drawer-overlay").addEventListener("click", closeResourceDrawer);

resourceForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const proceed = await confirmContinueWithUnsavedResources();
  if (!proceed) return;

  showError(null);
  const id = resourceIdInput.value;
  const category = resourceGroupSelect.value;
  const name = document.getElementById("resource-name").value.trim();
  const url = document.getElementById("resource-url").value.trim() || null;
  const description = document.getElementById("resource-desc").value.trim() || null;

  if (!name) {
    showError("Name is required.");
    return;
  }

  const payload = { category, name, url, description };
  const { error } = id
    ? await supabaseClient.from("resources").update(payload).eq("id", id)
    : await supabaseClient
        .from("resources")
        .insert({ ...payload, active: true, sort_order: nextResourceSortOrder(category) });

  if (error) {
    showError(error.message);
    return;
  }

  closeResourceDrawer();
  loadResources();
  showToast(id ? "Resource updated" : "Resource added");
});

// ===========================================================================
// Home cards — the green mission-pillar cards and gold gift-need cards
// Two groups, each a drag-reorderable list; drag a card into the other group
// to move it. Nothing is written until "Save layout".
// ===========================================================================
const HOMECARD_GROUPS = [
  { key: "pillars", label: "Mission pillars" },
  { key: "gifts", label: "Gift needs" },
  { key: "partners", label: "Partners" },
];

const saveHomeCardsBtn = document.getElementById("save-homecards-btn");
const homeCardLists = HOMECARD_GROUPS.map((g) => ({
  key: g.key,
  el: document.getElementById(`homecard-list-${g.key}`),
})).filter((l) => l.el);
let currentHomeCards = [];
let homeCardSortables = [];
let homeCardsDirty = false;

function markHomeCardsDirty() {
  homeCardsDirty = true;
  saveHomeCardsBtn.disabled = false;
}

function markHomeCardsClean() {
  homeCardsDirty = false;
  saveHomeCardsBtn.disabled = true;
}

async function confirmContinueWithUnsavedHomeCards() {
  if (!homeCardsDirty) return true;
  return showConfirm({
    title: "Unsaved card order",
    message:
      "You've moved cards around but haven't saved yet. Continuing will discard those moves. Continue anyway?",
    confirmText: "Continue anyway",
    danger: true,
  });
}

function homeCardSection(c) {
  return HOMECARD_GROUPS.some((g) => g.key === c.section) ? c.section : HOMECARD_GROUPS[0].key;
}

async function loadHomeCards() {
  homeCardLists.forEach(({ el }) => {
    el.innerHTML = '<p class="muted">Loading&hellip;</p>';
  });

  const { data, error } = await supabaseClient
    .from("home_cards")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    homeCardLists.forEach(({ el }) => (el.innerHTML = ""));
    showError(error.message);
    return;
  }

  currentHomeCards = data;
  markHomeCardsClean();
  renderHomeCards();
}

function renderHomeCards() {
  homeCardLists.forEach(({ key, el }) => {
    const items = currentHomeCards
      .filter((c) => homeCardSection(c) === key)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    el.innerHTML = "";
    items.forEach((c) => el.appendChild(homeCardRow(c)));
    document.getElementById(`homecard-count-${key}`).textContent = items.length;
  });
  initHomeCardSortables();
}

function homeCardRow(c) {
  const card = document.createElement("div");
  card.className = "res-admin-item";
  card.dataset.id = c.id;

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.title = "Drag to reorder or move between groups";
  handle.textContent = "☰";
  card.appendChild(handle);

  const info = document.createElement("div");
  info.className = "res-admin-info";
  info.innerHTML = `
    <div class="res-admin-name">${escapeHtml(c.title)}</div>
    ${c.tag ? `<div class="res-admin-desc" style="font-weight: 600;">${escapeHtml(c.tag)}</div>` : ""}
    ${c.description ? `<div class="res-admin-desc">${escapeHtml(c.description)}</div>` : ""}
  `;
  card.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "res-admin-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-secondary btn-small";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditHomeCardDrawer(c));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger btn-small";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => deleteHomeCard(c));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

function refreshHomeCardCounts() {
  homeCardLists.forEach(({ key, el }) => {
    document.getElementById(`homecard-count-${key}`).textContent =
      el.querySelectorAll(".res-admin-item").length;
  });
}

function initHomeCardSortables() {
  homeCardSortables.forEach((s) => s.destroy());
  homeCardSortables = homeCardLists.map(({ el }) =>
    new Sortable(el, {
      group: "bbr-homecards",
      draggable: ".res-admin-item",
      filter: ".res-admin-actions",
      preventOnFilter: false,
      forceFallback: true,
      fallbackOnBody: true,
      swapThreshold: 0.6,
      animation: 150,
      onEnd: () => {
        markHomeCardsDirty();
        refreshHomeCardCounts();
      },
    })
  );
}

saveHomeCardsBtn.addEventListener("click", async () => {
  showError(null);
  saveHomeCardsBtn.disabled = true;

  const changed = [];
  homeCardLists.forEach(({ key, el }) => {
    Array.from(el.querySelectorAll(".res-admin-item")).forEach((row, index) => {
      const c = currentHomeCards.find((x) => x.id === row.dataset.id);
      if (!c) return;
      const next = { section: key, sort_order: index + 1 };
      if (next.section !== c.section || next.sort_order !== c.sort_order) {
        changed.push({ c, next });
      }
    });
  });

  if (!changed.length) {
    markHomeCardsClean();
    showToast("Nothing to save");
    return;
  }

  const results = await Promise.all(
    changed.map(({ c, next }) => supabaseClient.from("home_cards").update(next).eq("id", c.id))
  );
  const failed = results.find((x) => x.error);
  if (failed) {
    showError(failed.error.message);
    saveHomeCardsBtn.disabled = false;
    return;
  }

  changed.forEach(({ c, next }) => Object.assign(c, next));
  markHomeCardsClean();
  renderHomeCards();
  showToast(`Cards saved (${changed.length} updated)`);
});

async function deleteHomeCard(c) {
  const proceed = await confirmContinueWithUnsavedHomeCards();
  if (!proceed) return;

  const confirmed = await showConfirm({
    title: "Delete card?",
    message: `Delete "${c.title}"? This cannot be undone.`,
    confirmText: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  showError(null);
  const { error } = await supabaseClient.from("home_cards").delete().eq("id", c.id);
  if (error) {
    showError(error.message);
    return;
  }
  loadHomeCards();
  showToast("Card deleted");
}

// --- Add / edit home card drawer ---
const homeCardDrawer = document.getElementById("homecard-drawer");
const homeCardForm = document.getElementById("homecard-form");
const homeCardDrawerTitle = document.getElementById("homecard-drawer-title");
const homeCardSubmitBtn = document.getElementById("homecard-submit-btn");
const homeCardIdInput = document.getElementById("homecard-id");
const homeCardSectionSelect = document.getElementById("homecard-section");
const homeCardPartnerFields1 = document.getElementById("homecard-partner-fields");
const homeCardPartnerFields2 = document.getElementById("homecard-partner-fields-2");

// The tag / contact / link fields only apply to partner cards.
function updateHomeCardPartnerFields() {
  const isPartner = homeCardSectionSelect.value === "partners";
  homeCardPartnerFields1.classList.toggle("hidden", !isPartner);
  homeCardPartnerFields2.classList.toggle("hidden", !isPartner);
}
homeCardSectionSelect.addEventListener("change", updateHomeCardPartnerFields);

function nextHomeCardSortOrder(section) {
  const inSection = currentHomeCards.filter((c) => homeCardSection(c) === section);
  if (!inSection.length) return 1;
  return Math.max(...inSection.map((c) => c.sort_order || 0)) + 1;
}

function openAddHomeCardDrawer() {
  homeCardForm.reset();
  homeCardIdInput.value = "";
  homeCardSectionSelect.value = "pillars";
  updateHomeCardPartnerFields();
  homeCardDrawerTitle.textContent = "Add card";
  homeCardSubmitBtn.textContent = "Add card";
  homeCardDrawer.classList.remove("hidden");
}

function openEditHomeCardDrawer(c) {
  homeCardIdInput.value = c.id;
  homeCardSectionSelect.value = homeCardSection(c);
  document.getElementById("homecard-title").value = c.title || "";
  document.getElementById("homecard-tag").value = c.tag || "";
  document.getElementById("homecard-desc").value = c.description || "";
  document.getElementById("homecard-meta").value = c.meta || "";
  document.getElementById("homecard-url").value = c.url || "";
  updateHomeCardPartnerFields();
  homeCardDrawerTitle.textContent = "Edit card";
  homeCardSubmitBtn.textContent = "Save changes";
  homeCardDrawer.classList.remove("hidden");
}

function closeHomeCardDrawer() {
  homeCardDrawer.classList.add("hidden");
}

document.getElementById("open-homecard-drawer-btn").addEventListener("click", openAddHomeCardDrawer);
document.getElementById("close-homecard-drawer-btn").addEventListener("click", closeHomeCardDrawer);
document.getElementById("homecard-drawer-overlay").addEventListener("click", closeHomeCardDrawer);

homeCardForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const proceed = await confirmContinueWithUnsavedHomeCards();
  if (!proceed) return;

  showError(null);
  const id = homeCardIdInput.value;
  const section = homeCardSectionSelect.value;
  const title = document.getElementById("homecard-title").value.trim();
  const description = document.getElementById("homecard-desc").value.trim() || null;

  if (!title) {
    showError("Title is required.");
    return;
  }

  // tag / meta / url only apply to partner cards; clear them otherwise.
  const isPartner = section === "partners";
  const payload = {
    section,
    title,
    description,
    tag: isPartner ? document.getElementById("homecard-tag").value.trim() || null : null,
    meta: isPartner ? document.getElementById("homecard-meta").value.trim() || null : null,
    url: isPartner ? document.getElementById("homecard-url").value.trim() || null : null,
  };
  const { error } = id
    ? await supabaseClient.from("home_cards").update(payload).eq("id", id)
    : await supabaseClient
        .from("home_cards")
        .insert({ ...payload, active: true, sort_order: nextHomeCardSortOrder(section) });

  if (error) {
    showError(error.message);
    return;
  }

  closeHomeCardDrawer();
  loadHomeCards();
  showToast(id ? "Card updated" : "Card added");
});

init();
