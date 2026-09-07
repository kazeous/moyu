"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export function OfflineControl() {
  const [status, setStatus] = useState("Preparing offline workspace…");
  const [online, setOnline] = useState(true);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [update, setUpdate] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const connection = () => setOnline(navigator.onLine);
    const installPrompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const installed = () => setInstall(null);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("beforeinstallprompt", installPrompt);
    window.addEventListener("appinstalled", installed);
    if (process.env.NODE_ENV !== "production")
      setStatus("Offline reload is available in production builds.");
    else if (!("serviceWorker" in navigator))
      setStatus(
        "This browser does not support offline installation. Local review still works while this page is open.",
      );
    else {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then(async (registration) => {
          if (active && registration.waiting) setUpdate(true);
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            installing?.addEventListener("statechange", () => {
              if (!active) return;
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setUpdate(true);
              if (installing.state === "redundant")
                setStatus("Offline preparation failed. Reconnect and retry.");
            });
          });
          await navigator.serviceWorker.ready;
          if (active)
            setStatus(
              "Workspace ready offline. OCR models and dictionaries are available offline after their first successful use or installation.",
            );
        })
        .catch(() => {
          if (active)
            setStatus("Offline preparation failed. Reconnect and retry.");
        });
    }
    return () => {
      active = false;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("beforeinstallprompt", installPrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, [revision]);

  return (
    <Dialog>
      <DialogTrigger
        aria-label={online ? "Install / offline" : "Offline"}
        render={<Button size="sm" variant="ghost" />}
      >
        <Download data-icon="inline-start" aria-hidden="true" />
        <span className="workspace__install-label">
          {online ? "Install / offline" : "Offline"}
        </span>
      </DialogTrigger>
      <DialogContent className="workspace__offline-dialog">
        <DialogHeader>
          <DialogTitle>Use moyu offline</DialogTitle>
          <DialogDescription>{status}</DialogDescription>
        </DialogHeader>
        {!online ? (
          <p>
            Offline. Local review stays available; sign-in and personal-library
            sync need a connection. Unsynced phrase edits remain available to
            retry.
          </p>
        ) : null}
        {update ? (
          <p>
            A new version is ready. Close all moyu tabs and reopen to apply it.
            Your local review remains saved.
          </p>
        ) : null}
        {install ? (
          <Button
            onClick={async () => {
              await install.prompt();
              await install.userChoice;
              setInstall(null);
            }}
          >
            Install moyu
          </Button>
        ) : (
          <p>
            To install, use your browser’s install menu. On iPhone or iPad, use
            Share → Add to Home Screen.
          </p>
        )}
        <p>
          Open the workspace once online before using it offline. This browser
          keeps the review; installation does not sync it to other devices.
        </p>
        <Button
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          Retry offline preparation
        </Button>
      </DialogContent>
    </Dialog>
  );
}
