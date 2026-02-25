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
    emptyDescriptionSentinel: "\u200B",
    syncStorageKey: "note_checker_sync_queue_v1",
    syncRetryBaseMs: 8000,
    syncRetryMaxMs: 60000,
  };

  const state = {
    rawPendingNotes: [],
    rawDoneNotes: [],
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
      pending: { search: "", dateFrom: "", dateTo: "", sort: "OLDEST" },
      done: { search: "", dateFrom: "", dateTo: "", sort: "NEWEST" },
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
    sync: {
      queue: [],
      processing: false,
      timerId: null,
    },
  };

  const dom = {};
  let toastCounter = 0;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    bindEvents();
    updateTopbarScrollState();
    loadSyncQueueFromStorage();
    renderSyncHeader();
    renderAddImagePreview();
    rebuildVisibleNotesFromSources();
    renderList("pending");
    renderList("done");

    if (!isApiConfigured()) {
      setApiStatus("warn", "API: โปรดตั้งค่า API_BASE ใน assets/app.js");
      showToast("warn", "แก้ค่า API_BASE ให้เป็น Cloudflare Worker URL ก่อนใช้งานจริง");
      return;
    }

    await bootstrap();
    void processSyncQueue({ reason: "post-bootstrap" });
  }

  function cacheDom() {
    dom.body = document.body;
    dom.topbar = document.querySelector(".topbar");

    dom.apiStatus = document.getElementById("api-status");
    dom.apiStatusText = document.getElementById("api-status-text");
    dom.syncStatus = document.getElementById("sync-status");
    dom.syncStatusText = document.getElementById("sync-status-text");
    dom.btnRefreshAll = document.getElementById("btn-refresh-all");
    dom.btnRetrySync = document.getElementById("btn-retry-sync");
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
    dom.pendingDateFrom = document.getElementById("pending-date-from");
    dom.pendingDateTo = document.getElementById("pending-date-to");
    dom.pendingSort = document.getElementById("pending-sort");
    dom.btnPendingClearFilters = document.getElementById("btn-pending-clear-filters");
    dom.pendingCount = document.getElementById("pending-count");
    dom.pendingList = document.getElementById("pending-list");

    dom.historyBackdrop = document.getElementById("history-backdrop");
    dom.historyPanel = document.getElementById("history-panel");
    dom.btnCloseHistory = document.getElementById("btn-close-history");
    dom.historySearch = document.getElementById("history-search");
    dom.historyDateFrom = document.getElementById("history-date-from");
    dom.historyDateTo = document.getElementById("history-date-to");
    dom.historySort = document.getElementById("history-sort");
    dom.btnHistoryClearFilters = document.getElementById("btn-history-clear-filters");
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
    const handlePendingSearchRender = debounce(() => {
      renderList("pending");
    }, CONFIG.searchDebounceMs);

    const handleHistorySearchRender = debounce(() => {
      renderList("done");
    }, CONFIG.searchDebounceMs);

    dom.btnRefreshAll.addEventListener("click", handleRefreshAll);
    dom.btnRetrySync.addEventListener("click", () => {
      void processSyncQueue({ manual: true, reason: "manual-retry" });
    });
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

    dom.pendingSearch.addEventListener("input", (event) => {
      state.filters.pending.search = event.target.value.trim();
      handlePendingSearchRender();
    });
    dom.pendingDateFrom.addEventListener("change", (event) => {
      state.filters.pending.dateFrom = event.target.value;
      renderList("pending");
    });
    dom.pendingDateTo.addEventListener("change", (event) => {
      state.filters.pending.dateTo = event.target.value;
      renderList("pending");
    });
    dom.pendingSort.addEventListener("change", (event) => {
      state.filters.pending.sort = event.target.value;
      renderList("pending");
    });
    dom.btnPendingClearFilters.addEventListener("click", () => resetFilters("pending"));

    dom.historySearch.addEventListener("input", (event) => {
      state.filters.done.search = event.target.value.trim();
      handleHistorySearchRender();
    });
    dom.historyDateFrom.addEventListener("change", (event) => {
      state.filters.done.dateFrom = event.target.value;
      renderList("done");
    });
    dom.historyDateTo.addEventListener("change", (event) => {
      state.filters.done.dateTo = event.target.value;
      renderList("done");
    });
    dom.historySort.addEventListener("change", (event) => {
      state.filters.done.sort = event.target.value;
      renderList("done");
    });
    dom.btnHistoryClearFilters.addEventListener("click", () => resetFilters("done"));

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
    window.addEventListener("scroll", updateTopbarScrollState, { passive: true });
    window.addEventListener("online", () => {
      void processSyncQueue({ manual: true, reason: "browser-online" });
    });
  }

  function updateTopbarScrollState() {
    if (!dom.topbar) return;
    dom.topbar.classList.toggle("is-scrolled", window.scrollY > 8);
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
      state.rawPendingNotes = notes
        .filter((note) => note.noteId)
        .filter((note) => normalizeStatus(note.status || "PENDING") !== "DONE");
      rebuildVisibleNotesFromSources();
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
      state.rawDoneNotes = notes
        .filter((note) => note.noteId)
        .map((note) => ({ ...note, status: "DONE" }));
      rebuildVisibleNotesFromSources();
      setApiStatus("online", "API: พร้อมใช้งาน");
    } catch (error) {
      state.errors.done = getErrorMessage(error);
      showToast("error", `โหลด History ไม่สำเร็จ: ${state.errors.done}`);
    } finally {
      state.loading.done = false;
      renderList("done");
    }
  }

  function loadSyncQueueFromStorage() {
    state.sync.queue = [];

    let raw = "";
    try {
      raw = window.localStorage.getItem(CONFIG.syncStorageKey) || "";
    } catch (error) {
      return;
    }

    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      state.sync.queue = parsed
        .map((item) => sanitizeSyncQueueItem(item))
        .filter(Boolean);
    } catch (error) {
      console.warn("Failed to parse sync queue", error);
    }
  }

  function saveSyncQueueToStorage() {
    try {
      if (!state.sync.queue.length) {
        window.localStorage.removeItem(CONFIG.syncStorageKey);
        return;
      }
      window.localStorage.setItem(CONFIG.syncStorageKey, JSON.stringify(state.sync.queue));
    } catch (error) {
      console.warn("Failed to save sync queue", error);
      showToast("error", "บันทึกคิวในเครื่องไม่สำเร็จ (พื้นที่ localStorage อาจเต็ม)");
    }
  }

  function sanitizeSyncQueueItem(item) {
    if (!item || typeof item !== "object") return null;
    if (!item.type || !item.id) return null;

    return {
      id: String(item.id),
      type: String(item.type),
      status: item.status === "failed" ? "failed" : "pending",
      attempts: Number(item.attempts || 0),
      createdAtMs: Number(item.createdAtMs || Date.now()),
      nextRetryAtMs: Number(item.nextRetryAtMs || 0),
      error: String(item.error || ""),
      payload: item.payload && typeof item.payload === "object" ? item.payload : {},
      localNote: item.localNote && typeof item.localNote === "object" ? item.localNote : null,
      meta: item.meta && typeof item.meta === "object" ? item.meta : {},
    };
  }

  function enqueueSyncOperation(operation) {
    const item = sanitizeSyncQueueItem({
      id: operation.id || `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: operation.type,
      status: operation.status || "pending",
      attempts: operation.attempts || 0,
      createdAtMs: operation.createdAtMs || Date.now(),
      nextRetryAtMs: operation.nextRetryAtMs || 0,
      error: operation.error || "",
      payload: operation.payload || {},
      localNote: operation.localNote || null,
      meta: operation.meta || {},
    });

    if (!item) return null;

    state.sync.queue.push(item);
    saveSyncQueueToStorage();
    rebuildVisibleNotesFromSources();
    return item;
  }

  function removeSyncQueueItem(queueId) {
    const before = state.sync.queue.length;
    state.sync.queue = state.sync.queue.filter((item) => item.id !== queueId);
    if (state.sync.queue.length !== before) {
      saveSyncQueueToStorage();
      rebuildVisibleNotesFromSources();
    }
  }

  function updateSyncQueueItem(queueId, patch = {}) {
    const target = state.sync.queue.find((item) => item.id === queueId);
    if (!target) return null;
    Object.assign(target, patch);
    saveSyncQueueToStorage();
    rebuildVisibleNotesFromSources();
    return target;
  }

  function rebuildVisibleNotesFromSources() {
    const pending = state.rawPendingNotes.map(cloneNoteForUi);
    const done = state.rawDoneNotes.map(cloneNoteForUi);

    const queue = state.sync.queue
      .slice()
      .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

    for (const item of queue) {
      applySyncOverlayToLists(item, pending, done);
    }

    state.pendingNotes = pending;
    state.doneNotes = done;

    if (state.noteModal.open && state.noteModal.mode !== "edit" && state.noteModal.noteId) {
      const liveNote = getLocalNoteById(state.noteModal.noteId);
      if (liveNote) {
        state.noteModal.detail = { ...(state.noteModal.detail || {}), ...liveNote };
        if (liveNote.__localImageDataUrl) {
          state.noteModal.image = {
            status: "loaded",
            dataUrl: liveNote.__localImageDataUrl,
            message: "",
          };
        }
        renderNoteModal();
      }
    }

    if (dom.pendingList && dom.historyList) {
      renderList("pending");
      renderList("done");
    }

    renderSyncHeader();
  }

  function cloneNoteForUi(note) {
    return { ...(note || {}) };
  }

  function applySyncOverlayToLists(item, pending, done) {
    const status = item.status === "syncing" ? "syncing" : item.status === "failed" ? "failed" : "pending";

    if (item.type === "create") {
      const localNote = buildLocalNoteFromQueueItem(item);
      if (!localNote) return;
      markNoteWithSyncState(localNote, item, status);
      upsertNoteInList(pending, localNote);
      removeNoteFromList(done, localNote.noteId);
      return;
    }

    if (item.type === "update") {
      const noteId = String(item.payload && item.payload.noteId || "");
      if (!noteId) return;
      const target = findNoteInLists(pending, done, noteId);
      if (!target) return;

      const data = item.payload.data && typeof item.payload.data === "object" ? item.payload.data : {};
      if (Object.prototype.hasOwnProperty.call(data, "title")) {
        target.title = String(data.title || "");
      }
      if (Object.prototype.hasOwnProperty.call(data, "description")) {
        target.description = decodeDescriptionFromBackend(String(data.description || ""));
      }
      if (data.removeImage === true && !data.imageDataUrl && !data.imageBase64) {
        target.imageFileId = "";
        target.imageName = "";
        target.imageMimeType = "";
        target.__localImageDataUrl = "";
      }
      if (data.imageDataUrl) {
        target.__localImageDataUrl = String(data.imageDataUrl);
        target.imageMimeType = String(data.imageMimeType || target.imageMimeType || "image/jpeg");
        target.imageName = String(data.imageName || target.imageName || "");
      }
      markNoteWithSyncState(target, item, status);
      return;
    }

    if (item.type === "markDone") {
      const noteId = String(item.payload && item.payload.noteId || "");
      if (!noteId) return;

      let note = removeNoteFromList(pending, noteId);
      if (!note) {
        note = findNoteInList(done, noteId);
        if (!note && item.localNote) {
          note = cloneNoteForUi(item.localNote);
        }
      }
      if (!note) return;

      note.status = "DONE";
      note.checkedAt = note.checkedAt || item.meta.checkedAt || new Date(item.createdAtMs).toISOString();
      markNoteWithSyncState(note, item, status);
      upsertNoteInList(done, note);
      return;
    }
  }

  function buildLocalNoteFromQueueItem(item) {
    if (item.localNote && typeof item.localNote === "object") {
      return cloneNoteForUi(item.localNote);
    }

    const payload = item.payload || {};
    const createdAt = new Date(item.createdAtMs || Date.now());
    return {
      noteId: String(item.meta && item.meta.localNoteId || item.id),
      title: String(payload.title || ""),
      description: decodeDescriptionFromBackend(String(payload.description || "")),
      imageFileId: "",
      imageUrl: "",
      imageMimeType: String(payload.imageMimeType || ""),
      imageName: String(payload.imageName || ""),
      status: "PENDING",
      createdAt: createdAt.toISOString(),
      createdDate: toLocalDateInputValue(createdAt),
      checkedAt: "",
      updatedAt: "",
      imageDeletedAt: "",
      hasImage: Boolean(payload.imageDataUrl),
      isImageDeleted: false,
      __localOnly: true,
      __localImageDataUrl: String(payload.imageDataUrl || ""),
    };
  }

  function createOptimisticLocalNoteForCreate(payload) {
    const now = new Date();
    return {
      noteId: `local-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      title: String(payload.title || ""),
      description: decodeDescriptionFromBackend(String(payload.description || "")),
      imageFileId: "",
      imageUrl: "",
      imageMimeType: String(payload.imageMimeType || ""),
      imageName: String(payload.imageName || ""),
      status: "PENDING",
      createdAt: now.toISOString(),
      createdDate: toLocalDateInputValue(now),
      checkedAt: "",
      updatedAt: "",
      imageDeletedAt: "",
      hasImage: Boolean(payload.imageDataUrl),
      isImageDeleted: false,
      __localOnly: true,
      __localImageDataUrl: String(payload.imageDataUrl || ""),
    };
  }

  function markNoteWithSyncState(note, queueItem, syncState) {
    note.__syncQueueId = queueItem.id;
    note.__syncState = syncState;
    note.__syncError = String(queueItem.error || "");
    note.__syncAttempts = Number(queueItem.attempts || 0);
    if (queueItem.type === "create") {
      note.__localOnly = true;
    }
    return note;
  }

  function clearNoteSyncState(note) {
    if (!note) return note;
    delete note.__syncQueueId;
    delete note.__syncState;
    delete note.__syncError;
    delete note.__syncAttempts;
    delete note.__localOnly;
    delete note.__localImageDataUrl;
    return note;
  }

  function findNoteInList(list, noteId) {
    return list.find((note) => String(note.noteId) === String(noteId)) || null;
  }

  function findNoteInLists(pending, done, noteId) {
    return findNoteInList(pending, noteId) || findNoteInList(done, noteId);
  }

  function upsertNoteInList(list, note) {
    const idx = list.findIndex((item) => String(item.noteId) === String(note.noteId));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...note };
      return list[idx];
    }
    list.push(note);
    return note;
  }

  function removeNoteFromList(list, noteId) {
    const idx = list.findIndex((item) => String(item.noteId) === String(noteId));
    if (idx < 0) return null;
    const [removed] = list.splice(idx, 1);
    return removed || null;
  }

  function renderSyncHeader() {
    if (!dom.syncStatus || !dom.syncStatusText || !dom.btnRetrySync) return;

    const total = state.sync.queue.length;
    const syncing = state.sync.queue.filter((item) => item.status === "syncing").length;
    const failed = state.sync.queue.filter((item) => item.status === "failed").length;

    let stateName = "idle";
    let text = "Sync: ไม่มีคิวค้าง";

    if (total > 0 && state.sync.processing) {
      stateName = "syncing";
      text = `Sync: กำลังส่ง ${syncing || 1}/${total} รายการ`;
    } else if (failed > 0) {
      stateName = "error";
      text = `Sync: ค้างส่ง ${failed} รายการ (รวม ${total})`;
    } else if (total > 0) {
      stateName = "pending";
      text = `Sync: รอส่ง ${total} รายการ`;
    }

    dom.syncStatus.dataset.state = stateName;
    dom.syncStatusText.textContent = text;

    if (total > 0) {
      dom.btnRetrySync.classList.remove("hidden");
      dom.btnRetrySync.textContent = failed > 0 ? `ส่งคิวอีกครั้ง (${failed})` : `Sync คิว (${total})`;
      dom.btnRetrySync.disabled = state.sync.processing;
    } else {
      dom.btnRetrySync.classList.add("hidden");
      dom.btnRetrySync.disabled = false;
      dom.btnRetrySync.textContent = "ส่งคิวอีกครั้ง";
    }
  }

  function clearSyncRetryTimer() {
    if (!state.sync.timerId) return;
    window.clearTimeout(state.sync.timerId);
    state.sync.timerId = null;
  }

  function scheduleSyncRetry() {
    clearSyncRetryTimer();
    if (!state.sync.queue.length) return;

    const now = Date.now();
    const dueItems = state.sync.queue.filter((item) => item.status !== "syncing");
    if (!dueItems.length) return;

    const earliest = dueItems.reduce((min, item) => {
      const t = Number(item.nextRetryAtMs || 0);
      if (!min) return t;
      return t && t < min ? t : min;
    }, 0);

    const delay = earliest && earliest > now ? Math.min(Math.max(earliest - now, 250), CONFIG.syncRetryMaxMs) : 250;
    state.sync.timerId = window.setTimeout(() => {
      state.sync.timerId = null;
      void processSyncQueue({ reason: "auto-retry" });
    }, delay);
  }

  function buildRetryDelayMs(attempts) {
    const exp = Math.max(0, Number(attempts || 1) - 1);
    return Math.min(CONFIG.syncRetryBaseMs * (2 ** exp), CONFIG.syncRetryMaxMs);
  }

  function getNextSyncQueueItem(options = {}) {
    const now = Date.now();
    const manual = Boolean(options.manual);
    const excludeIds = options.excludeIds instanceof Set ? options.excludeIds : null;

    return state.sync.queue.find((item) => {
      if (excludeIds && excludeIds.has(item.id)) return false;
      if (item.status === "syncing") return false;
      if (manual) return true;
      const nextTime = Number(item.nextRetryAtMs || 0);
      return !nextTime || nextTime <= now;
    }) || null;
  }

  async function processSyncQueue(options = {}) {
    if (state.sync.processing) return;
    if (!isApiConfigured()) {
      renderSyncHeader();
      return;
    }
    if (!state.sync.queue.length) {
      renderSyncHeader();
      return;
    }

    state.sync.processing = true;
    renderSyncHeader();

    try {
      const processedIds = new Set();
      let nextItem = getNextSyncQueueItem({ ...options, excludeIds: processedIds });
      while (nextItem) {
        processedIds.add(nextItem.id);
        nextItem.status = "syncing";
        nextItem.error = "";
        saveSyncQueueToStorage();
        rebuildVisibleNotesFromSources();

        try {
          await syncQueueItemToApi(nextItem);
          removeSyncQueueItem(nextItem.id);
        } catch (error) {
          nextItem.status = "failed";
          nextItem.attempts = Number(nextItem.attempts || 0) + 1;
          nextItem.error = getErrorMessage(error);
          nextItem.nextRetryAtMs = Date.now() + buildRetryDelayMs(nextItem.attempts);
          saveSyncQueueToStorage();
          rebuildVisibleNotesFromSources();
          showToast("error", `ส่งคิวไม่สำเร็จ (เก็บไว้ในเครื่อง): ${nextItem.error}`);
        }

        nextItem = getNextSyncQueueItem({ ...options, excludeIds: processedIds });
      }
    } finally {
      state.sync.processing = false;
      renderSyncHeader();
      scheduleSyncRetry();
    }
  }

  async function syncQueueItemToApi(queueItem) {
    if (queueItem.type === "create") {
      const response = await apiPost("createNote", queueItem.payload || {});
      const rawItem = extractNoteDetail(response);
      const note = normalizeNote(rawItem || {});
      if (!note.noteId) {
        throw new Error("API createNote ไม่ส่ง noteId กลับมา");
      }

      const localNoteId =
        String((queueItem.meta && queueItem.meta.localNoteId) || (queueItem.localNote && queueItem.localNote.noteId) || "");
      if (state.noteModal.open && localNoteId && String(state.noteModal.noteId) === localNoteId) {
        state.noteModal.noteId = String(note.noteId);
      }

      clearNoteSyncState(note);
      state.rawPendingNotes = state.rawPendingNotes.filter((n) => String(n.noteId) !== String(note.noteId));
      state.rawPendingNotes.push(note);
      rebuildVisibleNotesFromSources();
      showToast("success", "บันทึกแล้ว");
      return;
    }

    if (queueItem.type === "update") {
      const payload = queueItem.payload || {};
      const response = await apiPost("updateNote", payload);
      const rawItem = extractNoteDetail(response);

      if (rawItem) {
        const note = normalizeNote(rawItem);
        if (note.noteId) {
          state.rawPendingNotes = state.rawPendingNotes.filter((n) => String(n.noteId) !== String(note.noteId));
          state.rawDoneNotes = state.rawDoneNotes.filter((n) => String(n.noteId) !== String(note.noteId));
          if (normalizeStatus(note.status || "PENDING") === "DONE") {
            state.rawDoneNotes.push({ ...note, status: "DONE" });
          } else {
            state.rawPendingNotes.push({ ...note, status: "PENDING" });
          }
        }
      }

      rebuildVisibleNotesFromSources();
      showToast("success", "บันทึกแล้ว");
      return;
    }

    if (queueItem.type === "markDone") {
      const payload = queueItem.payload || {};
      const noteId = String(payload.noteId || "");
      const response = await apiPost("markNoteDone", payload);
      const rawItem = extractNoteDetail(response);
      const note = normalizeNote(rawItem || { noteId, status: "DONE" });

      state.rawPendingNotes = state.rawPendingNotes.filter((n) => String(n.noteId) !== String(noteId));
      state.rawDoneNotes = state.rawDoneNotes.filter((n) => String(n.noteId) !== String(noteId));
      if (note.noteId) {
        state.rawDoneNotes.push({ ...note, status: "DONE" });
      }

      rebuildVisibleNotesFromSources();
      showToast("success", "บันทึกสถานะแล้ว");
      return;
    }

    throw new Error(`Unknown sync queue item type: ${queueItem.type}`);
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
    const descriptionForApi = encodeDescriptionForBackend(description);
    let invalid = false;

    if (!title) {
      dom.addTitle.classList.add("is-invalid");
      invalid = true;
    }
    if (invalid) {
      showToast("error", "กรุณากรอกหัวข้อ");
      return;
    }

    state.addForm.saving = true;
    setButtonBusy(dom.btnAddSubmit, true, "กำลังบันทึก...");
    renderAddImagePreview();

    try {
      const payload = { title, description: descriptionForApi };
      if (state.addForm.image) {
        payload.imageDataUrl = state.addForm.image.dataUrl;
        payload.imageName = state.addForm.image.imageName;
        payload.imageMimeType = state.addForm.image.imageMimeType;
      }

      const localNote = createOptimisticLocalNoteForCreate(payload);
      enqueueSyncOperation({
        type: "create",
        payload,
        localNote,
        meta: {
          localNoteId: localNote.noteId,
        },
      });
      showToast("success", "บันทึกในเครื่องแล้ว กำลังส่งขึ้นระบบ...");

      dom.addNoteForm.reset();
      clearAddFormImage({ silent: true });
      dom.addTitle.classList.remove("is-invalid");
      dom.addDescription.classList.remove("is-invalid");

      closeAddPage({ force: true });
      void processSyncQueue({ reason: "create-note-submit" });
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
    renderFilterControls(scope);

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
    let dateFrom = filters.dateFrom || "";
    let dateTo = filters.dateTo || "";
    const sort = filters.sort || (isDoneScope ? "NEWEST" : "OLDEST");

    if (dateFrom && dateTo && dateFrom > dateTo) {
      const tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }

    const filtered = notes.filter((note) => {
      if (search) {
        const haystack = `${note.title} ${note.description}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      const noteDate = toLocalDateInputValue(note.createdAt);
      if (dateFrom && (!noteDate || noteDate < dateFrom)) return false;
      if (dateTo && (!noteDate || noteDate > dateTo)) return false;
      return true;
    });

    filtered.sort((a, b) => compareNotes(a, b, sort));
    return filtered;
  }

  function renderFilterControls(scope) {
    const isDoneScope = scope === "done";
    const filters = isDoneScope ? state.filters.done : state.filters.pending;
    const button = isDoneScope ? dom.btnHistoryClearFilters : dom.btnPendingClearFilters;
    if (!button) return;

    const defaultSort = isDoneScope ? "NEWEST" : "OLDEST";
    const hasActive =
      Boolean((filters.search || "").trim()) ||
      Boolean(filters.dateFrom) ||
      Boolean(filters.dateTo) ||
      String(filters.sort || defaultSort) !== defaultSort;

    button.disabled = !hasActive;
    button.classList.toggle("is-active", hasActive);
  }

  function resetFilters(scope) {
    const isDoneScope = scope === "done";
    const filters = isDoneScope ? state.filters.done : state.filters.pending;
    const defaultSort = isDoneScope ? "NEWEST" : "OLDEST";

    filters.search = "";
    filters.dateFrom = "";
    filters.dateTo = "";
    filters.sort = defaultSort;

    if (isDoneScope) {
      if (dom.historySearch) dom.historySearch.value = "";
      if (dom.historyDateFrom) dom.historyDateFrom.value = "";
      if (dom.historyDateTo) dom.historyDateTo.value = "";
      if (dom.historySort) dom.historySort.value = defaultSort;
      renderList("done");
    } else {
      if (dom.pendingSearch) dom.pendingSearch.value = "";
      if (dom.pendingDateFrom) dom.pendingDateFrom.value = "";
      if (dom.pendingDateTo) dom.pendingDateTo.value = "";
      if (dom.pendingSort) dom.pendingSort.value = defaultSort;
      renderList("pending");
    }
  }

  function compareNotes(a, b, sort) {
    const aTitle = (a.title || "").toLocaleLowerCase();
    const bTitle = (b.title || "").toLocaleLowerCase();
    const timeA = toTimestamp(a.createdAt);
    const timeB = toTimestamp(b.createdAt);

    switch (sort) {
      case "NEWEST":
        return timeB - timeA || aTitle.localeCompare(bTitle, "th");
      case "OLDEST":
      default:
        return timeA - timeB || aTitle.localeCompare(bTitle, "th");
    }
  }

  function renderNoteCard(note, scope) {
    const isPending = scope === "pending";
    const hasImage = (Boolean(note.imageFileId) && !note.imageDeleted) || Boolean(note.__localImageDataUrl);
    const createdAt = formatDateTime(note.createdAt) || "-";
    const checkedAt = note.checkedAt ? formatDateTime(note.checkedAt) : "";
    const status = normalizeStatus(note.status || (isPending ? "PENDING" : "DONE"));
    const desc = clipText(note.description || "-", 120);
    const syncState = String(note.__syncState || "");
    const syncMetaText = buildNoteSyncMetaText(note);
    const checklistDisabled = Boolean(note.__localOnly);

    return `
      <li class="note-card">
        <div>
          <div class="note-card__header">
            <h3 class="note-card__title">${escapeHtml(note.title || "(ไม่มีหัวข้อ)")}</h3>
            <div class="inline-row">
              <span class="chip ${status === "DONE" ? "chip--done" : "chip--pending"}">${escapeHtml(status)}</span>
              ${
                syncState
                  ? `<span class="chip ${syncState === "failed" ? "chip--warn" : "chip--pending"}">${escapeHtml(syncState === "syncing" ? "SYNCING" : syncState === "failed" ? "RETRY" : "QUEUED")}</span>`
                  : ""
              }
            </div>
          </div>
          <p class="note-card__desc">${escapeHtml(desc)}</p>
          <div class="note-card__meta">
            <span class="note-card__meta-item">สร้าง: ${escapeHtml(createdAt)}</span>
            ${checkedAt ? `<span class="note-card__meta-item">เสร็จ: ${escapeHtml(checkedAt)}</span>` : ""}
            ${hasImage ? '<span class="note-card__meta-item">มีรูป</span>' : ""}
            ${syncMetaText ? `<span class="note-card__meta-item">${escapeHtml(syncMetaText)}</span>` : ""}
          </div>
        </div>
        <div class="note-card__actions">
          <button type="button" class="btn btn--outline btn--sm" data-action="view-detail" data-note-id="${escapeAttribute(note.noteId)}">ดูรายละเอียด</button>
          ${
            isPending
              ? `<button type="button" class="btn btn--success btn--sm" data-action="request-done" data-note-id="${escapeAttribute(note.noteId)}" ${checklistDisabled ? "disabled" : ""}>Checklist</button>`
              : ""
          }
        </div>
      </li>
    `;
  }

  function buildNoteSyncMetaText(note) {
    const stateName = String(note.__syncState || "");
    if (!stateName) return "";
    if (stateName === "syncing") return "กำลังส่ง...";
    if (stateName === "failed") return `ค้างส่ง (${Number(note.__syncAttempts || 0)})`;
    if (stateName === "pending") return "รอส่ง";
    return "";
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
    const localNote = getLocalNoteById(noteId);
    const localHasImageRecord = Boolean(localNote && localNote.imageFileId && !localNote.imageDeleted);
    state.noteModal.loading = true;
    state.noteModal.error = "";
    state.noteModal.detail = localNote || null;
    if (localNote && localNote.__localImageDataUrl) {
      state.noteModal.image = {
        status: "loaded",
        dataUrl: localNote.__localImageDataUrl,
        message: "",
      };
    } else if (localHasImageRecord) {
      state.noteModal.image = { status: "loading", dataUrl: "", message: "" };
    } else {
      state.noteModal.image = { status: localNote ? "none" : "idle", dataUrl: "", message: "" };
    }
    renderNoteModal();

    if (localNote && localNote.__localOnly) {
      state.noteModal.loading = false;
      if (localNote.__localImageDataUrl) {
        state.noteModal.image = {
          status: "loaded",
          dataUrl: localNote.__localImageDataUrl,
          message: "",
        };
      } else {
        state.noteModal.image = { status: "none", dataUrl: "", message: "" };
      }
      renderNoteModal();
      return;
    }

    try {
      const response = await apiGet("getNoteDetail", { noteId });
      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;

      const rawDetail = extractNoteDetail(response);
      const detail = normalizeNote(rawDetail || getLocalNoteById(noteId) || {});
      if (!detail.noteId) detail.noteId = String(noteId);
      const overlayNote = getLocalNoteById(noteId);
      state.noteModal.detail = overlayNote ? { ...detail, ...overlayNote } : detail;
      state.noteModal.error = "";
      state.noteModal.loading = false;

      if (state.noteModal.detail.__localImageDataUrl) {
        state.noteModal.image = {
          status: "loaded",
          dataUrl: state.noteModal.detail.__localImageDataUrl,
          message: "",
        };
      } else if (detail.imageDataUrl) {
        state.noteModal.image = { status: "loaded", dataUrl: detail.imageDataUrl, message: "" };
      } else if (detail.imageFileId && !detail.imageDeleted) {
        state.noteModal.image = { status: "loading", dataUrl: "", message: "" };
      } else {
        state.noteModal.image = { status: "none", dataUrl: "", message: "" };
      }

      renderNoteModal();

      if (
        detail.imageFileId &&
        !detail.imageDeleted &&
        !detail.imageDataUrl &&
        !state.noteModal.detail.__localImageDataUrl
      ) {
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
      </div>
    `;
  }

  function renderNoteModalView(detail) {
    const status = normalizeStatus(detail.status || "PENDING");
    const isPending = status !== "DONE";
    const isLocalOnly = Boolean(detail.__localOnly);
    const createdAt = formatDateTime(detail.createdAt) || "-";
    const checkedAt = detail.checkedAt ? formatDateTime(detail.checkedAt) : "-";
    const syncMetaText = buildNoteSyncMetaText(detail);
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
            ${
              syncMetaText
                ? `<div class="detail-row">
                     <span class="detail-row__label">sync</span>
                     <div class="detail-row__value">${escapeHtml(syncMetaText)}${detail.__syncError ? ` (${escapeHtml(detail.__syncError)})` : ""}</div>
                   </div>`
                : ""
            }
            <div class="detail-row detail-row--full">
              <span class="detail-row__label">รายละเอียด</span>
              <div class="detail-row__value preserve-linebreak">${escapeHtml(detail.description || "-")}</div>
            </div>
          </div>
        </div>

        ${imageBlock || ""}

        <div class="detail-actions">
          ${
            isPending && !isLocalOnly
              ? `<button type="button" class="btn btn--outline" data-action="modal-enter-edit">แก้ไข</button>
                 <button type="button" class="btn btn--success" data-action="modal-request-done" data-note-id="${escapeAttribute(detail.noteId || "")}">Checklist เสร็จแล้ว</button>`
              : ""
          }
          ${
            isPending && isLocalOnly
              ? `<span class="badge badge--subtle">รอ sync ให้เสร็จก่อน จึงแก้ไข/Checklist ได้</span>`
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
    const localPreview = String(detail.__localImageDataUrl || "");

    if (localPreview) {
      return `
        <div class="detail-image">
          <div class="detail-image__frame">
            <img src="${escapeAttribute(localPreview)}" alt="รูปภาพประกอบ NOTE (local preview)">
          </div>
          <div class="detail-image__meta">แสดงตัวอย่างรูปจากเครื่อง (รอ sync)</div>
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

    if (hasImageRecord && (imageState.status === "loading" || imageState.status === "idle")) {
      return `
        <div class="detail-image">
          <div class="detail-image__frame">
            <div class="inline-spinner"><span class="spinner" aria-hidden="true"></span>กำลังโหลดรูปภาพ...</div>
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

    return "";
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
            <span class="field__label">รายละเอียด (ไม่บังคับ)</span>
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
    const descriptionForApi = encodeDescriptionForBackend(description);

    const titleEl = dom.noteModalBody.querySelector("#modal-edit-title");
    const descEl = dom.noteModalBody.querySelector("#modal-edit-description");
    let invalid = false;

    if (!title) {
      if (titleEl) titleEl.classList.add("is-invalid");
      invalid = true;
    }
    if (invalid) {
      showToast("error", "กรุณากรอกหัวข้อ");
      return;
    }

    state.noteModal.saving = true;
    renderNoteModal();

    try {
      const data = { title, description: descriptionForApi };
      if (draft.newImage) {
        data.imageDataUrl = draft.newImage.dataUrl;
        data.imageName = draft.newImage.imageName;
        data.imageMimeType = draft.newImage.imageMimeType;
      }
      if (draft.removeImage && !draft.newImage) {
        data.removeImage = true;
      }

      enqueueSyncOperation({
        type: "update",
        payload: {
          noteId: state.noteModal.noteId,
          data,
        },
      });

      showToast("success", "อัปเดตในเครื่องแล้ว กำลังส่งขึ้นระบบ...");

      state.noteModal.saving = false;
      state.noteModal.mode = "view";
      state.noteModal.editDraft = null;
      rebuildVisibleNotesFromSources();
      renderNoteModal();
      void processSyncQueue({ reason: "update-note-submit" });
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
      const noteSnapshot = getLocalNoteById(noteId);
      if (noteSnapshot && noteSnapshot.__localOnly) {
        throw new Error("รายการนี้ยังซิงก์ไม่เสร็จ กรุณารอให้บันทึกขึ้นระบบก่อน");
      }

      enqueueSyncOperation({
        type: "markDone",
        payload: { noteId },
        localNote: noteSnapshot ? cloneNoteForUi(noteSnapshot) : null,
        meta: {
          checkedAt: new Date().toISOString(),
        },
      });

      if (state.noteModal.open && String(state.noteModal.noteId) === String(noteId)) {
        closeNoteModal();
      }

      closeConfirmModal();
      showToast("success", "ย้ายในเครื่องแล้ว กำลังส่งอัปเดตสถานะ...");
      void processSyncQueue({ reason: "mark-done-submit" });
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
    const isObjectPayload = payload && typeof payload === "object" && !Array.isArray(payload);
    const requestBody = isObjectPayload
      ? { action, ...payload, payload }
      : { action, payload };

    return requestJson(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
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
    if (response.item && typeof response.item === "object") return response.item;
    if (response.note && typeof response.note === "object") return response.note;
    if (response.data && response.data.item && typeof response.data.item === "object") return response.data.item;
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
    if (response.item && typeof response.item.dataUrl === "string") return response.item.dataUrl;
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
      description: decodeDescriptionFromBackend(
        String(coalesce(source.description, source.noteDescription, source.detail, source.desc, "") || "")
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

  function encodeDescriptionForBackend(description) {
    const text = String(description || "");
    return text ? text : CONFIG.emptyDescriptionSentinel;
  }

  function decodeDescriptionFromBackend(description) {
    const text = String(description || "");
    if (!text) return "";

    const withoutSentinel = text.replace(/\u200B/g, "");
    if (!withoutSentinel.trim()) {
      return "";
    }
    return withoutSentinel;
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
