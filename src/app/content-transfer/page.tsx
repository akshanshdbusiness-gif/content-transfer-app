"use client";

import { useAuth0 } from "@auth0/auth0-react";
import type { ApplicationContext } from "@sitecore-marketplace-sdk/client";
import { useCallback, useEffect, useState } from "react";
import { TransferForm } from "@/src/components/TransferForm";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import { validateItemPath } from "@/src/utils/authoring";
import { runSdkTransfer } from "@/src/utils/sdk-transfer";
import type {
  EnvironmentOption,
  JobLogEntry,
  JobStatus,
  TransferRequest,
} from "@/src/lib/types";

// "backend": transfers run in our API routes with automation-client tokens
//            (works today; the Content Transfer API is not yet grantable via
//            Marketplace API access).
// "sdk":     transfers run in the browser via xmc.contentTransfer.* with
//            built-in authorization (switch once the portal lists the API).
const TRANSFER_MODE =
  process.env.NEXT_PUBLIC_TRANSFER_MODE === "sdk" ? "sdk" : "backend";

function ContentTransferPage() {
  const {
    isLoading: authLoading,
    isAuthenticated,
    loginWithPopup,
    getAccessTokenSilently,
    error: authError,
  } = useAuth0();
  const { client: mpClient, isInitialized: mpReady } = useMarketplaceClient();

  const [appContext, setAppContext] = useState<ApplicationContext>();
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobLog, setJobLog] = useState<JobLogEntry[]>([]);
  const [jobError, setJobError] = useState<string | null>(null);
  // Set when a token can't be acquired silently or an API rejects it (401/403);
  // forces the user back to the "Sign in with Sitecore" screen.
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [envLoading, setEnvLoading] = useState(true);

  // Get a fresh access token; if the session is gone (refresh expired, revoked),
  // tag the error so first-load callers can re-prompt sign-in.
  const getToken = useCallback(async () => {
    try {
      return await getAccessTokenSilently();
    } catch (err) {
      (err as { authFailed?: boolean }).authFailed = true;
      throw err;
    }
  }, [getAccessTokenSilently]);

  // Backend mode: user token proves who is asking; verified in the API routes.
  // Failures carry the HTTP status so the caller can distinguish auth (401/403)
  // from ordinary errors.
  const callApi = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken();
      const response = await fetch(path, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(
          data.error ?? `Request failed (${response.status})`,
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return data;
    },
    [getToken],
  );

  useEffect(() => {
    if (!mpReady || !mpClient) return;
    mpClient
      .query("application.context")
      .then((res) => setAppContext(res.data))
      .catch(() => {
        /* not running inside the portal — backend mode still works */
      });
  }, [mpReady, mpClient]);

  useEffect(() => {
    if (TRANSFER_MODE === "backend") {
      if (!isAuthenticated) return;
      setEnvLoading(true);

      // Silent token acquisition can hang when the app is opened directly
      // (outside the portal) with no established session — cap the wait so the
      // UI never spins forever.
      const timeout = setTimeout(() => {
        setEnvLoading(false);
        setApiError(
          "Couldn't reach the app backend. If you opened ContentCourier directly, sign in again, or open it from the Sitecore Cloud Portal.",
        );
      }, 15000);

      callApi("/api/environments")
        .then((data) =>
          setEnvironments(
            data.environments.map(
              (e: { name: string; contextId?: string | null }) => ({
                value: e.name,
                label: e.name,
                contextId: e.contextId ?? undefined,
              }),
            ),
          ),
        )
        .catch((err) => {
          // First-load token check: a rejected/expired token here sends the
          // user back to the sign-in screen. Other failures stay inline.
          if (err?.authFailed || err?.status === 401 || err?.status === 403) {
            setTokenInvalid(true);
          } else {
            setApiError(err.message);
          }
        })
        .finally(() => {
          clearTimeout(timeout);
          setEnvLoading(false);
        });

      return () => clearTimeout(timeout);
    } else {
      // SDK mode: environments = resources the app is installed on; the
      // preview context id addresses the CM of each environment. This only
      // resolves inside the portal, so stop "loading" once the client is ready.
      if (mpReady) setEnvLoading(false);
      const resources = appContext?.resourceAccess ?? appContext?.resources;
      if (!resources) return;
      setEnvironments(
        resources
          .filter((r) => r.context?.preview)
          .map((r) => ({
            value: r.context.preview,
            label: r.tenantDisplayName ?? r.tenantName ?? r.tenantId,
            contextId: r.context.preview,
          })),
      );
    }
  }, [isAuthenticated, callApi, appContext, mpReady]);

  const appendLog = (message: string) =>
    setJobLog((log) => [
      ...log,
      { time: new Date().toISOString(), message },
    ]);

  // The POST streams progress as newline-delimited JSON; read it line by line.
  const startBackendTransfer = async (request: TransferRequest) => {
    const token = await getToken();
    const response = await fetch("/api/transfers", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? `Request failed (${response.status})`);
    }

    setJobStatus("running");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "log") {
            appendLog(event.message);
          } else if (event.type === "done") {
            finished = true;
            setJobStatus(event.status);
            setJobError(event.error ?? null);
          }
        } catch {
          // ignore malformed stream lines
        }
      }
    }
    setSubmitting(false);
    // If the stream ended without a "done" event (e.g. function timeout),
    // surface that instead of leaving the status stuck on "running".
    if (!finished) {
      setJobStatus("failed");
      setJobError(
        "Connection ended before the transfer reported completion — it may have hit the serverless time limit.",
      );
    }
  };

  const startSdkTransfer = async (request: TransferRequest) => {
    if (!mpClient) throw new Error("Marketplace client not ready");
    setJobStatus("running");
    try {
      await runSdkTransfer(mpClient, {
        transferId: crypto.randomUUID(),
        items: request.items,
        mergeStrategy: request.mergeStrategy,
        database: request.database,
        sourceContextId: request.sourceEnvironment,
        targetContextId: request.targetEnvironment,
        onLog: appendLog,
      });
      setJobStatus("completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJobStatus("failed");
      setJobError(message);
      appendLog(`Transfer failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const startTransfer = async (request: TransferRequest) => {
    setApiError(null);
    setJobError(null);
    setJobLog([]);
    setJobStatus(null);
    setSubmitting(true);
    try {
      if (TRANSFER_MODE === "backend") {
        await startBackendTransfer(request);
      } else {
        await startSdkTransfer(request);
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  // Backend mode checks the path through our API with the user token (the
  // marketplace M2M proxy is not provisioned for custom-authorization apps);
  // sdk mode goes through the marketplace client.
  const validatePath = useCallback(
    async (path: string, sourceValue: string) => {
      if (TRANSFER_MODE === "backend") {
        try {
          const data = await callApi("/api/validate-item", {
            method: "POST",
            body: JSON.stringify({
              itemPath: path,
              sourceEnvironment: sourceValue,
            }),
          });
          return data.message as string;
        } catch (err) {
          return `Path check failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if (!mpClient) return "Marketplace client not ready — skipping check";
      const source = environments.find((e) => e.value === sourceValue);
      if (!source?.contextId) {
        return 'No contextId configured for the source environment — add "contextId" to its SITECORE_ENVIRONMENTS entry';
      }
      return validateItemPath(mpClient, path, source.contextId);
    },
    [mpClient, environments, callApi],
  );

  if (TRANSFER_MODE === "backend" && authLoading) {
    return <main>Checking your Sitecore session…</main>;
  }

  if (TRANSFER_MODE === "backend" && (!isAuthenticated || tokenInvalid)) {
    const signIn = async () => {
      setTokenInvalid(false);
      setApiError(null);
      await loginWithPopup();
    };
    return (
      <main>
        <h1>ContentCourier</h1>
        <p>
          Delivering content safely between your SitecoreAI environments. Sign
          in with your Sitecore account to continue — access is limited to
          Organization Admins and Owners.
        </p>
        {tokenInvalid && (
          <p className="error">
            Your Sitecore session has expired or is no longer valid. Please sign
            in again to continue.
          </p>
        )}
        {authError && <p className="error">{authError.message}</p>}
        <button onClick={signIn}>Sign in with Sitecore</button>
      </main>
    );
  }

  return (
    <main>
      <h1>ContentCourier</h1>
      <p className="hint">
        Pick a path, choose source and target, and ship your content between
        SitecoreAI environments with live progress every step of the way.
        Organization Admin/Owner only.
        {mpReady
          ? ""
          : " (Marketplace host not detected — path check disabled)"}
      </p>

      {environments.length > 0 ? (
        <TransferForm
          environments={environments}
          submitting={submitting}
          onSubmit={startTransfer}
          onValidatePath={
            TRANSFER_MODE === "backend" || mpReady ? validatePath : undefined
          }
        />
      ) : envLoading ? (
        <p>Loading environments…</p>
      ) : (
        !apiError && (
          <p className="hint">
            No environments are available to transfer between. Check that the
            app is configured with at least two environments (and, for the
            SDK-mode path check, that ContentCourier is opened from inside the
            Sitecore Cloud Portal).
          </p>
        )
      )}

      {apiError && <p className="error">{apiError}</p>}

      {jobStatus && (
        <section>
          <h2>
            Transfer <span className={`status ${jobStatus}`}>{jobStatus}</span>
          </h2>
          {jobError && <p className="error">{jobError}</p>}
          <div className="log">
            {jobLog
              .map(
                (entry) =>
                  `${new Date(entry.time).toLocaleTimeString()}  ${entry.message}`,
              )
              .join("\n")}
          </div>
        </section>
      )}
    </main>
  );
}

export default ContentTransferPage;
