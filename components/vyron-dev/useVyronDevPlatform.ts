"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatformWorkspaceId, isVyronDevUuid } from "@/lib/developer-workspace";
import { shouldSuppressWorkspaceLoadMessage } from "@/lib/company-access";
import { writeAuditLog } from "@/lib/audit-log";
import { supabase } from "@/lib/supabase";
import {
  endSupportSession,
  fetchVyronDevPlatformStateFromSupabase,
  mergeVyronDevPlatformState,
  openProductWorkspace,
  readVyronDevActiveClient,
  readVyronDevPlatformState,
  readVyronDevSupportSession,
  saveClientIntegrationToSupabase,
  saveClientProductStatusToSupabase,
  saveProductWorkspaceToSupabase,
  saveSupportSessionToSupabase,
  saveVyronClientToSupabase,
  setClientProductStatus,
  startSupportSession,
  syncDefaultPackagesToSupabase,
  syncProvisionedClientToSupabase,
  upsertClientProfile,
  writeVyronDevActiveClient,
  writeVyronDevPlatformState,
  writeVyronDevSupportSession,
  type VyronDevActiveClientContext,
  type VyronDevClientProfile,
  type VyronDevPersistenceStatus,
  type VyronDevPlatformState,
  type VyronProductCode,
  type VyronProductStatus,
  type VyronSupportSession,
  type VyronSupportSessionContext,
} from "@/lib/vyron-dev-platform";

export const VYRON_DEV_PLATFORM_CHANGED_EVENT = "vyron-dev-platform-changed";
export const VYRON_DEV_ACTIVE_CLIENT_CHANGED_EVENT = "vyron-dev-active-client-changed";
export const VYRON_DEV_SUPPORT_SESSION_CHANGED_EVENT = "vyron-dev-support-session-changed";

const EMPTY_PLATFORM_STATE: VyronDevPlatformState = {
  clientProfiles: {},
  productWorkspaces: [],
  clientPackageAssignments: {},
  supportSessions: [],
  clientIntegrations: [],
};

