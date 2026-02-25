const AUTH_STORAGE_KEY = "NOTE_APP_SESSION_TOKEN";
const AUTH_USER_STORAGE_KEY = "NOTE_APP_CURRENT_USER";
const AUTH_EXPIRES_AT_STORAGE_KEY = "NOTE_APP_SESSION_EXPIRES_AT";
const API_BASE = "https://bold-rain-86f3.surakiat16082000.workers.dev";
const imageMemoryCache = new Map();
const imageInflightCache = new Map();

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
    localCacheKey: "note_checker_local_note_cache_v1",
    cacheDbName: "note_checker_cache_db",
    cacheDbVersion: 1,
    cacheStoreNotes: "notes",
    cacheStoreImages: "images",
    doneImageCacheTtlDays: 7,
    syncRetryBaseMs: 8000,
    syncRetryMaxMs: 60000,
    mobileBreakpoint: 680,
  };

  const state = {
    rawPendingNotes: [],
    rawDoneNotes: [],
    localNoteCache: {},
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
      pending: { search: "", dateFrom: "", dateTo: "", sort: "OLDEST", userFilterMode: "ANY", userId: "" },
      done: {
        search: "",
        dateFrom: "",
        dateTo: "",
        sort: "NEWEST",
        timeField: "CHECKED_AT",
        userFilterMode: "ANY",
        userId: "",
      },
    },
    addForm: {
      saving: false,
      compressing: false,
      image: null,
      visibleRoleFilters: [],
      visibleUserSearch: "",
      visibleToUserIds: [],
    },
    camera: {
      open: false,
      target: "add",
      starting: false,
      capturing: false,
      ready: false,
      error: "",
      stream: null,
    },
    addPage: {
      open: false,
    },
    sideMenu: {
      open: false,
    },
    sidebar: {
      open: false,
      historyFiltersCollapsed: true,
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
    userMgmt: {
      open: false,
      creating: false,
      error: "",
    },
    dashboard: {
      open: false,
      loading: false,
      error: "",
      data: null,
      filters: {
        search: "",
        dateFrom: "",
        dateTo: "",
        dateField: "ANY",
        status: "",
        userFilterMode: "ANY",
        userSearch: "",
        userId: "",
        role: "",
      },
    },
    sync: {
      queue: [],
      processing: false,
      timerId: null,
    },
    // === AUTH PATCH START ===
    auth: {
      token: "",
      user: null,
      users: [],
      expiresAt: "",
      loginOpen: true,
      loginBusy: false,
      loginError: "",
      sessionChecking: false,
      appStarted: false,
      handlingUnauthorized: false,
    },
    // === AUTH PATCH END ===
  };

  const dom = {};
  const cacheRuntime = {
    dbPromise: null,
    cleanupRun: false,
  };
  let toastCounter = 0;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    bindEvents();
    updateTopbarScrollState();
    renderHistoryFilterPanel();
    loadLocalNoteCacheFromStorage();
    void cleanupDoneImageCache(CONFIG.doneImageCacheTtlDays);
    loadSyncQueueFromStorage();
    authLoadSessionCache();
    renderSyncHeader();
    authRenderHeader();
    authRenderLoginOverlay();
    userFilterRenderUserOptions();
    renderAddVisibleUsersControl();
    dashboardRenderControls();
    dashboardRender();
    renderAddImagePreview();
    rebuildVisibleNotesFromSources();
    renderList("pending");
    renderList("done");

    if (!isApiConfigured()) {
      setApiStatus("warn", "API: โปรดตั้งค่า API_BASE ใน assets/app.js");
      authSetLoginState({ loginOpen: true, loginError: "ยังไม่ได้ตั้งค่า API_BASE" });
      showToast("warn", "แก้ค่า API_BASE ให้เป็น Cloudflare Worker URL ก่อนใช้งานจริง");
      return;
    }

    if (authGetToken()) {
      authSetLoginState({ loginOpen: false, loginBusy: false, sessionChecking: false, loginError: "" });
      if (state.auth.user) {
        await authStartAppFlow({ reason: "startup-saved-session" });
        void validateSessionSilently();
        return;
      }
      const isAuthReady = await authInitializeSession();
      if (!isAuthReady) return;
      await authStartAppFlow({ reason: "startup" });
      return;
    }

    authSetLoginState({ loginOpen: true, loginBusy: false, sessionChecking: false, loginError: "" });
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
    dom.sideMenuBackdrop = document.getElementById("side-menu-backdrop");
    dom.sideMenuPanel = document.getElementById("side-menu-panel");
    dom.btnOpenSideMenu = document.getElementById("btn-open-side-menu");
    dom.btnCloseSideMenu = document.getElementById("btn-close-side-menu");
    dom.btnOpenDashboard = document.getElementById("btn-open-dashboard");
    dom.btnOpenUserMgmt = document.getElementById("btn-open-user-mgmt");
    dom.btnAuthLogout = document.getElementById("btn-auth-logout");
    dom.btnOpenHistory = document.getElementById("btn-open-history");
    dom.btnOpenAddPage = document.getElementById("btn-open-add-page");
    dom.authUserBox = document.getElementById("auth-user-box");
    dom.authDisplayName = document.getElementById("auth-display-name");
    dom.authRoleBadge = document.getElementById("auth-role-badge");
    dom.authLoginOverlay = document.getElementById("auth-login-overlay");
    dom.authLoginForm = document.getElementById("auth-login-form");
    dom.authUsername = document.getElementById("auth-username");
    dom.authPassword = document.getElementById("auth-password");
    dom.authLoginError = document.getElementById("auth-login-error");
    dom.btnAuthLogin = document.getElementById("btn-auth-login");

    dom.addPageBackdrop = document.getElementById("add-page-backdrop");
    dom.addPageShell = document.getElementById("add-page-shell");
    dom.btnCloseAddPage = document.getElementById("btn-close-add-page");

    dom.addNoteForm = document.getElementById("add-note-form");
    dom.addTitle = document.getElementById("add-title");
    dom.addDescription = document.getElementById("add-description");
    dom.addVisibleUsersField = document.getElementById("add-visible-users-field");
    dom.addVisibleUsersHint = document.getElementById("add-visible-users-hint");
    dom.addVisibleRoles = document.getElementById("add-visible-roles");
    dom.addVisibleUserSearch = document.getElementById("add-visible-user-search");
    dom.addVisibleUsersCountBadge = document.getElementById("add-visible-users-count-badge");
    dom.addVisibleToUserIds = document.getElementById("add-visible-to-user-ids");
    dom.addImageInput = document.getElementById("add-image-input");
    dom.btnAddPickImage = document.getElementById("btn-add-pick-image");
    dom.btnAddOpenCamera = document.getElementById("btn-add-open-camera");
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
    dom.pendingUserFilterMode = document.getElementById("pending-user-filter-mode");
    dom.pendingUserId = document.getElementById("pending-user-id");
    dom.pendingUserFilterModeField = document.getElementById("pending-user-filter-mode-field");
    dom.pendingUserIdField = document.getElementById("pending-user-id-field");
    dom.btnPendingClearFilters = document.getElementById("btn-pending-clear-filters");
    dom.pendingCount = document.getElementById("pending-count");
    dom.pendingList = document.getElementById("pending-list");

    dom.historyBackdrop = document.getElementById("history-backdrop");
    dom.historyPanel = document.getElementById("history-panel");
    dom.btnCloseHistory = document.getElementById("btn-close-history");
    dom.btnToggleHistoryFilters = document.getElementById("btn-toggle-history-filters");
    dom.historyControls = document.getElementById("history-controls");
    dom.historySearch = document.getElementById("history-search");
    dom.historyDateFrom = document.getElementById("history-date-from");
    dom.historyDateTo = document.getElementById("history-date-to");
    dom.historyTimeField = document.getElementById("history-time-field");
    dom.historySort = document.getElementById("history-sort");
    dom.historyUserFilterMode = document.getElementById("history-user-filter-mode");
    dom.historyUserId = document.getElementById("history-user-id");
    dom.btnHistoryClearFilters = document.getElementById("btn-history-clear-filters");
    dom.historyCount = document.getElementById("history-count");
    dom.historyList = document.getElementById("history-list");

    dom.dashboardBackdrop = document.getElementById("dashboard-backdrop");
    dom.dashboardShell = document.getElementById("dashboard-shell");
    dom.btnCloseDashboard = document.getElementById("btn-close-dashboard");
    dom.dashboardSearch = document.getElementById("dashboard-search");
    dom.dashboardDateFrom = document.getElementById("dashboard-date-from");
    dom.dashboardDateTo = document.getElementById("dashboard-date-to");
    dom.dashboardDateField = document.getElementById("dashboard-date-field");
    dom.dashboardStatus = document.getElementById("dashboard-status");
    dom.dashboardUserFilterMode = document.getElementById("dashboard-user-filter-mode");
    dom.dashboardUserSearch = document.getElementById("dashboard-user-search");
    dom.dashboardUserId = document.getElementById("dashboard-user-id");
    dom.dashboardRole = document.getElementById("dashboard-role");
    dom.dashboardUserField = document.getElementById("dashboard-user-field");
    dom.dashboardRoleField = document.getElementById("dashboard-role-field");
    dom.btnDashboardClearFilters = document.getElementById("btn-dashboard-clear-filters");
    dom.btnDashboardRefresh = document.getElementById("btn-dashboard-refresh");
    dom.dashboardError = document.getElementById("dashboard-error");
    dom.dashboardTotalNotes = document.getElementById("dashboard-total-notes");
    dom.dashboardPendingNotes = document.getElementById("dashboard-pending-notes");
    dom.dashboardDoneNotes = document.getElementById("dashboard-done-notes");
    dom.dashboardUsersCount = document.getElementById("dashboard-users-count");
    dom.dashboardByStatus = document.getElementById("dashboard-by-status");
    dom.dashboardByRole = document.getElementById("dashboard-by-role");
    dom.dashboardByUser = document.getElementById("dashboard-by-user");

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
    dom.userMgmtBackdrop = document.getElementById("user-mgmt-backdrop");
    dom.userMgmtShell = document.getElementById("user-mgmt-shell");
    dom.userMgmtForm = document.getElementById("user-mgmt-form");
    dom.userMgmtUsername = document.getElementById("user-mgmt-username");
    dom.userMgmtPassword = document.getElementById("user-mgmt-password");
    dom.userMgmtDisplayName = document.getElementById("user-mgmt-display-name");
    dom.userMgmtRole = document.getElementById("user-mgmt-role");
    dom.userMgmtIsActive = document.getElementById("user-mgmt-is-active");
    dom.userMgmtError = document.getElementById("user-mgmt-error");
    dom.btnUserMgmtClose = document.getElementById("btn-user-mgmt-close");
    dom.btnUserMgmtCancel = document.getElementById("btn-user-mgmt-cancel");
    dom.btnUserMgmtSubmit = document.getElementById("btn-user-mgmt-submit");

    dom.cameraBackdrop = document.getElementById("camera-backdrop");
    dom.cameraShell = document.getElementById("camera-shell");
    dom.btnCameraClose = document.getElementById("btn-camera-close");
    dom.btnCameraCancel = document.getElementById("btn-camera-cancel");
    dom.btnCameraCapture = document.getElementById("btn-camera-capture");
    dom.cameraVideo = document.getElementById("camera-video");
    dom.cameraEmptyState = document.getElementById("camera-empty-state");
    dom.cameraEmptyText = document.getElementById("camera-empty-text");
    dom.cameraStatusBadge = document.getElementById("camera-status-badge");

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
    if (dom.btnOpenSideMenu) {
      dom.btnOpenSideMenu.addEventListener("click", openSideMenu);
    }
    if (dom.btnCloseSideMenu) {
      dom.btnCloseSideMenu.addEventListener("click", closeSideMenu);
    }
    if (dom.sideMenuBackdrop) {
      dom.sideMenuBackdrop.addEventListener("click", closeSideMenu);
    }
    if (dom.btnOpenDashboard) {
      dom.btnOpenDashboard.addEventListener("click", () => {
        closeSideMenu();
        void openDashboardModal();
      });
    }
    if (dom.authLoginForm) {
      dom.authLoginForm.addEventListener("submit", (event) => {
        void authHandleLoginSubmit(event);
      });
    }
    if (dom.btnAuthLogout) {
      dom.btnAuthLogout.addEventListener("click", () => {
        closeSideMenu();
        void authLogout({ source: "manual" });
      });
    }
    if (dom.btnOpenUserMgmt) {
      dom.btnOpenUserMgmt.addEventListener("click", () => {
        closeSideMenu();
        openUserMgmtModal();
      });
    }
    dom.btnOpenAddPage.addEventListener("click", openAddPage);
    dom.btnOpenHistory.addEventListener("click", openHistoryPanel);
    dom.btnCloseHistory.addEventListener("click", closeHistoryPanel);
    if (dom.btnToggleHistoryFilters) {
      dom.btnToggleHistoryFilters.addEventListener("click", toggleHistoryFilters);
    }
    dom.historyBackdrop.addEventListener("click", closeHistoryPanel);
    if (dom.dashboardBackdrop) dom.dashboardBackdrop.addEventListener("click", closeDashboardModal);
    if (dom.btnCloseDashboard) dom.btnCloseDashboard.addEventListener("click", closeDashboardModal);

    dom.addPageBackdrop.addEventListener("click", () => closeAddPage());
    dom.btnCloseAddPage.addEventListener("click", () => closeAddPage());
    dom.btnAddCancel.addEventListener("click", () => closeAddPage());

    dom.addNoteForm.addEventListener("submit", handleAddNoteSubmit);
    dom.addTitle.addEventListener("input", () => dom.addTitle.classList.remove("is-invalid"));
    dom.addDescription.addEventListener("input", () => dom.addDescription.classList.remove("is-invalid"));
    if (dom.addVisibleRoles) {
      dom.addVisibleRoles.addEventListener("change", () => {
        const allowedRoles = getAllowedVisibilityRolesForCurrentRole();
        state.addForm.visibleRoleFilters = normalizeVisibleRoleFiltersInput(
          getSelectedValuesFromSelect(dom.addVisibleRoles),
          allowedRoles
        );
        renderAddVisibleUsersControl();
      });
    }
    if (dom.addVisibleUserSearch) {
      dom.addVisibleUserSearch.addEventListener("input", (event) => {
        state.addForm.visibleUserSearch = String(event.target.value || "");
        renderAddVisibleUsersControl();
      });
    }
    if (dom.addVisibleToUserIds) {
      dom.addVisibleToUserIds.addEventListener("change", () => {
        const roleUsers = getFilteredAssignableUsersForRoles(state.addForm.visibleRoleFilters);
        const visibleUsers = filterVisibilityUsersBySearch(roleUsers, state.addForm.visibleUserSearch);
        const selection = readVisibilityUserSelectionFromSelect(dom.addVisibleToUserIds, visibleUsers);
        state.addForm.visibleToUserIds = mergeVisibilityUserSelectionKeepingHidden(
          state.addForm.visibleToUserIds,
          selection.userIds,
          visibleUsers
        );
        if (selection.usedSelectAll) {
          renderAddVisibleUsersControl();
          return;
        }
        renderAddVisibleUsersSelectionBadge();
      });
    }
    dom.btnAddPickImage.addEventListener("click", () => dom.addImageInput.click());
    if (dom.btnAddOpenCamera) {
      dom.btnAddOpenCamera.addEventListener("click", () => void openCameraModal("add"));
    }
    dom.btnAddRemoveImage.addEventListener("click", clearAddFormImage);
    dom.addImageInput.addEventListener("change", handleAddImageChange);

    if (dom.cameraBackdrop) dom.cameraBackdrop.addEventListener("click", () => closeCameraModal());
    if (dom.btnCameraClose) dom.btnCameraClose.addEventListener("click", () => closeCameraModal());
    if (dom.btnCameraCancel) dom.btnCameraCancel.addEventListener("click", () => closeCameraModal());
    if (dom.btnCameraCapture) dom.btnCameraCapture.addEventListener("click", () => void captureCameraPhoto());

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
    if (dom.pendingUserFilterMode) {
      dom.pendingUserFilterMode.addEventListener("change", (event) => {
        state.filters.pending.userFilterMode = userFilterNormalizeMode(event.target.value);
        if (state.filters.pending.userId) {
          void refreshPendingNotes();
          return;
        }
        renderFilterControls("pending");
      });
    }
    if (dom.pendingUserId) {
      dom.pendingUserId.addEventListener("change", (event) => {
        state.filters.pending.userId = String(event.target.value || "");
        void refreshPendingNotes();
      });
    }
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
    if (dom.historyTimeField) {
      dom.historyTimeField.addEventListener("change", (event) => {
        state.filters.done.timeField = normalizeDoneHistoryTimeField(event.target.value);
        renderList("done");
      });
    }
    dom.historySort.addEventListener("change", (event) => {
      state.filters.done.sort = event.target.value;
      renderList("done");
    });
    if (dom.historyUserFilterMode) {
      dom.historyUserFilterMode.addEventListener("change", (event) => {
        state.filters.done.userFilterMode = userFilterNormalizeMode(event.target.value);
        if (state.filters.done.userId) {
          void refreshDoneNotes();
          return;
        }
        renderFilterControls("done");
      });
    }
    if (dom.historyUserId) {
      dom.historyUserId.addEventListener("change", (event) => {
        state.filters.done.userId = String(event.target.value || "");
        void refreshDoneNotes();
      });
    }
    dom.btnHistoryClearFilters.addEventListener("click", () => resetFilters("done"));

    if (dom.dashboardSearch) {
      const handleDashboardSearchRender = debounce(() => {
        void refreshDashboardSummary({ silent: true });
      }, CONFIG.searchDebounceMs);
      dom.dashboardSearch.addEventListener("input", (event) => {
        state.dashboard.filters.search = String(event.target.value || "").trim();
        handleDashboardSearchRender();
      });
    }
    if (dom.dashboardDateFrom) {
      dom.dashboardDateFrom.addEventListener("change", (event) => {
        state.dashboard.filters.dateFrom = String(event.target.value || "");
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.dashboardDateTo) {
      dom.dashboardDateTo.addEventListener("change", (event) => {
        state.dashboard.filters.dateTo = String(event.target.value || "");
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.dashboardDateField) {
      dom.dashboardDateField.addEventListener("change", (event) => {
        state.dashboard.filters.dateField = dashboardNormalizeDateField(event.target.value);
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.dashboardStatus) {
      dom.dashboardStatus.addEventListener("change", (event) => {
        state.dashboard.filters.status = String(event.target.value || "");
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.dashboardUserFilterMode) {
      dom.dashboardUserFilterMode.addEventListener("change", (event) => {
        state.dashboard.filters.userFilterMode = dashboardNormalizeUserFilterMode(event.target.value);
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.dashboardUserSearch) {
      dom.dashboardUserSearch.addEventListener("input", (event) => {
        state.dashboard.filters.userSearch = String(event.target.value || "");
        dashboardRenderControls();
      });
    }
    if (dom.dashboardUserId) {
      dom.dashboardUserId.addEventListener("change", (event) => {
        state.dashboard.filters.userId = String(event.target.value || "");
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.dashboardRole) {
      dom.dashboardRole.addEventListener("change", (event) => {
        state.dashboard.filters.role = dashboardNormalizeRoleFilterValue(event.target.value);
        void refreshDashboardSummary({ silent: true });
      });
    }
    if (dom.btnDashboardClearFilters) {
      dom.btnDashboardClearFilters.addEventListener("click", resetDashboardFilters);
    }
    if (dom.btnDashboardRefresh) {
      dom.btnDashboardRefresh.addEventListener("click", () => void refreshDashboardSummary());
    }

    dom.pendingList.addEventListener("click", (event) => handleListClick(event, "pending"));
    dom.historyList.addEventListener("click", (event) => handleListClick(event, "done"));

    dom.noteModalBackdrop.addEventListener("click", closeNoteModal);
    dom.noteModal.addEventListener("click", handleNoteModalClick);
    dom.noteModal.addEventListener("change", handleNoteModalChange);
    dom.noteModal.addEventListener("input", handleNoteModalInput);

    dom.confirmBackdrop.addEventListener("click", handleConfirmCancel);
    dom.btnConfirmCancel.addEventListener("click", handleConfirmCancel);
    dom.btnConfirmSubmit.addEventListener("click", handleConfirmSubmit);
    if (dom.userMgmtBackdrop) dom.userMgmtBackdrop.addEventListener("click", () => closeUserMgmtModal());
    if (dom.btnUserMgmtClose) dom.btnUserMgmtClose.addEventListener("click", () => closeUserMgmtModal());
    if (dom.btnUserMgmtCancel) dom.btnUserMgmtCancel.addEventListener("click", () => closeUserMgmtModal());
    if (dom.btnUserMgmtSubmit) dom.btnUserMgmtSubmit.addEventListener("click", () => void submitCreateUser());
    if (dom.userMgmtForm) {
      dom.userMgmtForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitCreateUser();
      });
    }

    document.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener("scroll", updateTopbarScrollState, { passive: true });
    window.addEventListener("resize", handleWindowResize, { passive: true });
    window.addEventListener("online", () => {
      void processSyncQueue({ manual: true, reason: "browser-online" });
    });
  }

  function handleWindowResize() {
    renderHistoryFilterPanel();
  }

  function updateTopbarScrollState() {
    if (!dom.topbar) return;
    dom.topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  function isMobileViewport() {
    return window.innerWidth < CONFIG.mobileBreakpoint;
  }

  function renderHistoryFilterPanel() {
    if (!dom.historyPanel || !dom.historyControls || !dom.btnToggleHistoryFilters) return;

    const collapsed = isMobileViewport() ? state.sidebar.historyFiltersCollapsed : false;
    dom.historyPanel.classList.toggle("is-filters-collapsed", collapsed);
    dom.btnToggleHistoryFilters.setAttribute("aria-expanded", String(!collapsed));
    dom.btnToggleHistoryFilters.textContent = collapsed ? "ตัวกรอง" : "ซ่อนตัวกรอง";
  }

  function setHistoryFiltersCollapsed(collapsed) {
    state.sidebar.historyFiltersCollapsed = Boolean(collapsed);
    renderHistoryFilterPanel();
  }

  function toggleHistoryFilters() {
    if (!isMobileViewport()) return;
    setHistoryFiltersCollapsed(!state.sidebar.historyFiltersCollapsed);
  }

  // === AUTH PATCH START ===
  function authGetDefaultStatePatch() {
    return {
      token: "",
      user: null,
      users: [],
      expiresAt: "",
      loginOpen: true,
      loginBusy: false,
      loginError: "",
      sessionChecking: false,
      appStarted: false,
      handlingUnauthorized: false,
    };
  }

  function authNormalizeUser(raw) {
    if (!raw || typeof raw !== "object") return null;
    const userId = String(coalesce(raw.userId, raw.id, raw.uid, raw.user_id, "") || "").trim();
    const username = String(coalesce(raw.username, raw.userName, raw.login, "") || "").trim();
    const displayName = String(coalesce(raw.displayName, raw.name, raw.fullName, username, userId, "") || "").trim();
    const role = String(coalesce(raw.role, raw.userRole, "USER") || "USER").trim().toUpperCase();
    const isActiveMaybe = toMaybeBoolean(coalesce(raw.isActive, raw.active, raw.is_active, ""));

    if (!userId && !username && !displayName) return null;

    return {
      ...raw,
      userId: userId || username || displayName,
      username: username || userId || "",
      displayName: displayName || username || userId || "Unknown",
      role: role === "ADMIN" || role === "SUPERVISOR" ? role : "USER",
      isActive: typeof isActiveMaybe === "boolean" ? isActiveMaybe : true,
    };
  }

  function authLoadSessionCache() {
    const saved = loadSavedSession();
    state.auth.token = String(saved.token || "");
    state.auth.user = saved.user || null;
    state.auth.expiresAt = String(saved.expiresAt || "");
    state.auth.loginOpen = !state.auth.token;
    state.auth.loginBusy = false;
    state.auth.loginError = "";
    state.auth.sessionChecking = false;
  }

  function authSaveSessionCache() {
    saveSession({
      sessionToken: state.auth.token,
      currentUser: state.auth.user,
      expiresAt: state.auth.expiresAt,
    });
  }

  function authSetLoginState(patch = {}) {
    Object.assign(state.auth, patch || {});
    authRenderHeader();
    authRenderLoginOverlay();
  }

  function authRenderHeader() {
    if (dom.authDisplayName) {
      dom.authDisplayName.textContent = state.auth.user && state.auth.user.displayName ? state.auth.user.displayName : "-";
    }
    if (dom.authRoleBadge) {
      const role = authGetRole();
      dom.authRoleBadge.textContent = role;
      dom.authRoleBadge.dataset.role = role;
    }

    const loggedIn = authIsLoggedIn();
    if (dom.authUserBox) {
      dom.authUserBox.classList.toggle("hidden", !loggedIn);
    }
    if (dom.btnAuthLogout) {
      dom.btnAuthLogout.classList.toggle("hidden", !loggedIn);
      dom.btnAuthLogout.disabled = Boolean(state.auth.loginBusy);
    }
    if (dom.btnOpenUserMgmt) {
      dom.btnOpenUserMgmt.classList.toggle("hidden", !(loggedIn && authIsAdmin()));
    }
    if (dom.btnOpenDashboard) {
      dom.btnOpenDashboard.classList.toggle("hidden", !loggedIn);
      dom.btnOpenDashboard.disabled = !loggedIn;
    }
    if (dom.btnOpenSideMenu) {
      dom.btnOpenSideMenu.classList.toggle("hidden", !loggedIn);
      dom.btnOpenSideMenu.disabled = !loggedIn;
    }
  }

  function authRenderLoginOverlay() {
    if (!dom.authLoginOverlay) return;

    const isOpen = Boolean(state.auth.loginOpen);
    dom.authLoginOverlay.classList.toggle("hidden", !isOpen);
    dom.authLoginOverlay.setAttribute("aria-hidden", String(!isOpen));
    syncBodyScrollLock();

    if (dom.btnAuthLogin) {
      dom.btnAuthLogin.disabled = Boolean(state.auth.loginBusy);
      if (!dom.btnAuthLogin.dataset.defaultLabel) {
        dom.btnAuthLogin.dataset.defaultLabel = dom.btnAuthLogin.textContent || "เข้าสู่ระบบ";
      }
      dom.btnAuthLogin.textContent = state.auth.loginBusy
        ? (state.auth.sessionChecking ? "กำลังตรวจสอบ..." : "กำลังเข้าสู่ระบบ...")
        : (dom.btnAuthLogin.dataset.defaultLabel || "เข้าสู่ระบบ");
    }
    if (dom.authUsername) dom.authUsername.disabled = Boolean(state.auth.loginBusy || state.auth.sessionChecking);
    if (dom.authPassword) dom.authPassword.disabled = Boolean(state.auth.loginBusy || state.auth.sessionChecking);

    if (dom.authLoginError) {
      const message = String(state.auth.loginError || "");
      dom.authLoginError.textContent = message;
      dom.authLoginError.classList.toggle("hidden", !message);
    }
  }

  function authGetToken() {
    return String(state.auth.token || "").trim();
  }

  function authIsLoggedIn() {
    return Boolean(authGetToken() && state.auth.user);
  }

  function authGetRole() {
    const role = String((state.auth.user && state.auth.user.role) || "USER").toUpperCase();
    if (role === "ADMIN" || role === "SUPERVISOR") return role;
    return "USER";
  }

  function authIsAdmin() {
    return authGetRole() === "ADMIN";
  }

  function authIsSupervisor() {
    return authGetRole() === "SUPERVISOR";
  }

  function authBuildHeaders(baseHeaders = {}) {
    const headers = { ...(baseHeaders || {}) };
    const token = authGetToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  function authIsUnauthorizedMessage(message, statusCode = 0) {
    if (Number(statusCode) === 401 || Number(statusCode) === 403) return true;
    const msg = String(message || "");
    return /unauthorized|session invalid|session expired|invalid session|หมดอายุ|ไม่ได้รับอนุญาต/i.test(msg);
  }

  async function authHandleUnauthorized(message) {
    if (!authGetToken()) return;
    if (state.auth.handlingUnauthorized) return;

    state.auth.handlingUnauthorized = true;
    try {
      await authLogout({ source: "unauthorized", skipApi: true, silent: true, loginError: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });
      showToast("warn", "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
    } finally {
      state.auth.handlingUnauthorized = false;
    }
  }

  function authExtractSessionToken(response) {
    return String(
      coalesce(
        response && response.sessionToken,
        response && response.token,
        response && response.accessToken,
        response && response.data && response.data.sessionToken,
        response && response.data && response.data.token,
        response && response.result && response.result.sessionToken,
        response && response.result && response.result.token,
        ""
      ) || ""
    ).trim();
  }

  function authExtractExpiresAt(response) {
    return String(
      coalesce(
        response && response.expiresAt,
        response && response.sessionExpiresAt,
        response && response.expireAt,
        response && response.data && (response.data.expiresAt || response.data.sessionExpiresAt),
        response && response.result && (response.result.expiresAt || response.result.sessionExpiresAt),
        ""
      ) || ""
    ).trim();
  }

  function authExtractUserFromResponse(response) {
    const candidate =
      (response && response.user) ||
      (response && response.me) ||
      (response && response.item) ||
      (response && response.data && (response.data.user || response.data.me || response.data.item)) ||
      (response && response.result && (response.result.user || response.result.me || response.result.item)) ||
      (response && response.data && typeof response.data === "object" && !Array.isArray(response.data) ? response.data : null) ||
      (response && response.result && typeof response.result === "object" && !Array.isArray(response.result) ? response.result : null);

    return authNormalizeUser(candidate);
  }

  function authExtractUsers(response) {
    const candidates = [
      response && response.users,
      response && response.items,
      response && response.data && response.data.users,
      response && response.data && response.data.items,
      response && response.result && response.result.users,
      response && response.result && response.result.items,
      response && response.data,
      response && response.result,
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      return candidate.map(authNormalizeUser).filter(Boolean);
    }
    return [];
  }

  async function authInitializeSession() {
    if (!authGetToken()) {
      authSetLoginState({ loginOpen: true, loginBusy: false, sessionChecking: false, loginError: "" });
      return false;
    }

    authSetLoginState({ loginOpen: true, loginBusy: true, sessionChecking: true, loginError: "" });
    try {
      const meResponse = await apiGet("getMe");
      const me = authExtractUserFromResponse(meResponse);
      if (!me) {
        throw new Error("ไม่พบข้อมูลผู้ใช้จาก session");
      }

      state.auth.user = me;
      state.auth.expiresAt = authExtractExpiresAt(meResponse) || state.auth.expiresAt || "";
      state.auth.loginOpen = false;
      state.auth.loginBusy = false;
      state.auth.sessionChecking = false;
      state.auth.loginError = "";
      authSaveSessionCache();
      authRenderHeader();
      authRenderLoginOverlay();
      void authLoadUsers();
      return true;
    } catch (error) {
      if (state.auth.handlingUnauthorized) return false;
      await authLogout({ source: "startup-invalid-session", skipApi: true, silent: true, loginError: "Session ไม่ถูกต้องหรือหมดอายุ" });
      return false;
    }
  }

  async function authHandleLoginSubmit(event) {
    event.preventDefault();
    if (state.auth.loginBusy) return;
    if (!isApiConfigured()) {
      authSetLoginState({ loginOpen: true, loginError: "ยังไม่ได้ตั้งค่า API_BASE" });
      return;
    }

    const username = String((dom.authUsername && dom.authUsername.value) || "").trim();
    const password = String((dom.authPassword && dom.authPassword.value) || "");
    if (!username || !password) {
      authSetLoginState({ loginOpen: true, loginError: "กรุณากรอก username และ password" });
      return;
    }

    authSetLoginState({ loginOpen: true, loginBusy: true, sessionChecking: false, loginError: "" });
    try {
      const loginResponse = await apiPost("login", { username, password });
      const sessionToken = authExtractSessionToken(loginResponse);
      if (!sessionToken) {
        throw new Error("API login ไม่ส่ง sessionToken กลับมา");
      }

      state.auth.token = sessionToken;
      state.auth.user = authExtractUserFromResponse(loginResponse);
      state.auth.expiresAt = authExtractExpiresAt(loginResponse) || state.auth.expiresAt || "";
      authSaveSessionCache();

      if (!state.auth.user) {
        const meResponse = await apiGet("getMe");
        state.auth.user = authExtractUserFromResponse(meResponse);
        state.auth.expiresAt = authExtractExpiresAt(meResponse) || state.auth.expiresAt || "";
      }
      if (!state.auth.user) {
        throw new Error("ไม่สามารถโหลดข้อมูลผู้ใช้ปัจจุบันได้");
      }

      authSaveSessionCache();
      authSetLoginState({ loginOpen: false, loginBusy: false, sessionChecking: false, loginError: "" });
      if (dom.authPassword) dom.authPassword.value = "";
      await authStartAppFlow({ reason: "login-success" });
      showToast("success", `เข้าสู่ระบบแล้ว (${state.auth.user.displayName})`);
    } catch (error) {
      state.auth.token = "";
      state.auth.user = null;
      authSaveSessionCache();
      authSetLoginState({
        loginOpen: true,
        loginBusy: false,
        sessionChecking: false,
        loginError: getErrorMessage(error) || "เข้าสู่ระบบไม่สำเร็จ",
      });
    }
  }

  async function authStartAppFlow(options = {}) {
    if (!authIsLoggedIn()) {
      authSetLoginState({ loginOpen: true });
      return;
    }

    if (!state.auth.appStarted) {
      await bootstrap();
      state.auth.appStarted = true;
    } else {
      await Promise.allSettled([checkApiHealth(), refreshPendingNotes(), refreshDoneNotes()]);
    }

    void authLoadUsers();
    void processSyncQueue({ reason: options.reason || "auth-start-app" });
  }

  async function authLoadUsers() {
    if (!authIsLoggedIn()) {
      state.auth.users = [];
      userFilterRenderUserOptions();
      return;
    }

    try {
      const response = await apiGet("getUsers");
      const users = authExtractUsers(response);
      const currentUser = authNormalizeUser(state.auth.user);
      const mergedMap = new Map();
      if (currentUser) {
        mergedMap.set(String(currentUser.userId), currentUser);
      }
      users.forEach((user) => {
        if (!user) return;
        mergedMap.set(String(user.userId), user);
      });
      state.auth.users = Array.from(mergedMap.values()).sort((a, b) =>
        String(a.displayName || "").localeCompare(String(b.displayName || ""), "th")
      );
    } catch (error) {
      console.warn("getUsers failed", error);
      state.auth.users = state.auth.user ? [state.auth.user] : [];
    } finally {
      userFilterRenderUserOptions();
      renderAddVisibleUsersControl();
      dashboardRenderControls();
      if (state.dashboard.open) {
        void refreshDashboardSummary({ silent: true });
      }
    }
  }

  function loadSavedSession() {
    let sessionToken = "";
    let currentUser = null;
    let expiresAt = "";

    try {
      sessionToken = String(window.localStorage.getItem(AUTH_STORAGE_KEY) || "").trim();
    } catch (error) {
      sessionToken = "";
    }

    try {
      const rawUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY) || "";
      if (rawUser) currentUser = authNormalizeUser(JSON.parse(rawUser));
    } catch (error) {
      currentUser = null;
    }

    try {
      expiresAt = String(window.localStorage.getItem(AUTH_EXPIRES_AT_STORAGE_KEY) || "").trim();
    } catch (error) {
      expiresAt = "";
    }

    return { token: sessionToken, user: currentUser, expiresAt };
  }

  function saveSession(session = {}) {
    const sessionToken = String(session.sessionToken || session.token || "").trim();
    const currentUser = authNormalizeUser(session.currentUser || session.user || null);
    const expiresAt = String(session.expiresAt || "").trim();

    try {
      if (sessionToken) {
        window.localStorage.setItem(AUTH_STORAGE_KEY, sessionToken);
      } else {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save auth token", error);
    }

    try {
      if (currentUser) {
        window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(currentUser));
      } else {
        window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save auth user cache", error);
    }

    try {
      if (expiresAt) {
        window.localStorage.setItem(AUTH_EXPIRES_AT_STORAGE_KEY, expiresAt);
      } else {
        window.localStorage.removeItem(AUTH_EXPIRES_AT_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save auth expiresAt", error);
    }
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      window.localStorage.removeItem(AUTH_EXPIRES_AT_STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to clear auth session cache", error);
    }
  }

  async function validateSessionSilently() {
    if (!authGetToken()) return false;
    try {
      const meResponse = await apiGet("getMe");
      const me = authExtractUserFromResponse(meResponse);
      if (!me) throw new Error("Session invalid");
      state.auth.user = me;
      state.auth.expiresAt = authExtractExpiresAt(meResponse) || state.auth.expiresAt || "";
      authSaveSessionCache();
      authRenderHeader();
      authRenderLoginOverlay();
      void authLoadUsers();
      return true;
    } catch (error) {
      if (state.auth.handlingUnauthorized) return false;
      await authLogout({
        source: "validate-session",
        skipApi: true,
        silent: true,
        loginError: "Session ไม่ถูกต้องหรือหมดอายุ",
      });
      return false;
    }
  }

  async function authLogout(options = {}) {
    const source = String(options.source || "");
    const token = authGetToken();

    if (token && !options.skipApi) {
      try {
        await fetch(API_BASE, {
          method: "POST",
          headers: authBuildHeaders({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
          body: JSON.stringify({ action: "logout" }),
        });
      } catch (error) {
        if (!options.silent) {
          console.warn("logout request failed", error);
        }
      }
    }

    clearSyncRetryTimer();
    state.sync.processing = false;

    state.auth = {
      ...authGetDefaultStatePatch(),
      handlingUnauthorized: state.auth.handlingUnauthorized,
      loginError: String(options.loginError || ""),
    };
    clearSession();
    authRenderHeader();
    authRenderLoginOverlay();
    userFilterRenderUserOptions();
    renderAddVisibleUsersControl();
    state.dashboard.data = null;
    state.dashboard.error = "";
    dashboardRenderControls();
    dashboardRender();

    state.rawPendingNotes = [];
    state.rawDoneNotes = [];
    state.pendingNotes = [];
    state.doneNotes = [];
    state.errors.pending = "";
    state.errors.done = "";
    state.loading.pending = false;
    state.loading.done = false;
    setApiStatus("warn", "API: กรุณาเข้าสู่ระบบ");
    rebuildVisibleNotesFromSources();
    renderList("pending");
    renderList("done");

    if (dom.authPassword) dom.authPassword.value = "";
    if (state.userMgmt.open) {
      closeUserMgmtModal({ force: true });
    }
    if (state.sideMenu.open) {
      closeSideMenu();
    }
    if (state.dashboard.open) {
      closeDashboardModal();
    }

    if (!options.silent && source === "manual") {
      showToast("success", "ออกจากระบบแล้ว");
    }
  }
  // === AUTH PATCH END ===

  // === USER FILTER PATCH START ===
  function userFilterNormalizeMode(value) {
    const mode = String(value || "").trim().toUpperCase();
    if (mode === "CREATED" || mode === "CHECKED") return mode;
    return "ANY";
  }

  function userFilterBuildApiParams(scope) {
    const isDoneScope = scope === "done";
    const filters = isDoneScope ? state.filters.done : state.filters.pending;
    const userId = String((filters && filters.userId) || "").trim();
    if (!userId) return {};

    const userFilterMode = userFilterNormalizeMode(filters.userFilterMode);
    const params = {
      userId,
      userFilterMode,
    };
    if (userFilterMode === "CREATED") {
      params.createdByUserId = userId;
    } else if (userFilterMode === "CHECKED") {
      params.checkedByUserId = userId;
    }
    return params;
  }

  function userFilterRenderUserOptions() {
    const pendingSelectedUserId = String((state.filters.pending && state.filters.pending.userId) || "");
    const doneSelectedUserId = String((state.filters.done && state.filters.done.userId) || "");
    const pendingMode = userFilterNormalizeMode(state.filters.pending.userFilterMode);
    const doneMode = userFilterNormalizeMode(state.filters.done.userFilterMode);

    const users = Array.isArray(state.auth.users) ? state.auth.users : [];
    const optionHtml = users
      .map((user) => {
        const value = escapeAttribute(String(user.userId || ""));
        const label = escapeHtml(String(user.displayName || user.username || user.userId || "-"));
        const role = escapeHtml(String(user.role || "USER"));
        return `<option value="${value}">${label} (${role})</option>`;
      })
      .join("");

    if (dom.pendingUserId) {
      dom.pendingUserId.innerHTML = `<option value="">ทุกคน</option>${optionHtml}`;
      dom.pendingUserId.value = pendingSelectedUserId;
      if (dom.pendingUserId.value !== pendingSelectedUserId) {
        dom.pendingUserId.value = "";
        state.filters.pending.userId = "";
      }
    }
    if (dom.historyUserId) {
      dom.historyUserId.innerHTML = `<option value="">ทุกคน</option>${optionHtml}`;
      dom.historyUserId.value = doneSelectedUserId;
      if (dom.historyUserId.value !== doneSelectedUserId) {
        dom.historyUserId.value = "";
        state.filters.done.userId = "";
      }
    }
    if (dom.pendingUserFilterMode) dom.pendingUserFilterMode.value = pendingMode;
    if (dom.historyUserFilterMode) dom.historyUserFilterMode.value = doneMode;

    userFilterApplyPendingVisibilityByRole();
    renderFilterControls("pending");
    renderFilterControls("done");
  }

  function userFilterApplyPendingVisibilityByRole() {
    const isUserRole = authGetRole() === "USER";
    if (dom.pendingUserFilterModeField) {
      dom.pendingUserFilterModeField.classList.toggle("hidden", isUserRole);
    }
    if (dom.pendingUserIdField) {
      dom.pendingUserIdField.classList.toggle("hidden", isUserRole);
    }

    if (!isUserRole) return;

    const hadServerFilter = Boolean(state.filters.pending.userId);
    state.filters.pending.userFilterMode = "ANY";
    state.filters.pending.userId = "";
    if (dom.pendingUserFilterMode) dom.pendingUserFilterMode.value = "ANY";
    if (dom.pendingUserId) dom.pendingUserId.value = "";

    if (hadServerFilter && authIsLoggedIn() && state.auth.appStarted) {
      void refreshPendingNotes();
    }
  }
  // === USER FILTER PATCH END ===

  // === VISIBILITY / DASHBOARD PATCH START ===
  function getSelectedValuesFromSelect(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions || []).map((opt) => String(opt.value || "")).filter(Boolean);
  }

  function setSelectedValuesForSelect(selectEl, values) {
    if (!selectEl) return;
    const selected = new Set((values || []).map((v) => String(v || "")));
    Array.from(selectEl.options || []).forEach((opt) => {
      opt.selected = selected.has(String(opt.value || ""));
    });
  }

  function normalizeVisibleUserIdsInput(value) {
    if (Array.isArray(value)) {
      return uniqueStrings(value.map((v) => String(v || "").trim()).filter(Boolean));
    }
    const text = String(value || "").trim();
    if (!text) return [];
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return normalizeVisibleUserIdsInput(parsed);
        }
      } catch (error) {
        // ignore parse error
      }
    }
    return uniqueStrings(text.split(",").map((v) => String(v || "").trim()).filter(Boolean));
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((v) => String(v || "")).filter(Boolean)));
  }

  function getCurrentUserId() {
    return String((state.auth.user && state.auth.user.userId) || "");
  }

  function getAssignableUsersForCurrentRole() {
    const role = authGetRole();
    const users = Array.isArray(state.auth.users) ? state.auth.users : [];
    if (role === "ADMIN") {
      return users.filter((user) => user && user.userId && user.isActive !== false);
    }
    if (role === "SUPERVISOR") {
      return users.filter(
        (user) =>
          user &&
          user.userId &&
          user.isActive !== false &&
          String(user.role || "USER").toUpperCase() === "USER"
      );
    }
    return [];
  }

  function getAllowedVisibilityRolesForCurrentRole() {
    const users = getAssignableUsersForCurrentRole();
    return uniqueStrings(
      users
        .map((user) => String((user && user.role) || "USER").toUpperCase())
        .filter((role) => role && role !== "ADMIN")
    );
  }

  function normalizeVisibleRoleFiltersInput(values, allowedRolesInput) {
    const allowedRoles = Array.isArray(allowedRolesInput)
      ? allowedRolesInput
      : getAllowedVisibilityRolesForCurrentRole();
    const allowedSet = new Set((allowedRoles || []).map((r) => String(r || "").toUpperCase()));
    const normalized = uniqueStrings((values || []).map((r) => String(r || "").trim().toUpperCase()).filter(Boolean))
      .filter((role) => allowedSet.has(role));
    return normalized.length ? normalized : allowedRoles.slice();
  }

  function getFilteredAssignableUsersForRoles(selectedRoles) {
    const users = getAssignableUsersForCurrentRole();
    const roleSet = new Set(normalizeVisibleRoleFiltersInput(selectedRoles));
    if (!roleSet.size) return users;
    return users.filter((user) => roleSet.has(String((user && user.role) || "USER").toUpperCase()));
  }

  function buildVisibilityRoleOptionsHtml(selectedRoles, allowedRoles) {
    const selected = new Set(normalizeVisibleRoleFiltersInput(selectedRoles, allowedRoles));
    return (allowedRoles || [])
      .map((role) => {
        const label = role === "USER" ? "USER" : role === "SUPERVISOR" ? "SUPERVISOR" : role;
        return `<option value="${escapeAttribute(role)}"${selected.has(role) ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function buildVisibilityUserOptionsHtml(users, selectedUserIds = []) {
    const safeUsers = Array.isArray(users) ? users : [];
    const selected = new Set(normalizeVisibleUserIdsInput(selectedUserIds));
    const allValue = "__ALL_VISIBLE_USERS__";
    const allLabel = safeUsers.length ? `ทั้งหมด (${safeUsers.length} คน)` : "ทั้งหมด";
    const allOption = `<option value="${allValue}">${escapeHtml(allLabel)}</option>`;
    const userOptions = safeUsers
      .map((user) => {
        const uid = String(user.userId || "");
        const label = `${user.displayName || user.username || uid} (${user.role || "USER"})`;
        return `<option value="${escapeAttribute(uid)}"${selected.has(uid) ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    return `${allOption}${userOptions}`;
  }

  function filterVisibilityUsersBySearch(users, searchText) {
    const safeUsers = Array.isArray(users) ? users : [];
    const q = String(searchText || "").trim().toLowerCase();
    if (!q) return safeUsers;
    return safeUsers.filter((user) => {
      const txt = `${user.displayName || ""} ${user.username || ""} ${user.userId || ""}`.toLowerCase();
      return txt.includes(q);
    });
  }

  function mergeVisibilityUserSelectionKeepingHidden(previousIds, visibleSelectionIds, visibleUsers) {
    const visibleIds = new Set((visibleUsers || []).map((u) => String((u && u.userId) || "")));
    const prev = normalizeVisibleUserIdsInput(previousIds);
    const currentVisible = normalizeVisibleUserIdsInput(visibleSelectionIds).filter((id) => visibleIds.has(id));
    const hiddenKeep = prev.filter((id) => !visibleIds.has(id));
    return uniqueStrings([...hiddenKeep, ...currentVisible]);
  }

  function buildVisibilitySelectedCountText(count) {
    const n = Number(count || 0);
    return `เลือกแล้ว ${n} คน`;
  }

  function renderAddVisibleUsersSelectionBadge() {
    if (!dom.addVisibleUsersCountBadge) return;
    const count = normalizeVisibleUserIdsInput(state.addForm.visibleToUserIds).length;
    dom.addVisibleUsersCountBadge.textContent = buildVisibilitySelectedCountText(count);
  }

  function readVisibilityUserSelectionFromSelect(selectEl, filteredUsers) {
    const raw = getSelectedValuesFromSelect(selectEl);
    const allowedIds = new Set((filteredUsers || []).map((u) => String((u && u.userId) || "")));
    const usedSelectAll = raw.includes("__ALL_VISIBLE_USERS__");
    const userIds = usedSelectAll
      ? Array.from(allowedIds)
      : normalizeVisibleUserIdsInput(raw).filter((id) => allowedIds.has(id));
    return { userIds, usedSelectAll };
  }

  function deriveVisibleRoleFiltersFromUserIds(userIds) {
    const selectedIds = new Set(normalizeVisibleUserIdsInput(userIds));
    const allowedRoles = getAllowedVisibilityRolesForCurrentRole();
    if (!selectedIds.size) return allowedRoles.slice();

    const matchedRoles = uniqueStrings(
      getAssignableUsersForCurrentRole()
        .filter((user) => selectedIds.has(String(user.userId || "")))
        .map((user) => String(user.role || "USER").toUpperCase())
        .filter((role) => role !== "ADMIN")
    );
    return normalizeVisibleRoleFiltersInput(matchedRoles, allowedRoles);
  }

  function getUserDisplayNameById(userId) {
    const target = String(userId || "");
    if (!target) return "";
    const users = Array.isArray(state.auth.users) ? state.auth.users : [];
    const found = users.find((u) => String((u && u.userId) || "") === target);
    if (!found) return target;
    return String(found.displayName || found.username || found.userId || target);
  }

  function authCanManageVisibleUsers() {
    return authIsAdmin() || authIsSupervisor();
  }

  function renderAddVisibleUsersControl() {
    if (!dom.addVisibleUsersField || !dom.addVisibleToUserIds) return;

    const canManage = authCanManageVisibleUsers();
    dom.addVisibleUsersField.classList.toggle("hidden", !canManage);
    if (!canManage) {
      state.addForm.visibleRoleFilters = [];
      state.addForm.visibleUserSearch = "";
      state.addForm.visibleToUserIds = [];
      if (dom.addVisibleRoles) dom.addVisibleRoles.innerHTML = "";
      if (dom.addVisibleUserSearch) dom.addVisibleUserSearch.value = "";
      dom.addVisibleToUserIds.innerHTML = "";
      renderAddVisibleUsersSelectionBadge();
      return;
    }

    const role = authGetRole();
    const allowedRoles = getAllowedVisibilityRolesForCurrentRole();
    state.addForm.visibleRoleFilters = normalizeVisibleRoleFiltersInput(state.addForm.visibleRoleFilters, allowedRoles);
    const roleFilteredUsers = getFilteredAssignableUsersForRoles(state.addForm.visibleRoleFilters);
    const visibleUsers = filterVisibilityUsersBySearch(roleFilteredUsers, state.addForm.visibleUserSearch);

    if (dom.addVisibleRoles) {
      dom.addVisibleRoles.innerHTML = buildVisibilityRoleOptionsHtml(state.addForm.visibleRoleFilters, allowedRoles);
    }
    if (dom.addVisibleUserSearch && dom.addVisibleUserSearch.value !== String(state.addForm.visibleUserSearch || "")) {
      dom.addVisibleUserSearch.value = String(state.addForm.visibleUserSearch || "");
    }

    dom.addVisibleToUserIds.innerHTML = buildVisibilityUserOptionsHtml(visibleUsers, state.addForm.visibleToUserIds);
    const allowedIds = new Set(roleFilteredUsers.map((u) => String(u.userId || "")));
    state.addForm.visibleToUserIds = normalizeVisibleUserIdsInput(state.addForm.visibleToUserIds).filter((id) => allowedIds.has(id));
    setSelectedValuesForSelect(dom.addVisibleToUserIds, state.addForm.visibleToUserIds);
    renderAddVisibleUsersSelectionBadge();

    if (dom.addVisibleUsersHint) {
      dom.addVisibleUsersHint.textContent =
        role === "SUPERVISOR"
          ? "เลือก role ก่อน แล้วเลือกผู้ใช้ (ADMIN จะเห็นทุก NOTE เสมอ และระบบจะรวมผู้สร้างให้อัตโนมัติ)"
          : "ADMIN จะเห็นทุก NOTE เสมอ (ไม่ต้องเลือก ADMIN) และระบบจะรวมผู้สร้างให้อัตโนมัติ";
    }
  }

  function dashboardGetDefaultFilters() {
    return {
      search: "",
      dateFrom: "",
      dateTo: "",
      dateField: "ANY",
      status: "",
      userFilterMode: "ANY",
      userSearch: "",
      userId: "",
      role: "",
    };
  }

  function dashboardNormalizeDateField(value) {
    const v = String(value || "").trim().toUpperCase();
    if (v === "CREATED" || v === "CHECKED" || v === "UPDATED") return v;
    return "ANY";
  }

  function dashboardNormalizeUserFilterMode(value) {
    const v = String(value || "").trim().toUpperCase();
    if (v === "CREATED" || v === "CHECKED" || v === "UPDATED") return v;
    return "ANY";
  }

  function dashboardNormalizeRoleFilterValue(value) {
    const v = String(value || "").trim().toUpperCase();
    if (v === "USER" || v === "SUPERVISOR" || v === "ADMIN") return v;
    return "";
  }

  function dashboardCanOpen() {
    return authIsLoggedIn();
  }

  function dashboardApplyRoleRestrictionsToState() {
    const role = authGetRole();
    const filters = state.dashboard.filters;
    const selfId = getCurrentUserId();

    if (role === "USER") {
      filters.userId = selfId || "";
      filters.role = "USER";
    } else if (role === "SUPERVISOR") {
      filters.role = "USER";
      if (filters.userId) {
        const allowedIds = new Set(getAssignableUsersForCurrentRole().map((u) => String(u.userId || "")));
        if (!allowedIds.has(String(filters.userId || ""))) {
          filters.userId = "";
        }
      }
    }
  }

  function dashboardBuildApiParams() {
    dashboardApplyRoleRestrictionsToState();
    const f = state.dashboard.filters;
    return {
      search: String(f.search || "").trim(),
      dateFrom: f.dateFrom || "",
      dateTo: f.dateTo || "",
      dateField: dashboardNormalizeDateField(f.dateField),
      status: String(f.status || "").trim().toUpperCase(),
      userFilterMode: dashboardNormalizeUserFilterMode(f.userFilterMode),
      userId: String(f.userId || "").trim(),
      role: dashboardNormalizeRoleFilterValue(f.role),
    };
  }

  function dashboardRenderControls() {
    if (!dom.dashboardShell) return;

    dashboardApplyRoleRestrictionsToState();
    const role = authGetRole();
    const filters = state.dashboard.filters;
    const users = Array.isArray(state.auth.users) ? state.auth.users : [];
    const allDashboardUsers =
      role === "ADMIN"
        ? users.filter((u) => u && u.userId)
        : role === "SUPERVISOR"
          ? users.filter((u) => u && u.userId && String(u.role || "USER").toUpperCase() === "USER")
          : users.filter((u) => u && u.userId && String(u.userId) === getCurrentUserId());
    const selectedRoleFilter = dashboardNormalizeRoleFilterValue(filters.role);
    const roleFilteredUsers =
      role === "ADMIN" && selectedRoleFilter
        ? allDashboardUsers.filter((u) => String(u.role || "USER").toUpperCase() === selectedRoleFilter)
        : allDashboardUsers;
    const userSearch = String(filters.userSearch || "").trim().toLowerCase();
    let dashboardUsers = roleFilteredUsers.filter((u) => {
      if (!userSearch) return true;
      const txt = `${u.displayName || ""} ${u.username || ""} ${u.userId || ""}`.toLowerCase();
      return txt.includes(userSearch);
    });
    const allowedUserIds = new Set(roleFilteredUsers.map((u) => String(u.userId || "")));

    if (filters.userId && !allowedUserIds.has(String(filters.userId || ""))) {
      state.dashboard.filters.userId = "";
      filters.userId = "";
    }

    if (filters.userId && !dashboardUsers.some((u) => String(u.userId || "") === String(filters.userId || ""))) {
      const selectedUser = roleFilteredUsers.find((u) => String(u.userId || "") === String(filters.userId || ""));
      if (selectedUser) {
        dashboardUsers = [selectedUser, ...dashboardUsers];
      }
    }

    if (dom.dashboardSearch && dom.dashboardSearch.value !== String(filters.search || "")) {
      dom.dashboardSearch.value = String(filters.search || "");
    }
    if (dom.dashboardDateFrom) dom.dashboardDateFrom.value = String(filters.dateFrom || "");
    if (dom.dashboardDateTo) dom.dashboardDateTo.value = String(filters.dateTo || "");
    if (dom.dashboardDateField) dom.dashboardDateField.value = dashboardNormalizeDateField(filters.dateField);
    if (dom.dashboardStatus) dom.dashboardStatus.value = String(filters.status || "");
    if (dom.dashboardUserFilterMode) dom.dashboardUserFilterMode.value = dashboardNormalizeUserFilterMode(filters.userFilterMode);
    if (dom.dashboardUserSearch && dom.dashboardUserSearch.value !== String(filters.userSearch || "")) {
      dom.dashboardUserSearch.value = String(filters.userSearch || "");
    }

    if (dom.dashboardUserId) {
      const optionsHtml = dashboardUsers
        .map((user) => {
          const label = `${user.displayName || user.username || user.userId} (${user.role || "USER"})`;
          return `<option value="${escapeAttribute(String(user.userId || ""))}">${escapeHtml(label)}</option>`;
        })
        .join("");
      const defaultLabel = role === "USER" ? "ฉัน" : "ทุกคน";
      dom.dashboardUserId.innerHTML = `<option value="">${defaultLabel}</option>${optionsHtml}`;
      dom.dashboardUserId.value = String(filters.userId || "");
      if (dom.dashboardUserId.value !== String(filters.userId || "")) {
        state.dashboard.filters.userId = "";
        dom.dashboardUserId.value = "";
      }
    }

    if (dom.dashboardRole) {
      if (role === "USER") {
        dom.dashboardRole.innerHTML = `<option value="USER">USER</option>`;
      } else if (role === "SUPERVISOR") {
        dom.dashboardRole.innerHTML = `<option value="USER">USER</option>`;
      } else {
        dom.dashboardRole.innerHTML = `
          <option value="">ทุก role</option>
          <option value="USER">USER</option>
          <option value="SUPERVISOR">SUPERVISOR</option>
          <option value="ADMIN">ADMIN</option>
        `;
      }
      dom.dashboardRole.value = dashboardNormalizeRoleFilterValue(state.dashboard.filters.role) || (role === "ADMIN" ? "" : "USER");
      state.dashboard.filters.role = dom.dashboardRole.value;
    }

    if (dom.dashboardUserField) {
      const lockUserField = role === "USER";
      dom.dashboardUserField.classList.toggle("is-disabled", lockUserField);
      if (dom.dashboardUserId) dom.dashboardUserId.disabled = lockUserField;
    }
    if (dom.dashboardRoleField) {
      const lockRoleField = role !== "ADMIN";
      dom.dashboardRoleField.classList.toggle("is-disabled", lockRoleField);
      if (dom.dashboardRole) dom.dashboardRole.disabled = lockRoleField;
    }

    if (dom.btnDashboardClearFilters) {
      const def = dashboardGetDefaultFilters();
      const userFilterCountsAsActive = role === "USER" ? false : Boolean(filters.userId);
      const hasActive =
        Boolean(String(filters.search || "").trim()) ||
        Boolean(filters.dateFrom) ||
        Boolean(filters.dateTo) ||
        dashboardNormalizeDateField(filters.dateField) !== def.dateField ||
        Boolean(filters.status) ||
        dashboardNormalizeUserFilterMode(filters.userFilterMode) !== def.userFilterMode ||
        Boolean(String(filters.userSearch || "").trim()) ||
        userFilterCountsAsActive ||
        Boolean(filters.role && !(role !== "ADMIN" && filters.role === "USER"));
      dom.btnDashboardClearFilters.disabled = !hasActive;
      dom.btnDashboardClearFilters.classList.toggle("is-active", hasActive);
    }
  }

  function dashboardExtractResponseData(response) {
    if (!response || typeof response !== "object") return null;
    if (response.summary) return response;
    if (response.data && typeof response.data === "object" && response.data.summary) return response.data;
    if (response.result && typeof response.result === "object" && response.result.summary) return response.result;
    return null;
  }

  async function openDashboardModal() {
    if (!dashboardCanOpen()) {
      showToast("warn", "กรุณาเข้าสู่ระบบก่อน");
      return;
    }
    if (!dom.dashboardShell || !dom.dashboardBackdrop) {
      showToast("warn", "Dashboard UI ไม่พร้อมใช้งาน");
      return;
    }
    if (state.dashboard.open) return;
    state.dashboard.open = true;
    state.dashboard.error = "";
    dashboardRenderControls();
    dashboardRender();

    showModalElements(dom.dashboardBackdrop, dom.dashboardShell);
    dom.dashboardShell.setAttribute("aria-hidden", "false");
    dom.dashboardBackdrop.setAttribute("aria-hidden", "false");
    syncBodyScrollLock();

    await refreshDashboardSummary({ silent: true });
  }

  function closeDashboardModal() {
    if (!state.dashboard.open) return;
    state.dashboard.open = false;
    hideModalElements(dom.dashboardBackdrop, dom.dashboardShell);
    dom.dashboardShell.setAttribute("aria-hidden", "true");
    dom.dashboardBackdrop.setAttribute("aria-hidden", "true");
    syncBodyScrollLock();
  }

  async function refreshDashboardSummary(options = {}) {
    if (!state.dashboard.open && !options.allowClosedRefresh) return;
    if (!authIsLoggedIn()) return;
    state.dashboard.loading = true;
    if (!options.silent) state.dashboard.error = "";
    dashboardRender();

    try {
      const response = await apiGet("getDashboardSummary", dashboardBuildApiParams());
      const data = dashboardExtractResponseData(response);
      if (!data) throw new Error("รูปแบบข้อมูล Dashboard ไม่ถูกต้อง");
      state.dashboard.data = data;
      state.dashboard.error = "";
    } catch (error) {
      state.dashboard.error = getErrorMessage(error);
      if (!options.silent) {
        showToast("error", `โหลด Dashboard ไม่สำเร็จ: ${state.dashboard.error}`);
      }
    } finally {
      state.dashboard.loading = false;
      dashboardRender();
    }
  }

  function resetDashboardFilters() {
    state.dashboard.filters = dashboardGetDefaultFilters();
    dashboardApplyRoleRestrictionsToState();
    if (dom.dashboardUserSearch) dom.dashboardUserSearch.value = "";
    dashboardRenderControls();
    void refreshDashboardSummary({ silent: true });
  }

  function dashboardRender() {
    if (!dom.dashboardShell) return;

    dashboardRenderControls();

    const data = state.dashboard.data || {};
    const summary = data.summary || {};
    const breakdown = data.breakdown || {};
    const loading = Boolean(state.dashboard.loading);
    const errorText = String(state.dashboard.error || "");

    if (dom.dashboardError) {
      dom.dashboardError.textContent = errorText;
      dom.dashboardError.classList.toggle("hidden", !errorText);
    }

    setDashboardValue(dom.dashboardTotalNotes, loading, summary.totalNotes);
    setDashboardValue(dom.dashboardPendingNotes, loading, summary.pendingNotes);
    setDashboardValue(dom.dashboardDoneNotes, loading, summary.doneNotes);
    setDashboardValue(dom.dashboardUsersCount, loading, summary.usersCount);

    dashboardRenderSimpleList(dom.dashboardByStatus, breakdown.byStatus, loading, (item) => ({
      label: String(item && item.status || "-"),
      count: Number(item && item.count || 0),
      meta: "",
    }));

    dashboardRenderSimpleList(dom.dashboardByRole, breakdown.byRole, loading, (item) => ({
      label: String(item && item.role || "-"),
      count: Number(item && item.count || 0),
      meta: "",
    }));

    dashboardRenderSimpleList(dom.dashboardByUser, breakdown.byUser, loading, (item) => ({
      label: String(item && (item.displayName || item.username || item.userId) || "-"),
      count: Number(item && item.count || 0),
      meta: String(item && item.role || ""),
    }));
  }

  function setDashboardValue(el, loading, value) {
    if (!el) return;
    el.textContent = loading ? "..." : String(value ?? "-");
  }

  function dashboardRenderSimpleList(listEl, items, loading, mapItem) {
    if (!listEl) return;
    if (loading) {
      listEl.innerHTML = '<li class="list-message">กำลังโหลด...</li>';
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      listEl.innerHTML = '<li class="list-message">ไม่มีข้อมูล</li>';
      return;
    }

    listEl.innerHTML = items
      .map((item) => {
        const mapped = mapItem(item || {});
        return `
          <li class="dashboard-list__item">
            <div>
              <div class="dashboard-list__label">${escapeHtml(String(mapped.label || "-"))}</div>
              ${mapped.meta ? `<div class="dashboard-list__meta">${escapeHtml(String(mapped.meta))}</div>` : ""}
            </div>
            <div class="dashboard-list__count">${escapeHtml(String(mapped.count ?? 0))}</div>
          </li>
        `;
      })
      .join("");
  }
  // === VISIBILITY / DASHBOARD PATCH END ===

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
    if (!authIsLoggedIn()) {
      showToast("warn", "กรุณาเข้าสู่ระบบก่อน");
      authSetLoginState({ loginOpen: true });
      return;
    }

    state.loading.refreshAll = true;
    setButtonBusy(dom.btnRefreshAll, true, "กำลังรีเฟรช...");
    try {
      const tasks = [checkApiHealth(), refreshPendingNotes(), refreshDoneNotes()];
      if (state.dashboard.open) {
        tasks.push(refreshDashboardSummary({ silent: true }));
      }
      await Promise.all(tasks);
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
      const response = await apiGet("getPendingNotes", userFilterBuildApiParams("pending"));
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
      const response = await apiGet("getDoneNotes", userFilterBuildApiParams("done"));
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

  function loadLocalNoteCacheFromStorage() {
    state.localNoteCache = {};

    let raw = "";
    try {
      raw = window.localStorage.getItem(CONFIG.localCacheKey) || "";
    } catch (error) {
      return;
    }

    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

      const next = {};
      Object.entries(parsed).forEach(([noteId, value]) => {
        const cached = sanitizeLocalNoteCacheNote(value, noteId);
        if (cached) next[cached.noteId] = cached;
      });
      state.localNoteCache = next;
    } catch (error) {
      console.warn("Failed to parse local note cache", error);
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

  function saveLocalNoteCacheToStorage() {
    try {
      const keys = Object.keys(state.localNoteCache || {});
      if (!keys.length) {
        window.localStorage.removeItem(CONFIG.localCacheKey);
        return;
      }
      window.localStorage.setItem(CONFIG.localCacheKey, JSON.stringify(state.localNoteCache));
    } catch (error) {
      console.warn("Failed to save local note cache", error);
      showToast("error", "บันทึกข้อมูล NOTE ในเครื่องไม่สำเร็จ (localStorage อาจเต็ม)");
    }
  }

  function sanitizeLocalNoteCacheNote(note, fallbackNoteId = "") {
    if (!note || typeof note !== "object") return null;
    const noteId = String(note.noteId || fallbackNoteId || "").trim();
    if (!noteId) return null;

    const cleaned = { ...note, noteId };
    delete cleaned.raw;
    delete cleaned.__syncQueueId;
    delete cleaned.__syncState;
    delete cleaned.__syncError;
    delete cleaned.__syncAttempts;
    cleaned.__localOnly = false;
    cleaned.__localImageDataUrl = String(cleaned.__localImageDataUrl || "");

    return cleaned;
  }

  function setLocalNoteCache(note, options = {}) {
    const cleaned = sanitizeLocalNoteCacheNote(note);
    if (!cleaned) return;

    if (normalizeStatus(cleaned.status || "PENDING") === "DONE") {
      removeLocalNoteCache(cleaned.noteId, options);
      return;
    }

    state.localNoteCache[cleaned.noteId] = cleaned;
    saveLocalNoteCacheToStorage();
    if (!options.skipRebuild) {
      rebuildVisibleNotesFromSources();
    }
  }

  function removeLocalNoteCache(noteId, options = {}) {
    const key = String(noteId || "").trim();
    if (!key) return;
    if (!state.localNoteCache || !Object.prototype.hasOwnProperty.call(state.localNoteCache, key)) return;

    delete state.localNoteCache[key];
    saveLocalNoteCacheToStorage();
    if (!options.skipRebuild) {
      rebuildVisibleNotesFromSources();
    }
  }

  function moveLocalNoteCache(oldNoteId, newNoteId, options = {}) {
    const oldKey = String(oldNoteId || "").trim();
    const newKey = String(newNoteId || "").trim();
    if (!oldKey || !newKey || oldKey === newKey) return;

    const existing = state.localNoteCache[oldKey];
    if (!existing) return;
    delete state.localNoteCache[oldKey];
    state.localNoteCache[newKey] = { ...existing, noteId: newKey, __localOnly: false };
    saveLocalNoteCacheToStorage();
    if (!options.skipRebuild) {
      rebuildVisibleNotesFromSources();
    }
  }

  function applyLocalCacheOverlayToLists(pending, done) {
    const cacheEntries = Object.values(state.localNoteCache || {});
    if (!cacheEntries.length) return;

    for (const cached of cacheEntries) {
      const noteId = String(cached.noteId || "");
      if (!noteId) continue;
      const target = findNoteInLists(pending, done, noteId);
      if (!target) continue;
      Object.assign(target, cloneNoteForUi(cached));
      target.__localOnly = false;
    }
  }

  async function openCacheDB() {
    if (cacheRuntime.dbPromise) return cacheRuntime.dbPromise;

    if (typeof window === "undefined" || !("indexedDB" in window)) {
      cacheRuntime.dbPromise = Promise.resolve(null);
      return cacheRuntime.dbPromise;
    }

    cacheRuntime.dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(CONFIG.cacheDbName, CONFIG.cacheDbVersion);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CONFIG.cacheStoreNotes)) {
            db.createObjectStore(CONFIG.cacheStoreNotes, { keyPath: "noteId" });
          }
          if (!db.objectStoreNames.contains(CONFIG.cacheStoreImages)) {
            db.createObjectStore(CONFIG.cacheStoreImages, { keyPath: "imageFileId" });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          console.warn("IndexedDB open failed", request.error);
          resolve(null);
        };
        request.onblocked = () => {
          console.warn("IndexedDB open blocked");
        };
      } catch (error) {
        console.warn("IndexedDB unavailable", error);
        resolve(null);
      }
    });

    return cacheRuntime.dbPromise;
  }

  async function idbPut(store, value) {
    const db = await openCacheDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, "readwrite");
        const req = tx.objectStore(store).put(value);
        req.onsuccess = () => resolve(req.result ?? value);
        req.onerror = () => {
          console.warn(`idbPut(${store}) failed`, req.error);
          resolve(null);
        };
      } catch (error) {
        console.warn(`idbPut(${store}) exception`, error);
        resolve(null);
      }
    });
  }

  async function idbGet(store, key) {
    const db = await openCacheDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => {
          console.warn(`idbGet(${store}) failed`, req.error);
          resolve(null);
        };
      } catch (error) {
        console.warn(`idbGet(${store}) exception`, error);
        resolve(null);
      }
    });
  }

  async function idbDelete(store, key) {
    const db = await openCacheDB();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, "readwrite");
        const req = tx.objectStore(store).delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => {
          console.warn(`idbDelete(${store}) failed`, req.error);
          resolve(false);
        };
      } catch (error) {
        console.warn(`idbDelete(${store}) exception`, error);
        resolve(false);
      }
    });
  }

  async function idbCursor(store, mode, onCursor) {
    const db = await openCacheDB();
    if (!db) return 0;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, mode || "readonly");
        const objectStore = tx.objectStore(store);
        const req = objectStore.openCursor();
        let count = 0;

        req.onerror = () => {
          console.warn(`idbCursor(${store}) failed`, req.error);
          resolve(count);
        };

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          count += 1;
          try {
            onCursor(cursor);
          } catch (error) {
            console.warn(`idbCursor(${store}) callback error`, error);
          }
          cursor.continue();
        };

        tx.oncomplete = () => resolve(count);
        tx.onerror = () => resolve(count);
        tx.onabort = () => resolve(count);
      } catch (error) {
        console.warn(`idbCursor(${store}) exception`, error);
        resolve(0);
      }
    });
  }

  function normalizeImageCacheRecord(record) {
    if (!record || typeof record !== "object") return null;
    const imageFileId = String(record.imageFileId || "").trim();
    const dataUrl = String(record.dataUrl || "");
    if (!imageFileId || !dataUrl) return null;

    return {
      imageFileId,
      noteId: String(record.noteId || ""),
      dataUrl,
      status: normalizeStatus(record.status || "PENDING") || "PENDING",
      cachedAt: Number(record.cachedAt || Date.now()),
      lastAccessAt: Number(record.lastAccessAt || Date.now()),
      doneAt: String(record.doneAt || ""),
    };
  }

  function buildImageCacheRecord({ imageFileId, noteId = "", dataUrl = "", status = "PENDING", doneAt = "" }) {
    const normalized = normalizeImageCacheRecord({
      imageFileId,
      noteId,
      dataUrl,
      status,
      doneAt,
      cachedAt: Date.now(),
      lastAccessAt: Date.now(),
    });
    return normalized;
  }

  async function putImageCacheRecord(record) {
    const normalized = normalizeImageCacheRecord(record);
    if (!normalized) return null;
    imageMemoryCache.set(normalized.imageFileId, normalized);
    await idbPut(CONFIG.cacheStoreImages, normalized);
    return normalized;
  }

  async function deleteImageCacheEverywhere(imageFileId) {
    const key = String(imageFileId || "").trim();
    if (!key) return;
    imageMemoryCache.delete(key);
    await idbDelete(CONFIG.cacheStoreImages, key);
  }

  async function touchImageCacheMeta(imageFileId, patch = {}) {
    const key = String(imageFileId || "").trim();
    if (!key) return null;

    const mem = imageMemoryCache.get(key);
    if (mem) {
      const merged = normalizeImageCacheRecord({
        ...mem,
        ...patch,
        imageFileId: key,
        lastAccessAt: Date.now(),
      });
      if (merged) {
        imageMemoryCache.set(key, merged);
        await idbPut(CONFIG.cacheStoreImages, merged);
        return merged;
      }
    }

    const existing = await idbGet(CONFIG.cacheStoreImages, key);
    if (!existing) return null;
    const merged = normalizeImageCacheRecord({
      ...existing,
      ...patch,
      imageFileId: key,
      lastAccessAt: Date.now(),
    });
    if (!merged) {
      await idbDelete(CONFIG.cacheStoreImages, key);
      return null;
    }
    imageMemoryCache.set(key, merged);
    await idbPut(CONFIG.cacheStoreImages, merged);
    return merged;
  }

  async function getImageFast(fileId, noteId = "", meta = {}) {
    const imageFileId = String(fileId || "").trim();
    if (!imageFileId) {
      throw new Error("ไม่มีรหัสรูป");
    }

    const now = Date.now();
    const desiredStatus = normalizeStatus(meta.status || "PENDING") || "PENDING";
    const desiredDoneAt = String(meta.doneAt || "");

    const fromMemory = normalizeImageCacheRecord(imageMemoryCache.get(imageFileId));
    if (fromMemory) {
      const touched = {
        ...fromMemory,
        noteId: String(noteId || fromMemory.noteId || ""),
        status: desiredStatus || fromMemory.status,
        doneAt: desiredStatus === "DONE" ? (desiredDoneAt || fromMemory.doneAt || "") : "",
        lastAccessAt: now,
      };
      imageMemoryCache.set(imageFileId, touched);
      void idbPut(CONFIG.cacheStoreImages, touched);
      return touched.dataUrl;
    }

    const fromIdb = normalizeImageCacheRecord(await idbGet(CONFIG.cacheStoreImages, imageFileId));
    if (fromIdb) {
      const touched = {
        ...fromIdb,
        noteId: String(noteId || fromIdb.noteId || ""),
        status: desiredStatus || fromIdb.status,
        doneAt: desiredStatus === "DONE" ? (desiredDoneAt || fromIdb.doneAt || "") : "",
        lastAccessAt: now,
      };
      imageMemoryCache.set(imageFileId, touched);
      void idbPut(CONFIG.cacheStoreImages, touched);
      return touched.dataUrl;
    }

    if (imageInflightCache.has(imageFileId)) {
      return imageInflightCache.get(imageFileId);
    }

    const inflightPromise = (async () => {
      const response = await apiGet("getNoteImageData", { fileId: imageFileId });
      const dataUrl = extractImageDataUrl(response);
      if (!dataUrl) {
        throw new Error("ไม่พบข้อมูลรูปภาพ");
      }

      await putImageCacheRecord(
        buildImageCacheRecord({
          imageFileId,
          noteId: String(noteId || ""),
          dataUrl,
          status: desiredStatus,
          doneAt: desiredStatus === "DONE" ? desiredDoneAt : "",
        })
      );

      return dataUrl;
    })();

    imageInflightCache.set(imageFileId, inflightPromise);
    try {
      return await inflightPromise;
    } finally {
      imageInflightCache.delete(imageFileId);
    }
  }

  async function cacheNoteMetaToIdb(note) {
    const base = sanitizeLocalNoteCacheNote(note);
    if (!base) return null;

    const status = normalizeStatus(base.status || "PENDING") || "PENDING";
    const record = {
      ...base,
      noteId: String(base.noteId),
      status,
      imageFileId: String(base.imageFileId || ""),
      checkedAt: String(base.checkedAt || ""),
      createdAt: String(base.createdAt || ""),
      updatedAt: String(base.updatedAt || ""),
      cachedAt: Date.now(),
      lastAccessAt: Date.now(),
    };
    await idbPut(CONFIG.cacheStoreNotes, record);
    return record;
  }

  async function cacheLocalImageForNoteByFileId(note, imageDataUrl) {
    const imageFileId = String(note && note.imageFileId || "").trim();
    const dataUrl = String(imageDataUrl || "").trim();
    if (!imageFileId || !dataUrl) return null;

    return putImageCacheRecord(
      buildImageCacheRecord({
        imageFileId,
        noteId: String(note.noteId || ""),
        dataUrl,
        status: normalizeStatus(note.status || "PENDING") || "PENDING",
        doneAt: String(note.checkedAt || ""),
      })
    );
  }

  async function updateCachedImageStatusForNote(note) {
    if (!note || !note.imageFileId) return null;
    const status = normalizeStatus(note.status || "PENDING") || "PENDING";
    return touchImageCacheMeta(note.imageFileId, {
      noteId: String(note.noteId || ""),
      status,
      doneAt: status === "DONE" ? String(note.checkedAt || "") : "",
    });
  }

  async function cleanupDoneImageCache(days = CONFIG.doneImageCacheTtlDays) {
    if (cacheRuntime.cleanupRun) return;
    cacheRuntime.cleanupRun = true;

    const ttlDays = Math.max(1, Number(days || CONFIG.doneImageCacheTtlDays));
    const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

    await idbCursor(CONFIG.cacheStoreImages, "readwrite", (cursor) => {
      const value = normalizeImageCacheRecord(cursor.value);
      if (!value) {
        cursor.delete();
        return;
      }
      if (normalizeStatus(value.status) !== "DONE") return;

      const doneAtMs = toTimestamp(value.doneAt) || Number(value.cachedAt || 0);
      if (!doneAtMs) return;
      if (doneAtMs > cutoffMs) return;

      imageMemoryCache.delete(value.imageFileId);
      cursor.delete();
    });
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

    applyLocalCacheOverlayToLists(pending, done);

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
      if (Object.prototype.hasOwnProperty.call(data, "visibleToUserIds")) {
        target.visibleToUserIds = normalizeVisibleUserIdsInput(data.visibleToUserIds);
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
      visibleToUserIds: normalizeVisibleUserIdsInput(payload.visibleToUserIds),
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
      visibleToUserIds: normalizeVisibleUserIdsInput(payload.visibleToUserIds),
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
    if (!authIsLoggedIn()) {
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

      const localSnapshot = queueItem.localNote
        ? cloneNoteForUi(queueItem.localNote)
        : buildLocalNoteFromQueueItem(queueItem);
      const localPreviewDataUrl = String(
        (queueItem.payload && queueItem.payload.imageDataUrl) || localSnapshot.__localImageDataUrl || ""
      );
      const cachedNote = {
        ...localSnapshot,
        ...note,
        noteId: String(note.noteId),
        status: "PENDING",
        __localOnly: false,
        __localImageDataUrl: localPreviewDataUrl,
      };
      moveLocalNoteCache(localNoteId, note.noteId, { skipRebuild: true });
      setLocalNoteCache(cachedNote, { skipRebuild: true });
      await cacheNoteMetaToIdb(cachedNote);
      if (note.imageFileId && cachedNote.__localImageDataUrl) {
        await cacheLocalImageForNoteByFileId(
          { ...note, status: "PENDING", checkedAt: "" },
          cachedNote.__localImageDataUrl
        );
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
      const noteId = String(payload.noteId || "");
      const data = payload.data && typeof payload.data === "object" ? payload.data : {};
      const beforeNote = noteId ? cloneNoteForUi(getLocalNoteById(noteId) || {}) : null;
      const oldImageFileId = String(beforeNote && beforeNote.imageFileId || "");
      const response = await apiPost("updateNote", payload);
      const rawItem = extractNoteDetail(response);
      let updatedNote = null;

      if (rawItem) {
        const note = normalizeNote(rawItem);
        updatedNote = note;
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

      if (updatedNote && updatedNote.noteId) {
        const newImageFileId = String(updatedNote.imageFileId || "");
        const hasUploadedNewImage = Boolean(data.imageDataUrl || data.imageBase64);
        const localPreviewDataUrl = hasUploadedNewImage ? String(data.imageDataUrl || "") : "";

        if (oldImageFileId && oldImageFileId !== newImageFileId) {
          await deleteImageCacheEverywhere(oldImageFileId);
        }

        if (!newImageFileId) {
          // remove image
          if (oldImageFileId) {
            await deleteImageCacheEverywhere(oldImageFileId);
          }
        } else if (oldImageFileId !== newImageFileId) {
          if (localPreviewDataUrl) {
            await cacheLocalImageForNoteByFileId(updatedNote, localPreviewDataUrl);
          }
        } else {
          await updateCachedImageStatusForNote(updatedNote);
        }

        const liveSnapshot = getLocalNoteById(updatedNote.noteId);
        const cachedNote = {
          ...(liveSnapshot ? cloneNoteForUi(liveSnapshot) : {}),
          ...(beforeNote ? cloneNoteForUi(beforeNote) : {}),
          ...updatedNote,
          __localOnly: false,
        };

        if (data.removeImage === true && !hasUploadedNewImage) {
          cachedNote.__localImageDataUrl = "";
        } else if (hasUploadedNewImage && localPreviewDataUrl) {
          cachedNote.__localImageDataUrl = localPreviewDataUrl;
        } else if (newImageFileId && oldImageFileId === newImageFileId) {
          cachedNote.__localImageDataUrl = String(
            (liveSnapshot && liveSnapshot.__localImageDataUrl) ||
              (beforeNote && beforeNote.__localImageDataUrl) ||
              ""
          );
        } else if (!newImageFileId) {
          cachedNote.__localImageDataUrl = "";
        } else {
          delete cachedNote.__localImageDataUrl;
        }

        setLocalNoteCache(cachedNote, { skipRebuild: true });
        await cacheNoteMetaToIdb(cachedNote);
      } else if (oldImageFileId && data.removeImage === true && !data.imageDataUrl && !data.imageBase64) {
        await deleteImageCacheEverywhere(oldImageFileId);
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

      if (note.noteId) {
        await cacheNoteMetaToIdb({ ...note, status: "DONE" });
        await updateCachedImageStatusForNote({ ...note, status: "DONE" });
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
    renderAddVisibleUsersControl();

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
    if (state.camera.open) {
      closeCameraModal({ force: true });
    }

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
      if (authCanManageVisibleUsers()) {
        const selectedVisibleUserIds = normalizeVisibleUserIdsInput(
          dom.addVisibleToUserIds ? getSelectedValuesFromSelect(dom.addVisibleToUserIds) : state.addForm.visibleToUserIds
        );
        state.addForm.visibleToUserIds = selectedVisibleUserIds;
        if (selectedVisibleUserIds.length) {
          payload.visibleToUserIds = selectedVisibleUserIds;
        }
      }
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
      state.addForm.visibleRoleFilters = [];
      state.addForm.visibleUserSearch = "";
      state.addForm.visibleToUserIds = [];
      if (dom.addVisibleRoles) setSelectedValuesForSelect(dom.addVisibleRoles, []);
      if (dom.addVisibleUserSearch) dom.addVisibleUserSearch.value = "";
      if (dom.addVisibleToUserIds) setSelectedValuesForSelect(dom.addVisibleToUserIds, []);
      renderAddVisibleUsersControl();

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
    dom.addImageInput.value = "";
    await processAddImageFile(file);
  }

  async function processAddImageFile(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("error", "กรุณาเลือกไฟล์รูปภาพเท่านั้น");
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
      showToast("success", "เตรียมรูปพร้อม timestamp แล้ว");
    } catch (error) {
      state.addForm.image = null;
      showToast("error", `เตรียมรูปไม่สำเร็จ: ${getErrorMessage(error)}`);
    } finally {
      state.addForm.compressing = false;
      renderAddImagePreview();
    }
  }

  async function openCameraModal(target = "add") {
    const cameraTarget = target === "edit" ? "edit" : "add";
    if (cameraTarget === "add") {
      if (state.addForm.saving || state.addForm.compressing) return;
    } else {
      const draft = state.noteModal.editDraft;
      if (!draft || state.noteModal.saving || draft.compressing) return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      showToast("error", "เบราว์เซอร์นี้ไม่รองรับกล้อง กรุณาใช้ปุ่มเลือกรูป");
      return;
    }
    if (state.camera.open) return;

    state.camera.open = true;
    state.camera.target = cameraTarget;
    state.camera.starting = true;
    state.camera.capturing = false;
    state.camera.ready = false;
    state.camera.error = "";
    state.camera.stream = null;
    renderCameraModalState();

    showModalElements(dom.cameraBackdrop, dom.cameraShell);
    dom.cameraShell.setAttribute("aria-hidden", "false");
    dom.cameraBackdrop.setAttribute("aria-hidden", "false");
    syncBodyScrollLock();

    try {
      const stream = await requestCameraStream();
      if (!state.camera.open) {
        stopMediaStream(stream);
        return;
      }
      state.camera.stream = stream;
      dom.cameraVideo.srcObject = stream;
      await dom.cameraVideo.play().catch(() => {});
      state.camera.starting = false;
      state.camera.ready = true;
      state.camera.error = "";
    } catch (error) {
      state.camera.starting = false;
      state.camera.ready = false;
      state.camera.error = getErrorMessage(error);
    } finally {
      renderCameraModalState();
    }
  }

  async function requestCameraStream() {
    const tries = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      { video: true, audio: false },
    ];

    let lastError = null;
    for (const constraints of tries) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(lastError && lastError.message ? lastError.message : "ไม่สามารถเปิดกล้องได้");
  }

  function renderCameraModalState() {
    if (!dom.cameraShell) return;
    const showVideo = state.camera.ready && !state.camera.error;

    dom.cameraVideo.classList.toggle("hidden", !showVideo);
    dom.cameraEmptyState.classList.toggle("hidden", showVideo);

    if (state.camera.capturing) {
      dom.cameraStatusBadge.textContent = "กำลังประมวลผล...";
      dom.cameraStatusBadge.dataset.state = "loading";
      dom.cameraEmptyText.textContent = "กำลังประมวลผลรูปจากกล้อง...";
    } else if (state.camera.starting) {
      dom.cameraStatusBadge.textContent = "กำลังเริ่มกล้อง...";
      dom.cameraStatusBadge.dataset.state = "loading";
      dom.cameraEmptyText.textContent = "กำลังเริ่มกล้อง...";
    } else if (state.camera.error) {
      dom.cameraStatusBadge.textContent = "เปิดกล้องไม่สำเร็จ";
      dom.cameraStatusBadge.dataset.state = "error";
      dom.cameraEmptyText.textContent = state.camera.error;
    } else if (state.camera.ready) {
      dom.cameraStatusBadge.textContent = "พร้อมถ่ายรูป";
      dom.cameraStatusBadge.dataset.state = "ready";
      dom.cameraEmptyText.textContent = "";
    } else {
      dom.cameraStatusBadge.textContent = "ยังไม่พร้อม";
      dom.cameraStatusBadge.dataset.state = "idle";
      dom.cameraEmptyText.textContent = "กล้องยังไม่พร้อมใช้งาน";
    }

    dom.btnCameraCapture.disabled = !state.camera.ready || state.camera.capturing || state.camera.starting;
    dom.btnCameraCapture.textContent = state.camera.capturing ? "กำลังประมวลผล..." : "ถ่ายรูป";
    dom.btnCameraClose.disabled = state.camera.capturing;
    dom.btnCameraCancel.disabled = state.camera.capturing;
  }

  async function captureCameraPhoto() {
    if (!state.camera.open || !state.camera.ready || state.camera.capturing) return;

    const video = dom.cameraVideo;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) {
      showToast("error", "กล้องยังไม่พร้อมสำหรับการจับภาพ");
      return;
    }

    state.camera.capturing = true;
    renderCameraModalState();

    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("เบราว์เซอร์ไม่รองรับการจับภาพ");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, "image/jpeg", 0.95);
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });

      const target = state.camera.target === "edit" ? "edit" : "add";
      closeCameraModal({ force: true });
      if (target === "edit") {
        await processEditImageFile(file);
      } else {
        await processAddImageFile(file);
      }
    } catch (error) {
      state.camera.capturing = false;
      renderCameraModalState();
      showToast("error", `ถ่ายรูปไม่สำเร็จ: ${getErrorMessage(error)}`);
    }
  }

  function closeCameraModal(options = {}) {
    const force = Boolean(options.force);
    if (!state.camera.open) return;
    if (!force && state.camera.capturing) return;

    state.camera.open = false;
    state.camera.target = "add";
    state.camera.starting = false;
    state.camera.ready = false;
    state.camera.capturing = false;
    state.camera.error = "";
    stopMediaStream(state.camera.stream);
    state.camera.stream = null;

    try {
      dom.cameraVideo.pause();
    } catch (_) {
      // ignore
    }
    dom.cameraVideo.srcObject = null;

    hideModalElements(dom.cameraBackdrop, dom.cameraShell);
    dom.cameraShell.setAttribute("aria-hidden", "true");
    dom.cameraBackdrop.setAttribute("aria-hidden", "true");
    syncBodyScrollLock();
    renderCameraModalState();
  }

  function stopMediaStream(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (_) {
      // ignore
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
    if (dom.btnAddOpenCamera) {
      dom.btnAddOpenCamera.disabled = isFormLocked || state.camera.open;
    }
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
    if (scope === "done") {
      renderHistoryFilterPanel();
    }

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
    const doneTimeField = isDoneScope ? normalizeDoneHistoryTimeField(filters.timeField) : "CREATED_AT";

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
      const filterDateSource = isDoneScope
        ? getDoneHistoryTimeValue(note, doneTimeField)
        : note.createdAt;
      const noteDate = toLocalDateInputValue(filterDateSource);
      if (dateFrom && (!noteDate || noteDate < dateFrom)) return false;
      if (dateTo && (!noteDate || noteDate > dateTo)) return false;
      return true;
    });

    filtered.sort((a, b) => compareNotes(a, b, sort, scope, doneTimeField));
    return filtered;
  }

  function renderFilterControls(scope) {
    const isDoneScope = scope === "done";
    const filters = isDoneScope ? state.filters.done : state.filters.pending;
    const button = isDoneScope ? dom.btnHistoryClearFilters : dom.btnPendingClearFilters;
    if (!button) return;

    const defaultSort = isDoneScope ? "NEWEST" : "OLDEST";
    const defaultDoneTimeField = "CHECKED_AT";
    const hasActive =
      Boolean((filters.search || "").trim()) ||
      Boolean(filters.dateFrom) ||
      Boolean(filters.dateTo) ||
      String(filters.sort || defaultSort) !== defaultSort ||
      Boolean(filters.userId) ||
      (Boolean(filters.userId) && userFilterNormalizeMode(filters.userFilterMode) !== "ANY") ||
      (isDoneScope && normalizeDoneHistoryTimeField(filters.timeField) !== defaultDoneTimeField);

    button.disabled = !hasActive;
    button.classList.toggle("is-active", hasActive);
    if (isDoneScope && dom.btnToggleHistoryFilters) {
      dom.btnToggleHistoryFilters.classList.toggle("is-active", hasActive);
    }
  }

  function resetFilters(scope) {
    const isDoneScope = scope === "done";
    const filters = isDoneScope ? state.filters.done : state.filters.pending;
    const defaultSort = isDoneScope ? "NEWEST" : "OLDEST";
    const defaultDoneTimeField = "CHECKED_AT";
    const hadUserServerFilter = Boolean(filters.userId);

    filters.search = "";
    filters.dateFrom = "";
    filters.dateTo = "";
    filters.sort = defaultSort;
    filters.userFilterMode = "ANY";
    filters.userId = "";
    if (isDoneScope) {
      filters.timeField = defaultDoneTimeField;
    }

    if (isDoneScope) {
      if (dom.historySearch) dom.historySearch.value = "";
      if (dom.historyDateFrom) dom.historyDateFrom.value = "";
      if (dom.historyDateTo) dom.historyDateTo.value = "";
      if (dom.historyTimeField) dom.historyTimeField.value = defaultDoneTimeField;
      if (dom.historySort) dom.historySort.value = defaultSort;
      if (dom.historyUserFilterMode) dom.historyUserFilterMode.value = "ANY";
      if (dom.historyUserId) dom.historyUserId.value = "";
      if (hadUserServerFilter) {
        void refreshDoneNotes();
        return;
      }
      renderList("done");
    } else {
      if (dom.pendingSearch) dom.pendingSearch.value = "";
      if (dom.pendingDateFrom) dom.pendingDateFrom.value = "";
      if (dom.pendingDateTo) dom.pendingDateTo.value = "";
      if (dom.pendingSort) dom.pendingSort.value = defaultSort;
      if (dom.pendingUserFilterMode) dom.pendingUserFilterMode.value = "ANY";
      if (dom.pendingUserId) dom.pendingUserId.value = "";
      if (hadUserServerFilter) {
        void refreshPendingNotes();
        return;
      }
      renderList("pending");
    }
  }

  function compareNotes(a, b, sort, scope = "pending", doneTimeField = "CHECKED_AT") {
    const isDoneScope = scope === "done";
    const aTitle = (a.title || "").toLocaleLowerCase();
    const bTitle = (b.title || "").toLocaleLowerCase();
    const timeA = isDoneScope
      ? (toTimestamp(getDoneHistoryTimeValue(a, doneTimeField)) || toTimestamp(a.createdAt))
      : toTimestamp(a.createdAt);
    const timeB = isDoneScope
      ? (toTimestamp(getDoneHistoryTimeValue(b, doneTimeField)) || toTimestamp(b.createdAt))
      : toTimestamp(b.createdAt);

    switch (sort) {
      case "NEWEST":
        return timeB - timeA || aTitle.localeCompare(bTitle, "th");
      case "OLDEST":
      default:
        return timeA - timeB || aTitle.localeCompare(bTitle, "th");
    }
  }

  function normalizeDoneHistoryTimeField(value) {
    const v = String(value || "").trim().toUpperCase();
    return v === "CREATED_AT" ? "CREATED_AT" : "CHECKED_AT";
  }

  function getDoneHistoryTimeValue(note, timeField = "CHECKED_AT") {
    const basis = normalizeDoneHistoryTimeField(timeField);
    if (basis === "CREATED_AT") {
      return note && note.createdAt ? note.createdAt : "";
    }
    return (note && (note.checkedAt || note.createdAt)) || "";
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

  function openSideMenu() {
    if (!dom.sideMenuPanel || !dom.sideMenuBackdrop) return;
    if (!authIsLoggedIn()) return;
    if (state.sideMenu.open) return;

    state.sideMenu.open = true;
    if (dom.btnOpenSideMenu) dom.btnOpenSideMenu.setAttribute("aria-expanded", "true");
    dom.sideMenuPanel.setAttribute("aria-hidden", "false");
    dom.sideMenuBackdrop.setAttribute("aria-hidden", "false");
    showModalElements(dom.sideMenuBackdrop, dom.sideMenuPanel);
    syncBodyScrollLock();
  }

  function closeSideMenu() {
    if (!dom.sideMenuPanel || !dom.sideMenuBackdrop) return;
    if (!state.sideMenu.open) return;

    state.sideMenu.open = false;
    if (dom.btnOpenSideMenu) dom.btnOpenSideMenu.setAttribute("aria-expanded", "false");
    dom.sideMenuPanel.setAttribute("aria-hidden", "true");
    dom.sideMenuBackdrop.setAttribute("aria-hidden", "true");
    hideModalElements(dom.sideMenuBackdrop, dom.sideMenuPanel);
    syncBodyScrollLock();
  }

  function openHistoryPanel() {
    if (state.sidebar.open) return;
    state.sidebar.open = true;
    if (isMobileViewport()) {
      setHistoryFiltersCollapsed(true);
    } else {
      renderHistoryFilterPanel();
    }
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

  async function tryHydrateNoteModalImageFromCache(note, token) {
    if (!note || !note.imageFileId || note.imageDeleted) return;

    try {
      const dataUrl = await getImageFast(note.imageFileId, note.noteId || "", {
        status: note.status || "PENDING",
        doneAt: note.checkedAt || "",
      });

      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;
      if (String(state.noteModal.noteId) !== String(note.noteId || "")) return;

      const currentDetail = state.noteModal.detail || {};
      if (String(currentDetail.imageFileId || note.imageFileId) !== String(note.imageFileId)) return;
      if (state.noteModal.image.status === "loaded" && state.noteModal.image.dataUrl === dataUrl) return;

      state.noteModal.image = { status: "loaded", dataUrl, message: "" };
      if (state.noteModal.detail && !state.noteModal.detail.__localImageDataUrl) {
        state.noteModal.detail = { ...state.noteModal.detail, __localImageDataUrl: dataUrl };
      }
      renderNoteModal();
    } catch (error) {
      // Silent here: detailed error/placeholder is handled by the normal detail flow
    }
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
    if (localHasImageRecord && localNote) {
      void tryHydrateNoteModalImageFromCache(localNote, token);
    }

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
        if (detail.imageFileId) {
          void cacheLocalImageForNoteByFileId(detail, state.noteModal.detail.__localImageDataUrl);
        }
      } else if (detail.imageDataUrl) {
        state.noteModal.image = { status: "loaded", dataUrl: detail.imageDataUrl, message: "" };
        if (detail.imageFileId) {
          void cacheLocalImageForNoteByFileId(detail, detail.imageDataUrl);
        }
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
      const detail = state.noteModal.detail || {};
      const dataUrl = await getImageFast(fileId, detail.noteId || "", {
        status: detail.status || "PENDING",
        doneAt: detail.checkedAt || "",
      });
      if (token !== state.noteModal.requestToken || !state.noteModal.open) return;
      if (!dataUrl) {
        throw new Error("ไม่พบข้อมูลรูปภาพ");
      }
      if (state.noteModal.detail) {
        state.noteModal.detail = { ...state.noteModal.detail, __localImageDataUrl: dataUrl };
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
    const canAdminEditDone = !isPending && authIsAdmin();
    const canEditByPolicy = typeof detail.canEdit === "boolean" ? detail.canEdit : (isPending || canAdminEditDone);
    const canChecklistByPolicy = typeof detail.canChecklist === "boolean" ? detail.canChecklist : isPending;
    const canEditInUi = !isLocalOnly && canEditByPolicy;
    const createdAt = formatDateTime(detail.createdAt) || "-";
    const createdAtCompact = formatDateTimeCompact(detail.createdAt) || "-";
    const checkedAt = detail.checkedAt ? formatDateTime(detail.checkedAt) : "-";
    const syncMetaText = buildNoteSyncMetaText(detail);
    const imageBlock = renderDetailImageView();
    const shortNoteId = shortenNoteId(detail.noteId || "-");
    const auditInfoHtml = renderDetailAuditInfo(detail);

    let actionsHtml = "";
    if (canEditInUi) {
      actionsHtml += `<button type="button" class="btn btn--outline" data-action="modal-enter-edit">แก้ไข</button>`;
    }
    if (canChecklistByPolicy && !isLocalOnly) {
      actionsHtml += `<button type="button" class="btn btn--success" data-action="modal-request-done" data-note-id="${escapeAttribute(detail.noteId || "")}">Checklist เสร็จแล้ว</button>`;
    }
    if (isPending && isLocalOnly) {
      actionsHtml += `<span class="badge badge--subtle">รอ sync ให้เสร็จก่อน จึงแก้ไข/Checklist ได้</span>`;
    }

    let secondaryMetaHtml = "";
    if (checkedAt !== "-" || syncMetaText) {
      secondaryMetaHtml = `
        <div class="detail-meta-strip detail-meta-strip--secondary ${checkedAt !== "-" && syncMetaText ? "detail-meta-strip--2" : ""}">
          ${
            checkedAt !== "-"
              ? `<div class="detail-meta-card">
                   <span class="detail-meta-card__label">checkedAt</span>
                   <div class="detail-meta-card__value" title="${escapeAttribute(checkedAt)}">${escapeHtml(checkedAt)}</div>
                 </div>`
              : ""
          }
          ${
            syncMetaText
              ? `<div class="detail-meta-card">
                   <span class="detail-meta-card__label">sync</span>
                   <div class="detail-meta-card__value" title="${escapeAttribute(syncMetaText)}">${escapeHtml(syncMetaText)}${detail.__syncError ? ` (${escapeHtml(detail.__syncError)})` : ""}</div>
                 </div>`
              : ""
          }
        </div>
      `;
    }

    return `
      <div class="note-detail">
        <div class="note-detail__top">
          <div class="detail-grid">
            <div class="detail-row detail-row--full">
              <span class="detail-row__label">หัวข้อ</span>
              <div class="detail-row__value">${escapeHtml(detail.title || "-")}</div>
            </div>
            <div class="detail-row detail-row--full">
              <span class="detail-row__label">รายละเอียด</span>
              <div class="detail-row__value preserve-linebreak">${escapeHtml(detail.description || "-")}</div>
            </div>
          </div>
        </div>

        ${imageBlock || ""}

        <div class="detail-meta-strip">
          <div class="detail-meta-card detail-meta-card--status">
            <span class="detail-meta-card__label">สถานะ</span>
            <div class="detail-meta-card__value">
              <span class="chip ${status === "DONE" ? "chip--done" : "chip--pending"}">${escapeHtml(status)}</span>
            </div>
          </div>
          <div class="detail-meta-card">
            <span class="detail-meta-card__label">createdAt</span>
            <div class="detail-meta-card__value" title="${escapeAttribute(createdAt)}">${escapeHtml(createdAtCompact)}</div>
          </div>
          <div class="detail-meta-card">
            <span class="detail-meta-card__label">noteId</span>
            <div class="detail-meta-card__value" title="${escapeAttribute(detail.noteId || "-")}">${escapeHtml(shortNoteId)}</div>
          </div>
        </div>

        ${secondaryMetaHtml}
        ${auditInfoHtml}

        ${actionsHtml ? `<div class="detail-actions">${actionsHtml}</div>` : ""}
      </div>
    `;
  }

  function renderDetailAuditInfo(detail) {
    const auditItems = [
      ["createdBy", detail.createdByDisplayName || detail.createdByUserId || ""],
      ["checkedBy", detail.checkedByDisplayName || detail.checkedByUserId || ""],
      ["updatedBy", detail.updatedByDisplayName || detail.updatedByUserId || ""],
    ].filter(([, value]) => String(value || "").trim());

    if (!auditItems.length) return "";

    return `
      <div class="detail-meta-strip detail-meta-strip--secondary ${auditItems.length >= 2 ? "detail-meta-strip--2" : ""}">
        ${auditItems
          .map(
            ([label, value]) => `
              <div class="detail-meta-card">
                <span class="detail-meta-card__label">${escapeHtml(label)}</span>
                <div class="detail-meta-card__value" title="${escapeAttribute(String(value))}">${escapeHtml(String(value))}</div>
              </div>
            `
          )
          .join("")}
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
    if (typeof detail.canEdit === "boolean" && !detail.canEdit) return;
    if (normalizeStatus(detail.status || "PENDING") === "DONE" && !authIsAdmin()) return;

    state.noteModal.mode = "edit";
    state.noteModal.editDraft = {
      title: detail.title || "",
      description: detail.description || "",
      visibleRoleFilters: deriveVisibleRoleFiltersFromUserIds(detail.visibleToUserIds),
      visibleUserSearch: "",
      visibleToUserIds: normalizeVisibleUserIdsInput(detail.visibleToUserIds),
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
      visibleRoleFilters: deriveVisibleRoleFiltersFromUserIds(detail.visibleToUserIds),
      visibleUserSearch: "",
      visibleToUserIds: normalizeVisibleUserIdsInput(detail.visibleToUserIds),
      newImage: null,
      removeImage: false,
      compressing: false,
    };

    const imagePanel = renderEditImagePanel(detail, draft);
    const busy = Boolean(state.noteModal.saving || draft.compressing);
    const canEditDoneImage = normalizeStatus(detail.status || "PENDING") !== "DONE" || authIsAdmin();
    const canManageVisibility = authCanManageVisibleUsers() && detail.canManageVisibility !== false;
    const allowedRoles = getAllowedVisibilityRolesForCurrentRole();
    const normalizedRoleFilters = normalizeVisibleRoleFiltersInput(draft.visibleRoleFilters, allowedRoles);
    if (!Array.isArray(draft.visibleRoleFilters) || draft.visibleRoleFilters.join("|") !== normalizedRoleFilters.join("|")) {
      draft.visibleRoleFilters = normalizedRoleFilters;
    }
    const roleFilteredVisibleUsers = getFilteredAssignableUsersForRoles(draft.visibleRoleFilters);
    const visibleUsersSearch = String(draft.visibleUserSearch || "");
    const filteredVisibleUsers = filterVisibilityUsersBySearch(roleFilteredVisibleUsers, visibleUsersSearch);
    const visibleOptionsHtml = buildVisibilityUserOptionsHtml(filteredVisibleUsers, draft.visibleToUserIds);
    const visibleRoleOptionsHtml = buildVisibilityRoleOptionsHtml(draft.visibleRoleFilters, allowedRoles);
    const visibleSelectedCountText = buildVisibilitySelectedCountText(
      normalizeVisibleUserIdsInput(draft.visibleToUserIds).length
    );
    const visibilityFieldHtml = canManageVisibility
      ? `
          <label class="field">
            <span class="field__label">ผู้ใช้ที่มองเห็น NOTE</span>
            <select id="modal-edit-visible-roles" class="select-multiple" multiple ${busy ? "disabled" : ""}>
              ${visibleRoleOptionsHtml}
            </select>
            <p class="edit-note">เลือก role ก่อน (เลือกได้มากกว่า 1)</p>
            <input
              id="modal-edit-visible-user-search"
              type="search"
              placeholder="ค้นหาผู้ใช้"
              value="${escapeAttribute(visibleUsersSearch)}"
              ${busy ? "disabled" : ""}
            >
            <div class="inline-row">
              <span class="badge badge--subtle" id="modal-edit-visible-users-count-badge">${escapeHtml(visibleSelectedCountText)}</span>
            </div>
            <select id="modal-edit-visible-users" class="select-multiple" multiple ${busy ? "disabled" : ""}>
              ${visibleOptionsHtml}
            </select>
            <p class="edit-note">${escapeHtml(
              authIsSupervisor()
                ? "SUPERVISOR เลือกได้เฉพาะ USER (ADMIN เห็นทุก NOTE เสมอ และระบบจะรวมผู้สร้างให้อัตโนมัติ)"
                : "ADMIN เห็นทุก NOTE เสมอ (ไม่ต้องเลือก ADMIN) และระบบจะรวมผู้สร้างให้อัตโนมัติ"
            )}</p>
          </label>
        `
      : "";

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

          ${visibilityFieldHtml}

          <div class="field">
            <span class="field__label">รูปภาพ ${canEditDoneImage ? "(แก้ไขได้)" : "(แก้ไขได้เฉพาะ Pending)"}</span>
            <input id="modal-edit-image-input" type="file" accept="image/*" class="hidden-input" ${busy ? "disabled" : ""}>
            <div class="edit-form__image-actions">
              <button type="button" class="btn btn--outline btn--sm" data-action="modal-open-edit-camera" ${busy ? "disabled" : ""}>
                ถ่ายรูป
              </button>
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
      return `<button type="button" class="btn btn--outline btn--sm btn--push-end" data-action="modal-undo-remove-image" ${busy ? "disabled" : ""}>ยกเลิกลบรูป</button>`;
    }

    if (draft.newImage || hasOriginalRecord) {
      return `<button type="button" class="btn btn--danger-soft btn--sm btn--push-end" data-action="modal-remove-edit-image" ${busy ? "disabled" : ""}>ลบรูป</button>`;
    }

    return "";
  }

  function renderAssignableUserOptionsHtml(selectedIds = []) {
    const users = getAssignableUsersForCurrentRole();
    const selected = new Set(normalizeVisibleUserIdsInput(selectedIds));
    return users
      .map((user) => {
        const uid = String(user.userId || "");
        const label = `${user.displayName || user.username || uid} (${user.role || "USER"})`;
        return `<option value="${escapeAttribute(uid)}"${selected.has(uid) ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function renderEditVisibleUsersSelectorControl() {
    if (state.noteModal.mode !== "edit" || !state.noteModal.editDraft || !dom.noteModalBody) return;

    const draft = state.noteModal.editDraft;
    const rolesEl = dom.noteModalBody.querySelector("#modal-edit-visible-roles");
    const searchEl = dom.noteModalBody.querySelector("#modal-edit-visible-user-search");
    const usersEl = dom.noteModalBody.querySelector("#modal-edit-visible-users");
    const badgeEl = dom.noteModalBody.querySelector("#modal-edit-visible-users-count-badge");
    if (!usersEl) return;

    const allowedRoles = getAllowedVisibilityRolesForCurrentRole();
    draft.visibleRoleFilters = normalizeVisibleRoleFiltersInput(draft.visibleRoleFilters, allowedRoles);
    const roleFilteredUsers = getFilteredAssignableUsersForRoles(draft.visibleRoleFilters);
    const allowedIds = new Set(roleFilteredUsers.map((u) => String(u.userId || "")));
    draft.visibleToUserIds = normalizeVisibleUserIdsInput(draft.visibleToUserIds).filter((id) => allowedIds.has(id));

    if (rolesEl) {
      rolesEl.innerHTML = buildVisibilityRoleOptionsHtml(draft.visibleRoleFilters, allowedRoles);
    }
    if (searchEl && searchEl.value !== String(draft.visibleUserSearch || "")) {
      searchEl.value = String(draft.visibleUserSearch || "");
    }

    const visibleUsers = filterVisibilityUsersBySearch(roleFilteredUsers, draft.visibleUserSearch);
    usersEl.innerHTML = buildVisibilityUserOptionsHtml(visibleUsers, draft.visibleToUserIds);
    setSelectedValuesForSelect(usersEl, draft.visibleToUserIds);

    if (badgeEl) {
      badgeEl.textContent = buildVisibilitySelectedCountText(
        normalizeVisibleUserIdsInput(draft.visibleToUserIds).length
      );
    }
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

    if (action === "modal-open-edit-camera") {
      void openCameraModal("edit");
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
      return;
    }

    if (event.target && event.target.id === "modal-edit-visible-user-search") {
      state.noteModal.editDraft.visibleUserSearch = String(event.target.value || "");
      renderEditVisibleUsersSelectorControl();
    }
  }

  async function handleNoteModalChange(event) {
    if (event.target && event.target.id === "modal-edit-visible-roles") {
      syncNoteModalDraftFromInputs();
      if (state.noteModal.editDraft) {
        const allowedRoles = getAllowedVisibilityRolesForCurrentRole();
        state.noteModal.editDraft.visibleRoleFilters = normalizeVisibleRoleFiltersInput(
          getSelectedValuesFromSelect(event.target),
          allowedRoles
        );
        const filteredUsers = getFilteredAssignableUsersForRoles(state.noteModal.editDraft.visibleRoleFilters);
        const allowedIds = new Set(filteredUsers.map((u) => String(u.userId || "")));
        state.noteModal.editDraft.visibleToUserIds = normalizeVisibleUserIdsInput(state.noteModal.editDraft.visibleToUserIds)
          .filter((id) => allowedIds.has(id));
      }
      renderEditVisibleUsersSelectorControl();
      return;
    }
    if (event.target && event.target.id === "modal-edit-visible-users") {
      syncNoteModalDraftFromInputs();
      return;
    }
    if (event.target && event.target.id === "modal-edit-image-input") {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file) return;
      await processEditImageFile(file);
    }
  }

  async function processEditImageFile(file) {
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
      showToast("error", `เตรียมรูปไม่สำเร็จ: ${getErrorMessage(error)}`);
    } finally {
      if (state.noteModal.editDraft) {
        state.noteModal.editDraft.compressing = false;
      }
      renderNoteModal();
    }
  }

  function syncNoteModalDraftFromInputs() {
    if (state.noteModal.mode !== "edit" || !state.noteModal.editDraft) return;
    const titleEl = dom.noteModalBody.querySelector("#modal-edit-title");
    const descEl = dom.noteModalBody.querySelector("#modal-edit-description");
    const visibleRolesEl = dom.noteModalBody.querySelector("#modal-edit-visible-roles");
    const visibleUserSearchEl = dom.noteModalBody.querySelector("#modal-edit-visible-user-search");
    const visibleUsersEl = dom.noteModalBody.querySelector("#modal-edit-visible-users");
    if (titleEl) state.noteModal.editDraft.title = titleEl.value;
    if (descEl) state.noteModal.editDraft.description = descEl.value;
    if (visibleRolesEl) {
      state.noteModal.editDraft.visibleRoleFilters = normalizeVisibleRoleFiltersInput(
        getSelectedValuesFromSelect(visibleRolesEl),
        getAllowedVisibilityRolesForCurrentRole()
      );
    }
    if (visibleUserSearchEl) {
      state.noteModal.editDraft.visibleUserSearch = String(visibleUserSearchEl.value || "");
    }
    if (visibleUsersEl) {
      const roleFilteredUsers = getFilteredAssignableUsersForRoles(state.noteModal.editDraft.visibleRoleFilters);
      const visibleUsers = filterVisibilityUsersBySearch(roleFilteredUsers, state.noteModal.editDraft.visibleUserSearch);
      const selection = readVisibilityUserSelectionFromSelect(visibleUsersEl, visibleUsers);
      state.noteModal.editDraft.visibleToUserIds = mergeVisibilityUserSelectionKeepingHidden(
        state.noteModal.editDraft.visibleToUserIds,
        selection.userIds,
        visibleUsers
      );
      if (selection.usedSelectAll) {
        renderEditVisibleUsersSelectorControl();
        return;
      }
      renderEditVisibleUsersSelectorControl();
    }
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
      if (authCanManageVisibleUsers() && state.noteModal.detail && state.noteModal.detail.canManageVisibility !== false) {
        const visibleIds = normalizeVisibleUserIdsInput(draft.visibleToUserIds);
        data.visibleToUserIds = visibleIds;
      }
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

  // === AUTH PATCH START ===
  function openUserMgmtModal() {
    if (!authIsAdmin()) {
      showToast("warn", "เฉพาะ ADMIN เท่านั้น");
      return;
    }
    if (!dom.userMgmtShell || !dom.userMgmtBackdrop) {
      showToast("warn", "User Management UI ไม่พร้อมใช้งาน");
      return;
    }

    state.userMgmt.open = true;
    state.userMgmt.creating = false;
    state.userMgmt.error = "";
    renderUserMgmtModalState();
    showModalElements(dom.userMgmtBackdrop, dom.userMgmtShell);
    dom.userMgmtShell.setAttribute("aria-hidden", "false");
    dom.userMgmtBackdrop.setAttribute("aria-hidden", "false");
    syncBodyScrollLock();

    window.setTimeout(() => {
      if (state.userMgmt.open && dom.userMgmtUsername) dom.userMgmtUsername.focus();
    }, CONFIG.modalTransitionMs);
  }

  function closeUserMgmtModal(options = {}) {
    if (!state.userMgmt.open) return;
    if (!options.force && state.userMgmt.creating) return;

    state.userMgmt.open = false;
    state.userMgmt.creating = false;
    state.userMgmt.error = "";
    renderUserMgmtModalState();
    hideModalElements(dom.userMgmtBackdrop, dom.userMgmtShell);
    dom.userMgmtShell.setAttribute("aria-hidden", "true");
    dom.userMgmtBackdrop.setAttribute("aria-hidden", "true");
    syncBodyScrollLock();
  }

  function renderUserMgmtModalState() {
    if (!dom.userMgmtShell) return;

    const busy = Boolean(state.userMgmt.creating);
    if (dom.userMgmtUsername) dom.userMgmtUsername.disabled = busy;
    if (dom.userMgmtPassword) dom.userMgmtPassword.disabled = busy;
    if (dom.userMgmtDisplayName) dom.userMgmtDisplayName.disabled = busy;
    if (dom.userMgmtRole) dom.userMgmtRole.disabled = busy;
    if (dom.userMgmtIsActive) dom.userMgmtIsActive.disabled = busy;
    if (dom.btnUserMgmtClose) dom.btnUserMgmtClose.disabled = busy;
    if (dom.btnUserMgmtCancel) dom.btnUserMgmtCancel.disabled = busy;
    if (dom.btnUserMgmtSubmit) {
      dom.btnUserMgmtSubmit.disabled = busy;
      if (!dom.btnUserMgmtSubmit.dataset.defaultLabel) {
        dom.btnUserMgmtSubmit.dataset.defaultLabel = dom.btnUserMgmtSubmit.textContent || "สร้างผู้ใช้";
      }
      dom.btnUserMgmtSubmit.textContent = busy
        ? "กำลังสร้าง..."
        : (dom.btnUserMgmtSubmit.dataset.defaultLabel || "สร้างผู้ใช้");
    }

    if (dom.userMgmtError) {
      const message = String(state.userMgmt.error || "");
      dom.userMgmtError.textContent = message;
      dom.userMgmtError.classList.toggle("hidden", !message);
    }
  }

  async function submitCreateUser() {
    if (!state.userMgmt.open || state.userMgmt.creating) return;
    if (!authIsAdmin()) {
      showToast("warn", "เฉพาะ ADMIN เท่านั้น");
      return;
    }

    const username = String((dom.userMgmtUsername && dom.userMgmtUsername.value) || "").trim();
    const password = String((dom.userMgmtPassword && dom.userMgmtPassword.value) || "");
    const displayName = String((dom.userMgmtDisplayName && dom.userMgmtDisplayName.value) || "").trim();
    const rawRole = String((dom.userMgmtRole && dom.userMgmtRole.value) || "USER").trim().toUpperCase();
    const role = rawRole === "ADMIN" || rawRole === "SUPERVISOR" ? rawRole : "USER";
    const isActive = String((dom.userMgmtIsActive && dom.userMgmtIsActive.value) || "true") !== "false";

    if (!username || !password || !displayName) {
      state.userMgmt.error = "กรุณากรอก username, password และ displayName";
      renderUserMgmtModalState();
      return;
    }

    state.userMgmt.creating = true;
    state.userMgmt.error = "";
    renderUserMgmtModalState();

    try {
      await apiPost("createUser", { username, password, displayName, role, isActive });
      showToast("success", "สร้างผู้ใช้เรียบร้อย");
      if (dom.userMgmtForm) dom.userMgmtForm.reset();
      if (dom.userMgmtRole) dom.userMgmtRole.value = "USER";
      if (dom.userMgmtIsActive) dom.userMgmtIsActive.value = "true";
      closeUserMgmtModal({ force: true });
      await authLoadUsers();
    } catch (error) {
      const message = getErrorMessage(error);
      state.userMgmt.creating = false;
      state.userMgmt.error = /unknown.*createuser|not found|unknown post action/i.test(message)
        ? "Backend ยังไม่รองรับ createUser endpoint"
        : message;
      renderUserMgmtModalState();
      if (/unknown.*createuser|not found|unknown post action/i.test(message)) {
        showToast("warn", "createUser endpoint ยังไม่พร้อมใช้งาน");
      }
    }
  }
  // === AUTH PATCH END ===

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

      removeLocalNoteCache(noteId, { skipRebuild: true });

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

    if (state.camera.open) {
      closeCameraModal();
      return;
    }
    if (state.userMgmt.open) {
      closeUserMgmtModal();
      return;
    }
    if (state.sideMenu.open) {
      closeSideMenu();
      return;
    }
    if (state.dashboard.open) {
      closeDashboardModal();
      return;
    }
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
      state.sidebar.open ||
      state.sideMenu.open ||
      state.noteModal.open ||
      state.confirm.open ||
      state.addPage.open ||
      state.camera.open ||
      state.userMgmt.open ||
      state.dashboard.open ||
      state.auth.loginOpen;
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
      headers: authBuildHeaders({ Accept: "application/json" }),
    });
  }

  async function apiPost(action, payload = {}) {
    const isObjectPayload = payload && typeof payload === "object" && !Array.isArray(payload);
    const requestBody = isObjectPayload
      ? { action, ...payload, payload }
      : { action, payload };

    return requestJson(API_BASE, {
      method: "POST",
      headers: authBuildHeaders({
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
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
      const message = extractApiError(parsed) || `HTTP ${response.status}`;
      if (authIsUnauthorizedMessage(message, response.status)) {
        void authHandleUnauthorized(message);
      }
      throw new Error(message);
    }

    if (parsed && typeof parsed === "object") {
      const explicitFailure =
        parsed.ok === false ||
        parsed.success === false ||
        parsed.status === "error" ||
        parsed.error === true;

      if (explicitFailure) {
        const message = extractApiError(parsed) || "API ตอบกลับ error";
        if (authIsUnauthorizedMessage(message, response.status)) {
          void authHandleUnauthorized(message);
        }
        throw new Error(message);
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
      createdByUserId: String(coalesce(source.createdByUserId, source.created_by_user_id, source.createdBy, "") || ""),
      checkedByUserId: String(coalesce(source.checkedByUserId, source.checked_by_user_id, source.checkedBy, "") || ""),
      updatedByUserId: String(coalesce(source.updatedByUserId, source.updated_by_user_id, source.updatedBy, "") || ""),
      createdByDisplayName: String(
        coalesce(source.createdByDisplayName, source.created_by_display_name, source.createdByName, "") || ""
      ),
      checkedByDisplayName: String(
        coalesce(source.checkedByDisplayName, source.checked_by_display_name, source.checkedByName, "") || ""
      ),
      updatedByDisplayName: String(
        coalesce(source.updatedByDisplayName, source.updated_by_display_name, source.updatedByName, "") || ""
      ),
      visibleToUserIds: normalizeVisibleUserIdsInput(
        coalesce(source.visibleToUserIds, source.visible_to_user_ids, source.visibleUsers, source.visibleTo, [])
      ),
      canEdit: toMaybeBoolean(coalesce(source.canEdit, source.can_edit, "")),
      canChecklist: toMaybeBoolean(coalesce(source.canChecklist, source.can_checklist, "")),
      isReadOnly: toMaybeBoolean(coalesce(source.isReadOnly, source.is_read_only, "")),
      canRemoveImageInDone: toMaybeBoolean(coalesce(source.canRemoveImageInDone, source.can_remove_image_in_done, "")),
      canManageVisibility: toMaybeBoolean(coalesce(source.canManageVisibility, source.can_manage_visibility, "")),
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

  function toMaybeBoolean(value) {
    if (value === "" || value === null || value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return undefined;
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
    drawTimestampOverlay(ctx, targetWidth, targetHeight, new Date());

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

  function drawTimestampOverlay(ctx, width, height, dateValue) {
    const stamp = formatImageTimestamp(dateValue);
    const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.032));
    const padX = Math.max(10, Math.round(fontSize * 0.7));
    const padY = Math.max(7, Math.round(fontSize * 0.45));
    const margin = Math.max(10, Math.round(fontSize * 0.65));
    const radius = Math.max(8, Math.round(fontSize * 0.55));

    ctx.save();
    ctx.font = `700 ${fontSize}px "Segoe UI", Tahoma, sans-serif`;
    ctx.textBaseline = "middle";

    const textWidth = Math.ceil(ctx.measureText(stamp).width);
    const boxWidth = textWidth + padX * 2;
    const boxHeight = fontSize + padY * 2;
    const x = Math.max(margin, width - boxWidth - margin);
    const y = Math.max(margin, height - boxHeight - margin);

    drawRoundedRectPath(ctx, x, y, boxWidth, boxHeight, radius);
    ctx.fillStyle = "rgba(10, 20, 34, 0.58)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.08));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(stamp, x + padX, y + boxHeight / 2);
    ctx.restore();
  }

  function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function formatImageTimestamp(dateValue) {
    const d = parseDate(dateValue) || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") {
        try {
          const dataUrl = canvas.toDataURL(type, quality);
          resolve(dataUrlToBlob(dataUrl));
        } catch (error) {
          reject(new Error("แปลงภาพไม่สำเร็จ"));
        }
        return;
      }
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("แปลงภาพไม่สำเร็จ"));
            return;
          }
          resolve(blob);
        },
        type,
        quality
      );
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || "").split(",");
    if (parts.length < 2) throw new Error("dataURL ไม่ถูกต้อง");
    const mimeMatch = parts[0].match(/data:([^;]+);base64/i);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
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

  function formatDateTimeCompact(value) {
    const date = parseDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "short",
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

  function shortenNoteId(noteId) {
    const value = String(noteId || "");
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
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
