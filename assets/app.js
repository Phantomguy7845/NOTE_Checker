const API_BASE = "https://bold-rain-86f3.surakiat16082000.workers.dev";

(() => {
  "use strict";

  const CONFIG = {
    imageMaxLongSide: 1280,
    imageQuality: 0.78,
    searchDebounceMs: 250,
    modalTransitionMs: 240,
    overlayTransitionMs: 240,
    toastDurationMs: 3200,
  };

  const state = {
    pendingNotes: [],
    doneNotes: [],
    loading: {
      bootstrap: false,
      pending: false,
      done: false,
      refreshAll: false,
    },
    errors: {
      pending: "",
      done: "",
    },
    filters: {
      pending: { search: "", date: "", sort: "OLDEST" },
      done: { search: "", date: "", sort: "NEWEST" },
    },
    addForm: {
      saving: false,
      compressing: false,
      image: null,
    },
    addPage: {
      open: false,
    },
    sidebar: {
      open: false,
    },
    noteModal: {
      open: false,
      noteId: "",
      source: "",
      loading: false,
      error: "",
      detail: null,
      mode: "view",
      saving: false,
      requestToken: 0,
      image: {
        status: "idle",
        dataUrl: "",
        message: "",
      },
      editDraft: null,
    },
    confirm: {
      open: false,
      noteId: "",
      busy: false,
    },
  };

  const dom = {};
  let toastCounter = 0;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    bindEvents();
    renderAddImagePreview();
    renderList("pending");
    renderList("done");

    if (!isApiConfigured()) {
      setApiStatus("warn", "API: โปรดตั้งค่า API_BASE ใน assets/app.js");
      showToast("warn", "แก้ค่า API_BASE ให้เป็น Cloudflare Worker URL ก่อนใช้งานจริง");
      return;
    }

    await bootstrap();
  }

  function cacheDom() {
    dom.body = document.body;

    dom.apiStatus = document.getElementById("api-status");
    dom.apiStatusText = document.getElementById("api-status-text");
    dom.btnRefreshAll = document.getElementById("btn-refresh-all");
    dom.btnOpenHistory = document.getElementById("btn-open-history");
    dom.btnOpenAddPage = document.getElementById("btn-open-add-page");

    dom.addPageBackdrop = document.getElementById("add-page-backdrop");
    dom.addPageShell = document.getElementById("add-page-shell");
    dom.btnCloseAddPage = document.getElementById("btn-close-add-page");

    dom.addNoteForm = document.getElementById("add-note-form");
    dom.addTitle = document.getElementById("add-title");
    dom.addDescription = document.getElementById("add-description");
    dom.addImageInput = document.getElementById("add-image-input");
    dom.btnAddPickImage = document.getElementById("btn-add-pick-image");
    dom.btnAddRemoveImage = document.getElementById("btn-add-remove-image");
    dom.addImagePreviewCard = document.getElementById("add-image-preview-card");
    dom.addImagePreview = document.getElementById("add-image-preview");
    dom.addImagePlaceholder = document.getElementById("add-image-placeholder");
    dom.addImageMeta = document.getElementById("add-image-meta");
    dom.btnAddSubmit = document.getElementById("btn-add-submit");
    dom.btnAddCancel = document.getElementById("btn-add-cancel");

    dom.pendingSearch = document.getElementById("pending-search");
    dom.pendingDate = document.getElementById("pending-date");
    dom.pendingSort = document.getElementById("pending-sort");
    dom.pendingCount = document.getElementById("pending-count");
    dom.pendingList = document.getElementById("pending-list");

    dom.historyBackdrop = document.getElementById("history-backdrop");
    dom.historyPanel = document.getElementById("history-panel");
    dom.btnCloseHistory = document.getElementById("btn-close-history");
    dom.historySearch = document.getElementById("history-search");
    dom.historyDate = document.getElementById("history-date");
    dom.historySort = document.getElementById("history-sort");
    dom.historyCount = document.getElementById("history-count");
    dom.historyList = document.getElementById("history-list");

    dom.noteModalBackdrop = document.getElementById("note-modal-backdrop");
    dom.noteModalShell = document.getElementById("note-modal-shell");
    dom.noteModal = document.getElementById("note-modal");
    dom.noteModalHeading = document.getElementById("note-modal-heading");
    dom.noteModalSubheading = document.getElementById("note-modal-subheading");
    dom.noteModalBody = document.getElementById("note-modal-body");

    dom.confirmBackdrop = document.getElementById("confirm-backdrop");
    dom.confirmShell = document.getElementById("confirm-shell");
    dom.confirmTitle = document.getElementById("confirm-note-title");
    dom.confirmMeta = document.getElementById("confirm-note-meta");
    dom.btnConfirmCancel = document.getElementById("btn-confirm-cancel");
    dom.btnConfirmSubmit = document.getElementById("btn-confirm-submit");

    dom.globalLoading = document.getElementById("global-loading");
    dom.globalLoadingText = document.getElementById("global-loading-text");
    dom.toastStack = document.getElementById("toast-stack");
  }

  function bindEvents() {
    const handlePendingSearch = debounce((value) => {
      state.filters.pending.search = value.trim();
      renderList("pending");
    }, CONFIG.searchDebounceMs);

    const handleHistorySearch = debounce((value) => {
      state.filters.done.search = value.trim();
      renderList("done");
    }, CONFIG.searchDebounceMs);

    dom.btnRefreshAll.addEventListener("click", handleRefreshAll);
    dom.btnOpenAddPage.addEventListener("click", openAddPage);
    dom.btnOpenHistory.addEventListener("click", openHistoryPanel);
    dom.btnCloseHistory.addEventListener("click", closeHistoryPanel);
    dom.historyBackdrop.addEventListener("click", closeHistoryPanel);

    dom.addPageBackdrop.addEventListener("click", () => closeAddPage());
    dom.btnCloseAddPage.addEventListener("click", () => closeAddPage());
    dom.btnAddCancel.addEventListener("click", () => closeAddPage());

    dom.addNoteForm.addEventListener("submit", handleAddNoteSubmit);
    dom.addTitle.addEventListener("input", () => dom.addTitle.classList.remove("is-invalid"));
    dom.addDescription.addEventListener("input", () => dom.addDescription.classList.remove("is-invalid"));
    dom.btnAddPickImage.addEventListener("click", () => dom.addImageInput.click());
    dom.btnAddRemoveImage.addEventListener("click", clearAddFormImage);
    dom.addImageInput.addEventListener("change", handleAddImageChange);

    dom.pendingSearch.addEventListener("input", (event) => handlePendingSearch(event.target.value));
    dom.pendingDate.addEventListener("change", (event) => {
      state.filters.pending.date = event.target.value;
      renderList("pending");
    });
    dom.pendingSort.addEventListener("change", (event) => {
      state.filters.pending.sort = event.target.value;
      renderList("pending");
    });

    dom.historySearch.addEventListener("input", (event) => handleHistorySearch(event.target.value));
    dom.historyDate.addEventListener("change", (event) => {
      state.filters.done.date = event.target.value;
      renderList("done");
    });
    dom.historySort.addEventListener("change", (event) => {
      state.filters.done.sort = event.target.value;
      renderList("done");
    });

    dom.pendingList.addEventListener("click", (event) => handleListClick(event, "pending"));
    dom.historyList.addEventListener("click", (event) => handleListClick(event, "done"));

    dom.noteModalBackdrop.addEventListener("click", closeNoteModal);
    dom.noteModal.addEventListener("click", handleNoteModalClick);
    dom.noteModal.addEventListener("change", handleNoteModalChange);
    dom.noteModal.addEventListener("input", handleNoteModalInput);

    dom.confirmBackdrop.addEventListener("click", handleConfirmCancel);
    dom.btnConfirmCancel.addEventListener("click", handleConfirmCancel);
    dom.btnConfirmSubmit.addEventListener("click", handleConfirmSubmit);

    document.addEventListener("keydown", handleGlobalKeydown);
  }

  async function bootstrap() {
    setGlobalLoading(true, "กำลังโหลดข้อมูล NOTE...");
    state.loading.bootstrap = true;
    try {
      await Promise.allSettled([checkApiHealth(), refreshPendingNotes(), refreshDoneNotes()]);
    } finally {
      state.loading.bootstrap = false;
      setGlobalLoading(false);
    }
  }

  function isApiConfigured() {
    return Boolean(API_BASE && !API_BASE.includes("YOUR-WORKER"));
  }

  async function handleRefreshAll() {
    if (state.loading.refreshAll) return;
    if (!isApiConfigured()) {
      showToast("warn", "ยังไม่ได้ตั้งค่า API_BASE");
      return;
    }

    state.loading.refreshAll = true;
    setButtonBusy(dom.btnRefreshAll, true, "กำลังรีเฟรช...");
    try {
      await Promise.all([checkApiHealth(), refreshPendingNotes(), refreshDoneNotes()]);
      showToast("success", "รีเฟรชข้อมูลล่าสุดแล้ว");
    } catch (error) {
      showToast("error", getErrorMessage(error));
    } finally {
      state.loading.refreshAll = false;
      setButtonBusy(dom.btnRefreshAll, false);
    }
  }

  async function checkApiHealth() {
    try {
      const response = await apiGet("health");
      const text = extractHealthText(response);
      setApiStatus("online", text || "API: พร้อมใช้งาน");
      return response;
    } catch (error) {
      setApiStatus("error", `API: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  function setApiStatus(status, text) {
    dom.apiStatus.dataset.state = status;
    dom.apiStatusText.textContent = text;
  }

  async function refreshPendingNotes() {
    state.loading.pending = true;
    state.errors.pending = "";
    renderList("pending");

    try {
      const response = await apiGet("getPendingNotes");
      const notes = extractNoteArray(response).map(normalizeNote);
      state.pendingNotes = notes
        .filter((note) => note.noteId)
        .filter((note) => normalizeStatus(note.status || "PENDING") !== "DONE");
      setApiStatus("online", "API: พร้อมใช้งาน");
    } catch (error) {
      state.errors.pending = getErrorMessage(error);
      showToast("error", `โหลด Pending ไม่สำเร็จ: ${state.errors.pending}`);
    } finally {
      state.loading.pending = false;
      renderList("pending");
    }
  }

  async function refreshDoneNotes() {
    state.loading.done = true;
    state.errors.done = "";
    renderList("done");

    try {
      const response = await apiGet("getDoneNotes");
      const notes = extractNoteArray(response).map(normalizeNote);
      state.doneNotes = notes
        .filter((note) => note.noteId)
        .map((note) => ({ ...note, status: "DONE" }));
      setApiStatus("online", "API: พร้อมใช้งาน");
    } catch (error) {
      state.errors.done = getErrorMessage(error);
      showToast("error", `โหลด History ไม่สำเร็จ: ${state.errors.done}`);
    } finally {
      state.loading.done = false;
      renderList("done");
    }
  }

  function openAddPage() {
    if (state.addPage.open) return;
    state.addPage.open = true;

    showModalElements(dom.addPageBackdrop, dom.addPageShell);
    dom.addPageShell.setAttribute("aria-hidden", "false");
    dom.addPageBackdrop.setAttribute("aria-hidden", "false");
    syncBodyScrollLock();

    window.setTimeout(() => {
      if (state.addPage.open) {
        dom.addTitle.focus();
      }
    }, CONFIG.modalTransitionMs);
  }

  function closeAddPage(options = {}) {
    const force = Boolean(options.force);
    if (!state.addPage.open) return;
    if (!force && (state.addForm.saving || state.addForm.compressing)) return;

    state.addPage.open = false;
    hideModalElements(dom.addPageBackdrop, dom.addPageShell);
    dom.addPageShell.setAttribute("aria-hidden", "true");
    dom.addPageBackdrop.setAttribute("aria-hidden", "true");
    syncBodyScrollLock();
  }

  async function handleAddNoteSubmit(event) {
    event.preventDefault();
    if (state.addForm.saving || state.addForm.compressing) return;
    if (!isApiConfigured()) {
      showToast("warn", "โปรดตั้งค่า API_BASE ก่อนบันทึก NOTE");
      return;
    }

    const title = dom.addTitle.value.trim();
    const description = dom.addDescription.value.trim();
    let invalid = false;

    if (!title) {
      dom.addTitle.classList.add("is-invalid");
      invalid = true;
    }
    if (!description) {
      dom.addDescription.classList.add("is-invalid");
      invalid = true;
    }
    if (invalid) {
      showToast("error", "กรุณากรอกหัวข้อและรายละเอียดให้ครบ");
      return;
    }

    state.addForm.saving = true;
    setButtonBusy(dom.btnAddSubmit, true, "กำลังบันทึก...");
    renderAddImagePreview();

    try {
      const payload = { title, description };
      if (state.addForm.image) {
        payload.imageDataUrl = state.addForm.image.dataUrl;
        payload.imageName = state.addForm.image.imageName;
        payload.imageMimeType = state.addForm.image.imageMimeType;
      }

      await apiPost("createNote", payload);
      showToast("success", "บันทึก NOTE เรียบร้อย");

      dom.addNoteForm.reset();
      clearAddFormImage({ silent: true });
      dom.addTitle.classList.remove("is-invalid");
      dom.addDescription.classList.remove("is-invalid");

      closeAddPage({ force: true });
      await refreshPendingNotes();
    } catch (error) {
      showToast("error", `บันทึก NOTE ไม่สำเร็จ: ${getErrorMessage(error)}`);
    } finally {
      state.addForm.saving = false;
      setButtonBusy(dom.btnAddSubmit, false);
      renderAddImagePreview();
    }
  }

  async function handleAddImageChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("error", "กรุณาเลือกไฟล์รูปภาพเท่านั้น");
      dom.addImageInput.value = "";
      return;
    }

    state.addForm.compressing = true;
    renderAddImagePreview();
    try {
      const compressed = await compressImageFile(file);
      state.addForm.image = {
        dataUrl: compressed.dataUrl,
        imageName: compressed.imageName,
        imageMimeType: compressed.imageMimeType,
        stats: compressed.stats,
      };
      showToast("success", "บีบอัดรูปเรียบร้อย");
    } catch (error) {
      state.addForm.image = null;
      showToast("error", `บีบอัดรูปไม่สำเร็จ: ${getErrorMessage(error)}`);
    } finally {
      state.addForm.compressing = false;
      dom.addImageInput.value = "";
      renderAddImagePreview();
    }
  }

  function clearAddFormImage(options = {}) {
    state.addForm.image = null;
    state.addForm.compressing = false;
    dom.addImageInput.value = "";
    renderAddImagePreview();
    if (!options.silent) {
      showToast("warn", "ลบรูปที่เลือกออกแล้ว");
    }
  }

  function renderAddImagePreview() {
    const image = state.addForm.image;
    const isBusy = state.addForm.compressing;
    const isFormLocked = state.addForm.saving || isBusy;

    dom.btnAddPickImage.disabled = isFormLocked;
    dom.btnAddRemoveImage.disabled = isFormLocked || (!image && !isBusy);
    dom.btnAddCancel.disabled = isFormLocked;
    dom.btnCloseAddPage.disabled = isFormLocked;

    if (isBusy) {
      dom.addImagePreview.hidden = true;
      dom.addImagePreview.removeAttribute("src");
      dom.addImagePlaceholder.hidden = false;
      dom.addImagePlaceholder.innerHTML =
        '<span class="inline-spinner"><span class="spinner" aria-hidden="true"></span>กำลังบีบอัดรูป...</span>';
      dom.addImageMeta.textContent = "กำลังประมวลผลรูปภาพด้วย canvas";
      dom.addImagePreviewCard.dataset.empty = "true";
      return;
    }

    dom.addImagePlaceholder.innerHTML = "ยังไม่ได้เลือกรูป";

    if (!image) {
      dom.addImagePreview.hidden = true;
      dom.addImagePreview.removeAttribute("src");
      dom.addImagePlaceholder.hidden = false;
      dom.addImageMeta.textContent = "รองรับไฟล์ภาพจากมือถือ/คอมพิวเตอร์";
      dom.addImagePreviewCard.dataset.empty = "true";
      return;
    }

    dom.addImagePreview.src = image.dataUrl;
    dom.addImagePreview.hidden = false;
    dom.addImagePlaceholder.hidden = true;
    dom.addImagePreviewCard.dataset.empty = "false";
    dom.addImageMeta.textContent = buildCompressionStatsText(image.stats);
  }

  function handleListClick(event, scope) {
    const button = event.target.closest("button[data-action][data-note-id]");
    if (!button) return;

    const action = button.dataset.action;
    const noteId = String(button.dataset.noteId || "");
    if (!noteId) return;

    if (action === "view-detail") {
      void openNoteModal(noteId, scope);
      return;
    }

    if (action === "request-done") {
      openConfirmModal(noteId);
    }
  }

  function renderList(scope) {
    const isDoneScope = scope === "done";
    const notes = isDoneScope ? state.doneNotes : state.pendingNotes;
    const loading = isDoneScope ? state.loading.done : state.loading.pending;
    const error = isDoneScope ? state.errors.done : state.errors.pending;
    const listEl = isDoneScope ? dom.historyList : dom.pendingList;
    const countEl = isDoneScope ? dom.historyCount : dom.pendingCount;
    const filteredNotes = getFilteredAndSortedNotes(scope);

    countEl.textContent = `${filteredNotes.length} / ${notes.length} รายการ`;

    if (loading) {
      listEl.innerHTML = renderSkeletonCards(4);
      return;
    }

    if (!notes.length) {
      const msg = error
        ? `<li class="list-message list-message--error">โหลดข้อมูลไม่สำเร็จ<span class="list-message__hint">${escapeHtml(error)}</span></li>`
        : `<li class="list-message">${isDoneScope ? "ยังไม่มีรายการใน History" : "ยังไม่มี NOTE ที่รอดำเนินการ"}</li>`;
      listEl.innerHTML = msg;
      return;
    }

    if (!filteredNotes.length) {
      listEl.innerHTML =
        '<li class="list-message">ไม่พบรายการที่ตรงกับเงื่อนไขค้นหา/ตัวกรอง</li>';
      return;
    }

    listEl.innerHTML = filteredNotes.map((note) => renderNoteCard(note, scope)).join("");
  }

  function getFilteredAndSortedNotes(scope) {
    const isDoneScope = scope === "done";
    const notes = (isDoneScope ? state.doneNotes : state.pendingNotes).slice();
    const filters = isDoneScope ? state.filters.done : state.filters.pending;
    const search = (filters.search || "").toLowerCase();
    const date = filters.date || "";
    const sort = filters.sort || (isDoneScope ? "NEWEST" : "OLDEST");

    const filtered = notes.filter((note) => {
      if (search) {
        const haystack = `${note.title} ${note.description}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (date) {
        const noteDate = toLocalDateInputValue(note.createdAt);
        if (noteDate !== date) return false;
      }
      return true;
    });

    filtered.sort((a, b) => compareNotes(a, b, sort));
    return filtered;
  }

  function compareNotes(a, b, sort) {
    const aTitle = (a.title || "").toLocaleLowerCase();
    const bTitle = (b.title || "").toLocaleLowerCase();
    const timeA = toTimestamp(a.createdAt);
    const timeB = toTimestamp(b.createdAt);

    switch (sort) {
      case "NEWEST":
        return timeB - timeA || aTitle.localeCompare(bTitle, "th");
      case "A_Z":
        return aTitle.localeCompare(bTitle, "th") || timeA - timeB;
      case "Z_A":
        return bTitle.localeCompare(aTitle, "th") || timeA - timeB;
      case "OLDEST":
      default:
        return timeA - timeB || aTitle.localeCompare(bTitle, "th");
    }
  }

  function renderNoteCard(note, scope) {
    const isPending = scope === "pending";
    const hasImage = Boolean(note.imageFileId) && !note.imageDeleted;
    const createdAt = formatDateTime(note.createdAt) || "-";
    const checkedAt = note.checkedAt ? formatDateTime(note.checkedAt) : "";
    const status = normalizeStatus(note.status || (isPending ? "PENDING" : "DONE"));
    const desc = clipText(note.description || "-", 120);

    return `
      <li class="note-card">
        <div>
          <div class="note-card__header">
            <h3 class="note-card__title">${escapeHtml(note.title || "(ไม่มีหัวข้อ)")}</h3>
            <span class="chip ${status === "DONE" ? "chip--done" : "chip--pending"}">${escapeHtml(status)}</span>
          </div>
          <p class="note-card__desc">${escapeHtml(desc)}</p>
          <div class="note-card__meta">
            <span class="note-card__meta-item">สร้าง: ${escapeHtml(createdAt)}</span>
            ${checkedAt ? `<span class="note-card__meta-item">เสร็จ: ${escapeHtml(checkedAt)}</span>` : ""}
            ${hasImage ? '<span class="note-card__meta-item">มีรูป</span>' : ""}
          </div>
        </div>
        <div class="note-card__actions">
          <button type="button" class="btn btn--outline btn--sm" data-action="view-detail" data-note-id="${escapeAttribute(note.noteId)}">ดูรายละเอียด</button>
          ${
            isPending
              ? `<button type="button" class="btn btn--success btn--sm" data-action="request-done" data-note-id="${escapeAttribute(note.noteId)}">Checklist</button>`
              : ""
          }
        </div>
      </li>
    `;
  }

  function renderSkeletonCards(count) {
    return Array.from({ length: count }, () => {
      return `
        <li class="note-card note-card--skeleton" aria-hidden="true">
          <div>
            <div class="skeleton-line skeleton-line--title"></div>
            <div class="skeleton-line skeleton-line--desc"></div>
            <div class="skeleton-line skeleton-line--desc skeleton-line--desc-short"></div>
            <div class="skeleton-line skeleton-line--meta"></div>
          </div>
          <div class="skeleton-actions">
            <div class="skeleton-line skeleton-pill"></div>
            <div class="skeleton-line skeleton-pill"></div>
          </div>
        </li>
      `;
    }).join("");
  }

  function openHistoryPanel() {
    if (state.sidebar.open) return;
    state.sidebar.open = true;
    dom.btnOpenHistory.setAttribute("aria-expanded", "true");
    dom.historyPanel.setAttribute("aria-hidden", "false");
    dom.historyBackdrop.classList.remove("hidden");
    requestAnimationFrame(() => {
      dom.historyBackdrop.classList.add("is-open");
      dom.historyPanel.classList.add("is-open");
    });
    syncBodyScrollLock();
  }

  function closeHistoryPanel() {
    if (!state.sidebar.open) return;
    state.sidebar.open = false;
    dom.btnOpenHistory.setAttribute("aria-expanded", "false");
    dom.historyPanel.setAttribute("aria-hidden", "true");
    dom.historyBackdrop.classList.remove("is-open");
    dom.historyPanel.classList.remove("is-open");
    window.setTimeout(() => {
      if (!state.sidebar.open) {
        dom.historyBackdrop.classList.add("hidden");
      }
    }, CONFIG.overlayTransitionMs);
    syncBodyScrollLock();
  }

  async function openNoteModal(noteId, source) {
    state.noteModal.open = true;
    state.noteModal.noteId = String(noteId);
    state.noteModal.source = source || "";
    state.noteModal.mode = "view";
    state.noteModal.saving = false;
    state.noteModal.loading = true;
    state.noteModal.error = "";
    state.noteModal.detail = null;
    state.noteModal.editDraft = null;
    state.noteModal.image = { status: "idle", dataUrl: "", message: "" };

    showModalElements(dom.noteModalBackdrop, dom.noteModalShell);
    dom.noteModalShell.setAttribute("aria-hidden", "false");
    dom.noteModalBackdrop.setAttribute("aria-hidden", "false");
    syncBodyScrollLock();
    renderNoteModal();

    await loadNoteDetail(noteId);
  }

  function closeNoteModal() {
    if (!state.noteModal.open) return;

    state.noteModal.open = false;
    state.noteModal.requestToken += 1;
    state.noteModal.loading = false;
    state.noteModal.saving = false;
    state.noteModal.mode = "view";
    state.noteModal.editDraft = null;

    hideModalElements(dom.noteModalBackdrop, dom.noteModalShell);
    dom.noteModalShell.setAttribute("aria-hidden", "true");
    dom.noteModalBackdrop.setAttribute("aria-hidden", "true");
    syncBodyScrollLock();
  }

  async function loadNoteDetail(noteId) {
    const token = ++state.noteModal.requestToken;
    state.noteModal.loading = true;
    state.noteModal.error = "";
    state.noteModal.detail = getLocalNoteById(noteId) || null;
    state.noteModal.image = { status: "idle", dataUrl: "", message: "" };
    renderNoteModal();

    try {
      const response = await apiGet("getNoteDetail", { noteId });
      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;

      const rawDetail = extractNoteDetail(response);
      const detail = normalizeNote(rawDetail || getLocalNoteById(noteId) || {});
      if (!detail.noteId) detail.noteId = String(noteId);
      state.noteModal.detail = detail;
      state.noteModal.error = "";
      state.noteModal.loading = false;

      if (detail.imageDataUrl) {
        state.noteModal.image = { status: "loaded", dataUrl: detail.imageDataUrl, message: "" };
      } else if (detail.imageFileId && !detail.imageDeleted) {
        state.noteModal.image = { status: "loading", dataUrl: "", message: "" };
      } else {
        state.noteModal.image = { status: "none", dataUrl: "", message: "" };
      }

      renderNoteModal();

      if (detail.imageFileId && !detail.imageDeleted && !detail.imageDataUrl) {
        await loadNoteImageData(detail.imageFileId, token);
      }
    } catch (error) {
      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;
      state.noteModal.loading = false;
      state.noteModal.error = getErrorMessage(error);
      if (!state.noteModal.detail) {
        state.noteModal.image = { status: "none", dataUrl: "", message: "" };
      }
      renderNoteModal();
    }
  }

  async function loadNoteImageData(fileId, token) {
    try {
      const response = await apiGet("getNoteImageData", { fileId });
      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;

      const dataUrl = extractImageDataUrl(response);
      if (!dataUrl) {
        throw new Error("ไม่พบข้อมูลรูปภาพ");
      }
      state.noteModal.image = { status: "loaded", dataUrl, message: "" };
      renderNoteModal();
    } catch (error) {
      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;
      const message = buildImageLoadPlaceholderMessage(error);
      state.noteModal.image = { status: "missing", dataUrl: "", message };
      renderNoteModal();
    }
  }

  function renderNoteModal() {
    const modalState = state.noteModal;
    dom.noteModalHeading.textContent = modalState.mode === "edit" ? "แก้ไข NOTE" : "รายละเอียด NOTE";

    if (modalState.error && !modalState.detail) {
      dom.noteModalSubheading.textContent = "โหลดข้อมูลไม่สำเร็จ";
      dom.noteModalBody.innerHTML = `
        <div class="note-detail">
          <div class="list-message list-message--error">
            ไม่สามารถโหลดรายละเอียด NOTE ได้
            <span class="list-message__hint">${escapeHtml(modalState.error)}</span>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn btn--ghost" data-action="close-note-modal">ปิด</button>
          </div>
        </div>
      `;
      return;
    }

    if (modalState.loading && !modalState.detail) {
      dom.noteModalSubheading.textContent = "กำลังโหลด...";
      dom.noteModalBody.innerHTML = renderNoteModalLoadingSkeleton();
      return;
    }

    const detail = modalState.detail || {};
    const status = normalizeStatus(detail.status || "PENDING");
    dom.noteModalSubheading.textContent = `สถานะ: ${status}`;

    if (modalState.mode === "edit") {
      dom.noteModalBody.innerHTML = renderNoteModalEdit(detail);
      return;
    }

    dom.noteModalBody.innerHTML = renderNoteModalView(detail);
  }

  function renderNoteModalLoadingSkeleton() {
    return `
      <div class="note-detail" aria-hidden="true">
        <div class="detail-grid">
          <div class="detail-row"><div class="skeleton-line skeleton-line--title"></div><div class="skeleton-line skeleton-line--desc"></div></div>
          <div class="detail-row"><div class="skeleton-line skeleton-line--title"></div><div class="skeleton-line skeleton-line--desc"></div></div>
          <div class="detail-row detail-row--full"><div class="skeleton-line skeleton-line--title"></div><div class="skeleton-line skeleton-line--desc"></div><div class="skeleton-line skeleton-line--desc skeleton-line--desc-short"></div></div>
        </div>
        <div class="detail-image">
          <div class="detail-image__frame">
            <div class="inline-spinner"><span class="spinner" aria-hidden="true"></span>กำลังโหลดรูป...</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderNoteModalView(detail) {
    const status = normalizeStatus(detail.status || "PENDING");
    const isPending = status !== "DONE";
    const createdAt = formatDateTime(detail.createdAt) || "-";
    const checkedAt = detail.checkedAt ? formatDateTime(detail.checkedAt) : "-";
    const imageBlock = renderDetailImageView();

    return `
      <div class="note-detail">
        <div class="note-detail__top">
          <div class="detail-grid">
            <div class="detail-row detail-row--full">
              <span class="detail-row__label">หัวข้อ</span>
              <div class="detail-row__value">${escapeHtml(detail.title || "-")}</div>
            </div>
            <div class="detail-row">
              <span class="detail-row__label">สถานะ</span>
              <div class="detail-row__value">
                <span class="chip ${status === "DONE" ? "chip--done" : "chip--pending"}">${escapeHtml(status)}</span>
              </div>
            </div>
            <div class="detail-row">
              <span class="detail-row__label">createdAt</span>
              <div class="detail-row__value">${escapeHtml(createdAt)}</div>
            </div>
            <div class="detail-row">
              <span class="detail-row__label">checkedAt</span>
              <div class="detail-row__value">${escapeHtml(checkedAt)}</div>
            </div>
            <div class="detail-row">
              <span class="detail-row__label">noteId</span>
              <div class="detail-row__value">${escapeHtml(detail.noteId || "-")}</div>
            </div>
            <div class="detail-row detail-row--full">
              <span class="detail-row__label">รายละเอียด</span>
              <div class="detail-row__value preserve-linebreak">${escapeHtml(detail.description || "-")}</div>
            </div>
          </div>
        </div>

        ${imageBlock}

        <div class="detail-actions">
          ${
            isPending
              ? `<button type="button" class="btn btn--outline" data-action="modal-enter-edit">แก้ไข</button>
                 <button type="button" class="btn btn--success" data-action="modal-request-done" data-note-id="${escapeAttribute(detail.noteId || "")}">Checklist เสร็จแล้ว</button>`
              : ""
          }
          <button type="button" class="btn btn--ghost" data-action="close-note-modal">ปิด</button>
        </div>
      </div>
    `;
  }

  function renderDetailImageView() {
    const detail = state.noteModal.detail || {};
    const imageState = state.noteModal.image;
    const hasImageRecord = Boolean(detail.imageFileId) && !detail.imageDeleted;

    if (!hasImageRecord && imageState.status !== "loaded") {
      return `
        <div class="detail-image">
          <div class="detail-image__frame">
            <div class="detail-image__placeholder">ไม่มีรูปภาพแนบ</div>
          </div>
          <div class="detail-image__meta">imageFileId: -</div>
        </div>
      `;
    }

    if (imageState.status === "loading") {
      return `
        <div class="detail-image">
          <div class="detail-image__frame">
            <div class="inline-spinner"><span class="spinner" aria-hidden="true"></span>กำลังโหลดรูปภาพ...</div>
          </div>
          <div class="detail-image__meta">imageFileId: ${escapeHtml(detail.imageFileId || "-")}</div>
        </div>
      `;
    }

    if (imageState.status === "loaded") {
      return `
        <div class="detail-image">
          <div class="detail-image__frame">
            <img src="${escapeAttribute(imageState.dataUrl)}" alt="รูปภาพประกอบ NOTE">
          </div>
          <div class="detail-image__meta">imageFileId: ${escapeHtml(detail.imageFileId || "-")}</div>
        </div>
      `;
    }

    if (imageState.status === "missing") {
      return `
        <div class="detail-image">
          <div class="detail-image__frame">
            <div class="detail-image__placeholder">
              <strong>ไม่สามารถแสดงรูปได้</strong>
              ${escapeHtml(imageState.message || "รูปอาจถูกลบหรือหมดอายุ")}
            </div>
          </div>
          <div class="detail-image__meta">imageFileId: ${escapeHtml(detail.imageFileId || "-")}</div>
        </div>
      `;
    }

    return `
      <div class="detail-image">
        <div class="detail-image__frame">
          <div class="detail-image__placeholder">ไม่มีรูปภาพแนบ</div>
        </div>
        <div class="detail-image__meta">imageFileId: ${escapeHtml(detail.imageFileId || "-")}</div>
      </div>
    `;
  }

  function enterNoteEditMode() {
    const detail = state.noteModal.detail;
    if (!detail) return;
    if (normalizeStatus(detail.status || "PENDING") === "DONE") return;

    state.noteModal.mode = "edit";
    state.noteModal.editDraft = {
      title: detail.title || "",
      description: detail.description || "",
      newImage: null,
      removeImage: false,
      compressing: false,
    };
    renderNoteModal();
  }

  function cancelNoteEditMode() {
    state.noteModal.mode = "view";
    state.noteModal.editDraft = null;
    state.noteModal.saving = false;
    renderNoteModal();
  }

  function renderNoteModalEdit(detail) {
    const draft = state.noteModal.editDraft || {
      title: detail.title || "",
      description: detail.description || "",
      newImage: null,
      removeImage: false,
      compressing: false,
    };

    const imagePanel = renderEditImagePanel(detail, draft);
    const busy = Boolean(state.noteModal.saving || draft.compressing);

    return `
      <div class="note-detail">
        <form class="edit-form" id="modal-edit-form" novalidate>
          <label class="field">
            <span class="field__label">หัวข้อ *</span>
            <input id="modal-edit-title" type="text" maxlength="160" value="${escapeAttribute(draft.title)}" ${busy ? "disabled" : ""}>
          </label>

          <label class="field">
            <span class="field__label">รายละเอียด *</span>
            <textarea id="modal-edit-description" rows="6" maxlength="5000" ${busy ? "disabled" : ""}>${escapeHtml(draft.description)}</textarea>
          </label>

          <div class="field">
            <span class="field__label">รูปภาพ (แก้ไขได้เฉพาะ Pending)</span>
            <input id="modal-edit-image-input" type="file" accept="image/*" class="hidden-input" ${busy ? "disabled" : ""}>
            <div class="edit-form__image-actions">
              <button type="button" class="btn btn--secondary btn--sm" data-action="modal-pick-edit-image" ${busy ? "disabled" : ""}>
                ${draft.newImage ? "เปลี่ยนรูป" : "เลือกรูปใหม่"}
              </button>
              ${renderEditImageActionButtons(detail, draft, busy)}
            </div>
            <p class="edit-note">createdAt ถูกดูแลโดย backend และไม่สามารถแก้ไขได้</p>
          </div>

          ${imagePanel}
        </form>

        <div class="detail-actions">
          <button type="button" class="btn btn--ghost" data-action="modal-cancel-edit" ${busy ? "disabled" : ""}>ยกเลิก</button>
          <button type="button" class="btn btn--primary" data-action="modal-save-edit" ${busy ? "disabled" : ""}>
            ${state.noteModal.saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
          </button>
        </div>
      </div>
    `;
  }

  function renderEditImageActionButtons(detail, draft, busy) {
    const hasOriginalRecord = noteHasOriginalImageRecord(detail);
    if (draft.removeImage) {
      return `<button type="button" class="btn btn--outline btn--sm" data-action="modal-undo-remove-image" ${busy ? "disabled" : ""}>ยกเลิกลบรูป</button>`;
    }

    if (draft.newImage || hasOriginalRecord) {
      return `<button type="button" class="btn btn--danger-soft btn--sm" data-action="modal-remove-edit-image" ${busy ? "disabled" : ""}>ลบรูป</button>`;
    }

    return "";
  }

  function renderEditImagePanel(detail, draft) {
    const preview = resolveEditPreview(detail, draft);
    let frameHtml = "";
    let metaText = "";

    if (draft.compressing) {
      frameHtml = '<div class="detail-image__placeholder"><span class="inline-spinner"><span class="spinner" aria-hidden="true"></span>กำลังบีบอัดรูป...</span></div>';
      metaText = "กำลังประมวลผลรูปภาพ";
    } else if (preview.kind === "new" && preview.dataUrl) {
      frameHtml = `<img src="${escapeAttribute(preview.dataUrl)}" alt="ตัวอย่างรูปใหม่">`;
      metaText = buildCompressionStatsText(preview.stats);
    } else if (preview.kind === "remove") {
      frameHtml = '<div class="detail-image__placeholder"><strong>รูปจะถูกลบ</strong>กดบันทึกเพื่อยืนยันการลบรูป</div>';
      metaText = "removeImage = true";
    } else if (preview.kind === "original" && preview.dataUrl) {
      frameHtml = `<img src="${escapeAttribute(preview.dataUrl)}" alt="รูปเดิมของ NOTE">`;
      metaText = detail.imageFileId ? `รูปเดิม (imageFileId: ${detail.imageFileId})` : "รูปเดิม";
    } else if (preview.kind === "missing") {
      frameHtml = `<div class="detail-image__placeholder"><strong>โหลดรูปเดิมไม่ได้</strong>${escapeHtml(preview.message)}</div>`;
      metaText = detail.imageFileId ? `imageFileId: ${detail.imageFileId}` : "รูปเดิมอาจถูกลบ";
    } else {
      frameHtml = '<div class="detail-image__placeholder">ยังไม่มีรูปภาพแนบ</div>';
      metaText = "สามารถแนบรูปใหม่ได้";
    }

    return `
      <div class="detail-image">
        <div class="detail-image__frame">${frameHtml}</div>
        <div class="detail-image__meta">${escapeHtml(metaText)}</div>
      </div>
    `;
  }

  function resolveEditPreview(detail, draft) {
    if (draft.newImage) {
      return {
        kind: "new",
        dataUrl: draft.newImage.dataUrl,
        stats: draft.newImage.stats,
      };
    }
    if (draft.removeImage) {
      return { kind: "remove" };
    }

    const imageState = state.noteModal.image;
    if (imageState.status === "loaded" && imageState.dataUrl) {
      return { kind: "original", dataUrl: imageState.dataUrl };
    }
    if (noteHasOriginalImageRecord(detail)) {
      if (imageState.status === "missing") {
        return { kind: "missing", message: imageState.message || "รูปอาจถูกลบหรือหมดอายุ" };
      }
      if (detail.imageDataUrl) {
        return { kind: "original", dataUrl: detail.imageDataUrl };
      }
      if (imageState.status === "loading") {
        return { kind: "missing", message: "รูปเดิมกำลังโหลดอยู่ ลองรอสักครู่" };
      }
      return { kind: "missing", message: "รูปเดิมไม่พร้อมแสดงผล แต่ยังสามารถลบหรือแทนที่ได้" };
    }

    return { kind: "none" };
  }

  function noteHasOriginalImageRecord(detail) {
    return Boolean(detail && detail.imageFileId && !detail.imageDeleted);
  }

  function handleNoteModalClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (!action) return;

    if (action === "close-note-modal") {
      closeNoteModal();
      return;
    }

    if (action === "modal-enter-edit") {
      enterNoteEditMode();
      return;
    }

    if (action === "modal-cancel-edit") {
      cancelNoteEditMode();
      return;
    }

    if (action === "modal-pick-edit-image") {
      const input = dom.noteModalBody.querySelector("#modal-edit-image-input");
      if (input && !input.disabled) {
        input.click();
      }
      return;
    }

    if (action === "modal-remove-edit-image") {
      syncNoteModalDraftFromInputs();
      const draft = state.noteModal.editDraft;
      if (!draft) return;
      if (draft.newImage) {
        draft.newImage = null;
        if (!noteHasOriginalImageRecord(state.noteModal.detail)) {
          draft.removeImage = false;
        }
      } else if (noteHasOriginalImageRecord(state.noteModal.detail)) {
        draft.removeImage = true;
      }
      renderNoteModal();
      return;
    }

    if (action === "modal-undo-remove-image") {
      syncNoteModalDraftFromInputs();
      if (state.noteModal.editDraft) {
        state.noteModal.editDraft.removeImage = false;
      }
      renderNoteModal();
      return;
    }

    if (action === "modal-save-edit") {
      void submitNoteEdit();
      return;
    }

    if (action === "modal-request-done") {
      const noteId = actionEl.dataset.noteId || state.noteModal.noteId;
      if (noteId) {
        openConfirmModal(String(noteId));
      }
    }
  }

  function handleNoteModalInput(event) {
    if (state.noteModal.mode !== "edit" || !state.noteModal.editDraft) return;

    if (event.target && event.target.id === "modal-edit-title") {
      state.noteModal.editDraft.title = event.target.value;
      event.target.classList.remove("is-invalid");
      return;
    }

    if (event.target && event.target.id === "modal-edit-description") {
      state.noteModal.editDraft.description = event.target.value;
      event.target.classList.remove("is-invalid");
    }
  }

  async function handleNoteModalChange(event) {
    if (event.target && event.target.id === "modal-edit-image-input") {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        showToast("error", "กรุณาเลือกไฟล์รูปภาพเท่านั้น");
        return;
      }

      syncNoteModalDraftFromInputs();
      const draft = state.noteModal.editDraft;
      if (!draft) return;

      draft.compressing = true;
      renderNoteModal();

      try {
        const compressed = await compressImageFile(file);
        if (!state.noteModal.editDraft) return;
        state.noteModal.editDraft.newImage = {
          dataUrl: compressed.dataUrl,
          imageName: compressed.imageName,
          imageMimeType: compressed.imageMimeType,
          stats: compressed.stats,
        };
        state.noteModal.editDraft.removeImage = false;
        showToast("success", "เตรียมรูปใหม่สำหรับแก้ไขแล้ว");
      } catch (error) {
        showToast("error", `บีบอัดรูปไม่สำเร็จ: ${getErrorMessage(error)}`);
      } finally {
        if (state.noteModal.editDraft) {
          state.noteModal.editDraft.compressing = false;
        }
        renderNoteModal();
      }
    }
  }

  function syncNoteModalDraftFromInputs() {
    if (state.noteModal.mode !== "edit" || !state.noteModal.editDraft) return;
    const titleEl = dom.noteModalBody.querySelector("#modal-edit-title");
    const descEl = dom.noteModalBody.querySelector("#modal-edit-description");
    if (titleEl) state.noteModal.editDraft.title = titleEl.value;
    if (descEl) state.noteModal.editDraft.description = descEl.value;
  }

  async function submitNoteEdit() {
    if (state.noteModal.saving) return;
    if (!state.noteModal.detail || !state.noteModal.editDraft) return;

    syncNoteModalDraftFromInputs();
    const draft = state.noteModal.editDraft;
    const title = (draft.title || "").trim();
    const description = (draft.description || "").trim();

    const titleEl = dom.noteModalBody.querySelector("#modal-edit-title");
    const descEl = dom.noteModalBody.querySelector("#modal-edit-description");
    let invalid = false;

    if (!title) {
      if (titleEl) titleEl.classList.add("is-invalid");
      invalid = true;
    }
    if (!description) {
      if (descEl) descEl.classList.add("is-invalid");
      invalid = true;
    }

    if (invalid) {
      showToast("error", "กรุณากรอกหัวข้อและรายละเอียดให้ครบ");
      return;
    }

    state.noteModal.saving = true;
    renderNoteModal();

    try {
      const data = { title, description };
      if (draft.newImage) {
        data.imageDataUrl = draft.newImage.dataUrl;
        data.imageName = draft.newImage.imageName;
        data.imageMimeType = draft.newImage.imageMimeType;
      }
      if (draft.removeImage && !draft.newImage) {
        data.removeImage = true;
      }

      await apiPost("updateNote", {
        noteId: state.noteModal.noteId,
        data,
      });

      showToast("success", "บันทึกการแก้ไขเรียบร้อย");

      state.noteModal.saving = false;
      state.noteModal.mode = "view";
      state.noteModal.editDraft = null;

      await Promise.all([refreshPendingNotes(), refreshDoneNotes()]);
      await loadNoteDetail(state.noteModal.noteId);
    } catch (error) {
      state.noteModal.saving = false;
      renderNoteModal();
      showToast("error", `อัปเดต NOTE ไม่สำเร็จ: ${getErrorMessage(error)}`);
    }
  }

  function openConfirmModal(noteId) {
    const note = getLocalNoteById(noteId);
    state.confirm.open = true;
    state.confirm.noteId = String(noteId);
    state.confirm.busy = false;

    dom.confirmTitle.textContent = note ? note.title || "(ไม่มีหัวข้อ)" : `NOTE ID: ${noteId}`;
    dom.confirmMeta.textContent = note
      ? `สร้างเมื่อ ${formatDateTime(note.createdAt) || "-"}`
      : `noteId: ${noteId}`;

    renderConfirmModalState();
    showModalElements(dom.confirmBackdrop, dom.confirmShell);
    dom.confirmShell.setAttribute("aria-hidden", "false");
    dom.confirmBackdrop.setAttribute("aria-hidden", "false");
    syncBodyScrollLock();
  }

  function handleConfirmCancel() {
    if (state.confirm.busy) return;
    closeConfirmModal();
  }

  function closeConfirmModal() {
    if (!state.confirm.open) return;
    state.confirm.open = false;
    state.confirm.busy = false;
    state.confirm.noteId = "";
    renderConfirmModalState();
    hideModalElements(dom.confirmBackdrop, dom.confirmShell);
    dom.confirmShell.setAttribute("aria-hidden", "true");
    dom.confirmBackdrop.setAttribute("aria-hidden", "true");
    syncBodyScrollLock();
  }

  function renderConfirmModalState() {
    dom.btnConfirmCancel.disabled = state.confirm.busy;
    dom.btnConfirmSubmit.disabled = state.confirm.busy;
    dom.btnConfirmSubmit.textContent = state.confirm.busy ? "กำลังยืนยัน..." : "ยืนยัน";
  }

  async function handleConfirmSubmit() {
    if (state.confirm.busy) return;
    if (!state.confirm.noteId) return;

    state.confirm.busy = true;
    renderConfirmModalState();

    const noteId = state.confirm.noteId;

    try {
      await apiPost("markNoteDone", { noteId });

      state.pendingNotes = state.pendingNotes.filter((note) => String(note.noteId) !== String(noteId));
      renderList("pending");

      if (state.noteModal.open && String(state.noteModal.noteId) === String(noteId)) {
        closeNoteModal();
      }

      closeConfirmModal();
      showToast("success", "ย้าย NOTE ไป History แล้ว");

      await Promise.all([refreshPendingNotes(), refreshDoneNotes()]);
    } catch (error) {
      state.confirm.busy = false;
      renderConfirmModalState();
      showToast("error", `Checklist ไม่สำเร็จ: ${getErrorMessage(error)}`);
    }
  }

  function handleGlobalKeydown(event) {
    if (event.key !== "Escape") return;

    if (state.confirm.open) {
      if (!state.confirm.busy) closeConfirmModal();
      return;
    }
    if (state.noteModal.open) {
      closeNoteModal();
      return;
    }
    if (state.addPage.open) {
      closeAddPage();
      return;
    }
    if (state.sidebar.open) {
      closeHistoryPanel();
    }
  }

  function syncBodyScrollLock() {
    const shouldLock =
      state.sidebar.open || state.noteModal.open || state.confirm.open || state.addPage.open;
    dom.body.classList.toggle("no-scroll", shouldLock);
  }

  function showModalElements(backdrop, shell) {
    backdrop.classList.remove("hidden");
    shell.classList.remove("hidden");
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      shell.classList.add("is-open");
    });
  }

  function hideModalElements(backdrop, shell) {
    backdrop.classList.remove("is-open");
    shell.classList.remove("is-open");
    window.setTimeout(() => {
      if (!backdrop.classList.contains("is-open")) backdrop.classList.add("hidden");
      if (!shell.classList.contains("is-open")) shell.classList.add("hidden");
    }, CONFIG.modalTransitionMs);
  }

  async function apiGet(action, params = {}) {
    const url = new URL(API_BASE);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    return requestJson(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  }

  async function apiPost(action, payload = {}) {
    return requestJson(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action,
        payload,
      }),
    });
  }

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error("เชื่อมต่อ API ไม่ได้");
    }

    const contentType = response.headers.get("content-type") || "";
    let parsed;
    if (contentType.includes("application/json")) {
      try {
        parsed = await response.json();
      } catch (error) {
        parsed = null;
      }
    } else {
      const text = await response.text();
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (error) {
        parsed = { rawText: text };
      }
    }

    if (!response.ok) {
      throw new Error(extractApiError(parsed) || `HTTP ${response.status}`);
    }

    if (parsed && typeof parsed === "object") {
      const explicitFailure =
        parsed.ok === false ||
        parsed.success === false ||
        parsed.status === "error" ||
        parsed.error === true;

      if (explicitFailure) {
        throw new Error(extractApiError(parsed) || "API ตอบกลับ error");
      }
    }

    return parsed ?? {};
  }

  function extractApiError(payload) {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
    if (payload.error && typeof payload.error.message === "string") return payload.error.message;
    if (typeof payload.statusMessage === "string") return payload.statusMessage;
    if (typeof payload.rawText === "string" && payload.rawText.trim()) return payload.rawText.trim();
    return "";
  }

  function extractHealthText(response) {
    if (!response) return "";
    if (typeof response.message === "string") return response.message;
    if (response.data && typeof response.data.message === "string") return response.data.message;
    if (typeof response.status === "string" && response.status.toLowerCase() === "ok") return "API: Healthy";
    return "";
  }

  function extractNoteArray(response) {
    if (Array.isArray(response)) return response;

    const candidates = [
      response && response.data,
      response && response.notes,
      response && response.items,
      response && response.result,
      response && response.data && response.data.notes,
      response && response.data && response.data.items,
      response && response.data && response.data.result,
    ];

    for (const item of candidates) {
      if (Array.isArray(item)) return item;
    }

    return [];
  }

  function extractNoteDetail(response) {
    if (!response) return null;
    if (response.note && typeof response.note === "object") return response.note;
    if (response.data && response.data.note && typeof response.data.note === "object") return response.data.note;
    if (response.data && typeof response.data === "object" && !Array.isArray(response.data)) return response.data;
    if (response.result && typeof response.result === "object") return response.result;
    if (typeof response === "object" && !Array.isArray(response)) return response;
    return null;
  }

  function extractImageDataUrl(response) {
    if (!response) return "";
    if (typeof response.dataUrl === "string") return response.dataUrl;
    if (typeof response.imageDataUrl === "string") return response.imageDataUrl;
    if (response.data && typeof response.data.dataUrl === "string") return response.data.dataUrl;
    if (response.data && typeof response.data.imageDataUrl === "string") return response.data.imageDataUrl;
    if (response.result && typeof response.result.dataUrl === "string") return response.result.dataUrl;
    return "";
  }

  function normalizeNote(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const note = {
      noteId: coalesce(
        source.noteId,
        source.noteID,
        source.id,
        source.note_id,
        source.rowId,
        source.rowID
      ),
      title: String(coalesce(source.title, source.noteTitle, source.subject, "") || ""),
      description: String(
        coalesce(source.description, source.noteDescription, source.detail, source.desc, "") || ""
      ),
      status: normalizeStatus(coalesce(source.status, source.noteStatus, source.state, "")),
      createdAt: coalesce(source.createdAt, source.createdDate, source.created_date, source.timestamp, ""),
      checkedAt: coalesce(source.checkedAt, source.doneAt, source.completedAt, source.checked_date, ""),
      imageFileId: String(
        coalesce(
          source.imageFileId,
          source.fileId,
          source.image_file_id,
          source.image && source.image.fileId,
          ""
        ) || ""
      ),
      imageDeleted: Boolean(
        coalesce(
          source.imageDeleted,
          source.isImageDeleted,
          source.imageRemoved,
          source.image && source.image.deleted,
          false
        )
      ),
      imageName: String(coalesce(source.imageName, source.image && source.image.name, "") || ""),
      imageMimeType: String(coalesce(source.imageMimeType, source.image && source.image.mimeType, "") || ""),
      imageDataUrl: String(coalesce(source.imageDataUrl, source.image && source.image.dataUrl, "") || ""),
      raw: source,
    };

    if (!note.status) {
      note.status = note.checkedAt ? "DONE" : "PENDING";
    }

    note.noteId = note.noteId === null || note.noteId === undefined ? "" : String(note.noteId);
    return note;
  }

  function getLocalNoteById(noteId) {
    const target = String(noteId);
    return [...state.pendingNotes, ...state.doneNotes].find((note) => String(note.noteId) === target) || null;
  }

  function normalizeStatus(status) {
    return String(status || "").trim().toUpperCase();
  }

  function coalesce(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  }

  async function compressImageFile(file) {
    const originalDataUrl = await readFileAsDataUrl(file);
    const img = await loadImageElement(originalDataUrl);

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;
    if (!originalWidth || !originalHeight) {
      throw new Error("ไม่สามารถอ่านขนาดรูปภาพได้");
    }

    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    const longSide = Math.max(originalWidth, originalHeight);

    if (longSide > CONFIG.imageMaxLongSide) {
      const scale = CONFIG.imageMaxLongSide / longSide;
      targetWidth = Math.max(1, Math.round(originalWidth * scale));
      targetHeight = Math.max(1, Math.round(originalHeight * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("เบราว์เซอร์ไม่รองรับ canvas");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL("image/jpeg", CONFIG.imageQuality);
    const compressedSize = estimateDataUrlBytes(dataUrl);
    const imageName = forceJpegFileName(file.name || "note-image");

    return {
      dataUrl,
      imageName,
      imageMimeType: "image/jpeg",
      stats: {
        originalSize: file.size,
        compressedSize,
        originalWidth,
        originalHeight,
        outputWidth: targetWidth,
        outputHeight: targetHeight,
      },
    };
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("โหลดรูปภาพไม่สำเร็จ"));
      image.src = src;
    });
  }

  function estimateDataUrlBytes(dataUrl) {
    const base64 = (dataUrl.split(",")[1] || "").replace(/=+$/, "");
    return Math.floor((base64.length * 3) / 4);
  }

  function forceJpegFileName(fileName) {
    const base = String(fileName || "image")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80);
    return `${base || "image"}.jpg`;
  }

  function buildCompressionStatsText(stats) {
    if (!stats) return "ไม่มีข้อมูลการบีบอัด";
    const ratio = stats.originalSize > 0 ? (stats.compressedSize / stats.originalSize) * 100 : 0;
    return [
      `ก่อนบีบอัด ${formatBytes(stats.originalSize)} (${stats.originalWidth}x${stats.originalHeight})`,
      `หลังบีบอัด ${formatBytes(stats.compressedSize)} (${stats.outputWidth}x${stats.outputHeight})`,
      `คิดเป็น ${ratio ? ratio.toFixed(1) : "0.0"}%`,
    ].join(" | ");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function toLocalDateInputValue(value) {
    const date = parseDate(value);
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function toTimestamp(value) {
    const date = parseDate(value);
    return date ? date.getTime() : 0;
  }

  function clipText(text, maxLength) {
    const clean = String(text || "").trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function buildImageLoadPlaceholderMessage(error) {
    const message = getErrorMessage(error);
    if (/expire|expired|delete|deleted|not found|missing/i.test(message)) {
      return "รูปหมดอายุหรือถูกลบแล้ว";
    }
    return message || "ไม่สามารถโหลดรูปภาพได้";
  }

  function setGlobalLoading(isLoading, text = "กำลังโหลดข้อมูล...") {
    if (isLoading) {
      dom.globalLoadingText.textContent = text;
      dom.globalLoading.classList.remove("hidden");
      return;
    }
    dom.globalLoading.classList.add("hidden");
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent || "";
      }
      button.textContent = busyLabel || "กำลังดำเนินการ...";
      button.disabled = true;
      return;
    }
    if (button.dataset.defaultLabel) {
      button.textContent = button.dataset.defaultLabel;
    }
    button.disabled = false;
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function showToast(type, message, duration = CONFIG.toastDurationMs) {
    const toast = document.createElement("div");
    toast.id = `toast-${++toastCounter}`;
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <div class="toast__text">${escapeHtml(String(message || ""))}</div>
      <button type="button" class="toast__close" aria-label="ปิดข้อความแจ้งเตือน">&times;</button>
    `;

    const closeButton = toast.querySelector(".toast__close");
    const closeToast = () => dismissToast(toast);
    closeButton.addEventListener("click", closeToast);

    dom.toastStack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-open"));
    window.setTimeout(closeToast, duration);
  }

  function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.classList.remove("is-open");
    window.setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, CONFIG.overlayTransitionMs);
  }

  function getErrorMessage(error) {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    if (error instanceof Error && error.message) return error.message;
    return "เกิดข้อผิดพลาด";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