export function useVyronDevPlatform() {
  const [platformState, setPlatformState] = useState<VyronDevPlatformState>(() =>
    typeof window === "undefined" ? EMPTY_PLATFORM_STATE : readVyronDevPlatformState()
  );
  const [activeClient, setActiveClient] = useState<VyronDevActiveClientContext | null>(() =>
    typeof window === "undefined" ? null : readVyronDevActiveClient()
  );
  const [supportSession, setSupportSession] = useState<VyronSupportSessionContext | null>(() =>
    typeof window === "undefined" ? null : readVyronDevSupportSession()
  );
  const [loading, setLoading] = useState(true);
  const [persistenceStatus, setPersistenceStatus] = useState<VyronDevPersistenceStatus>("local");
  const [packagesSynced, setPackagesSynced] = useState(false);
  const supabaseReadyRef = useRef(false);
  const initialLoadDoneRef = useRef(false);

  const applyPlatformState = useCallback((next: VyronDevPlatformState) => {
    writeVyronDevPlatformState(next);
    setPlatformState(next);
    window.dispatchEvent(new Event(VYRON_DEV_PLATFORM_CHANGED_EVENT));
  }, []);

  const refreshPlatformState = useCallback(async () => {
    const local = readVyronDevPlatformState();
    applyPlatformState(local);
    setPersistenceStatus("syncing");

    const remoteResult = await fetchVyronDevPlatformStateFromSupabase();
    if (remoteResult.state) {
      const merged = mergeVyronDevPlatformState(local, remoteResult.state);
      applyPlatformState(merged);
      supabaseReadyRef.current = true;
      setPersistenceStatus("supabase");
    } else if (remoteResult.error && !shouldSuppressWorkspaceLoadMessage(remoteResult.error)) {
      setPersistenceStatus("error");
    } else {
      supabaseReadyRef.current = remoteResult.tablesAvailable;
      setPersistenceStatus("local");
    }
  }, [applyPlatformState]);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    async function bootstrap() {
      setLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        setPersistenceStatus("local");
        setLoading(false);
        return;
      }

      await getPlatformWorkspaceId();
      await refreshPlatformState();

      const packageSync = await syncDefaultPackagesToSupabase();
      setPackagesSynced(packageSync.ok);
      if (packageSync.ok) {
        supabaseReadyRef.current = true;
        setPersistenceStatus("supabase");
      }

      setLoading(false);
    }

    void bootstrap();

    function reloadPlatform() {
      setPlatformState(readVyronDevPlatformState());
    }
    function reloadActiveClient() {
      setActiveClient(readVyronDevActiveClient());
    }
    function reloadSupportSession() {
      setSupportSession(readVyronDevSupportSession());
    }
    function onStorage(event: StorageEvent) {
      if (event.key === "vyron_dev_platform_state") reloadPlatform();
      if (event.key === "vyron_dev_active_client") reloadActiveClient();
      if (event.key === "vyron_dev_support_session") reloadSupportSession();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(VYRON_DEV_PLATFORM_CHANGED_EVENT, reloadPlatform);
    window.addEventListener(VYRON_DEV_ACTIVE_CLIENT_CHANGED_EVENT, reloadActiveClient);
    window.addEventListener(VYRON_DEV_SUPPORT_SESSION_CHANGED_EVENT, reloadSupportSession);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(VYRON_DEV_PLATFORM_CHANGED_EVENT, reloadPlatform);
      window.removeEventListener(VYRON_DEV_ACTIVE_CLIENT_CHANGED_EVENT, reloadActiveClient);
      window.removeEventListener(VYRON_DEV_SUPPORT_SESSION_CHANGED_EVENT, reloadSupportSession);
    };
  }, [refreshPlatformState]);

  const backgroundSyncState = useCallback(
    async (next: VyronDevPlatformState) => {
      if (!supabaseReadyRef.current) {
        const probe = await fetchVyronDevPlatformStateFromSupabase();
        supabaseReadyRef.current = probe.tablesAvailable;
        if (!probe.tablesAvailable) {
          setPersistenceStatus("local");
          return;
        }
      }

      setPersistenceStatus("syncing");
      const changedProfiles = Object.values(next.clientProfiles).filter((profile) =>
        isVyronDevUuid(profile.clientId)
      );
      for (const profile of changedProfiles) {
        const result = await saveVyronClientToSupabase(profile);
        if (!result.ok) {
          setPersistenceStatus(result.error ? "error" : "local");
          return;
        }
      }

      for (const ws of next.productWorkspaces.filter((item) => isVyronDevUuid(item.clientId))) {
        const result = await saveProductWorkspaceToSupabase(ws);
        if (!result.ok) {
          setPersistenceStatus(result.error ? "error" : "local");
          return;
        }
      }

      for (const session of next.supportSessions) {
        const result = await saveSupportSessionToSupabase(session);
        if (!result.ok) {
          setPersistenceStatus(result.error ? "error" : "local");
          return;
        }
      }

      for (const integration of next.clientIntegrations.filter((item) =>
        isVyronDevUuid(item.clientId)
      )) {
        const result = await saveClientIntegrationToSupabase(integration);
        if (!result.ok) {
          setPersistenceStatus(result.error ? "error" : "local");
          return;
        }
      }

      setPersistenceStatus("supabase");
    },
    []
  );

  const updatePlatformState = useCallback(
    (next: VyronDevPlatformState) => {
      applyPlatformState(next);
      void backgroundSyncState(next);
    },
    [applyPlatformState, backgroundSyncState]
  );

  const updateClientProfile = useCallback(
    (profile: VyronDevClientProfile) => {
      const next = upsertClientProfile(platformState, profile);
      updatePlatformState(next);
    },
    [platformState, updatePlatformState]
  );

  const updateClientProductStatus = useCallback(
    (
      clientId: string,
      productCode: VyronProductCode,
      status: VyronProductStatus,
      packageId?: string | null
    ) => {
      const next = setClientProductStatus(platformState, clientId, productCode, status, packageId);
      updatePlatformState(next);
    },
    [platformState, updatePlatformState]
  );

  const startClientSupportSession = useCallback(
    (params: {
      operator: string;
      clientId: string;
      clientName: string;
      productCode: VyronProductCode;
    }) => {
      const { state: next, session } = startSupportSession(platformState, params);
      updatePlatformState(next);
      writeVyronDevSupportSession(session);
      setSupportSession(session);
      window.dispatchEvent(new Event(VYRON_DEV_SUPPORT_SESSION_CHANGED_EVENT));
      void writeAuditLog(supabase, {
        companyId: params.clientId,
        userEmail: params.operator,
        action: "login_as_client",
        entityType: "support_session",
        entityId: session.sessionId,
        metadata: {
          clientName: params.clientName,
          productCode: params.productCode,
        },
      });
      return session;
    },
    [platformState, updatePlatformState]
  );

  const endClientSupportSession = useCallback(
    (sessionId?: string) => {
      const targetId = sessionId || supportSession?.sessionId;
      if (!targetId) return;

      const next = endSupportSession(platformState, targetId);
      updatePlatformState(next);

      const ended = next.supportSessions.find((s) => s.sessionId === targetId);
      if (ended) {
        void saveSupportSessionToSupabase(ended);
      }

      writeVyronDevSupportSession(null);
      setSupportSession(null);
      window.dispatchEvent(new Event(VYRON_DEV_SUPPORT_SESSION_CHANGED_EVENT));
    },
    [platformState, supportSession, updatePlatformState]
  );

  const syncProvisionedClient = useCallback(
    async (clientId: string, state: VyronDevPlatformState): Promise<"local" | "supabase"> => {
      setPersistenceStatus("syncing");
      const result = await syncProvisionedClientToSupabase(state, clientId);
      setPersistenceStatus(result === "supabase" ? "supabase" : "local");
      if (result === "supabase") {
        supabaseReadyRef.current = true;
      }
      return result;
    },
    []
  );

  const persistWorkspaceOpen = useCallback(
    (clientId: string, productCode: VyronProductCode) => {
      const next = openProductWorkspace(platformState, clientId, productCode);
      updatePlatformState(next);
      const ws = next.productWorkspaces.find(
        (item) => item.clientId === clientId && item.productCode === productCode
      );
      if (ws) {
        void saveProductWorkspaceToSupabase(ws);
      }
    },
    [platformState, updatePlatformState]
  );

  const persistActiveClient = useCallback((next: VyronDevActiveClientContext | null) => {
    writeVyronDevActiveClient(next);
    setActiveClient(next);
    window.dispatchEvent(new Event(VYRON_DEV_ACTIVE_CLIENT_CHANGED_EVENT));
  }, []);

  const persistSupportSession = useCallback(
    (next: VyronSupportSessionContext | null) => {
      writeVyronDevSupportSession(next);
      setSupportSession(next);
      window.dispatchEvent(new Event(VYRON_DEV_SUPPORT_SESSION_CHANGED_EVENT));
      if (next) {
        const session: VyronSupportSession = {
          sessionId: next.sessionId,
          operator: next.operator,
          clientId: next.clientId,
          clientName: next.companyName,
          productCode: next.productCode,
          startedAt: next.startedAt,
          endedAt: null,
          status: "active",
        };
        void saveSupportSessionToSupabase(session);
      }
    },
    []
  );

  return {
    platformState,
    activeClient,
    supportSession,
    loading,
    persistenceStatus,
    packagesSynced,
    refreshPlatformState,
    updatePlatformState,
    updateClientProfile,
    updateClientProductStatus,
    startClientSupportSession,
    endClientSupportSession,
    syncProvisionedClient,
    persistWorkspaceOpen,
    persistPlatformState: updatePlatformState,
    persistActiveClient,
    persistSupportSession,
  };
}
