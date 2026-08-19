"use client";

import * as React from "react";
import { Button } from "@/components";

// NTF-13: the confirm control on the public unsubscribe page. The POST lives behind a button
// press, never a page load — mail scanners and link-preview crawlers prefetch GET URLs, so a
// GET that applied the change would unsubscribe people who never clicked.
//
// It calls fetch directly rather than lib/api's apiMutate: this page is SIGNED OUT, so there is
// no CSRF cookie for csrfHeaders() to echo, and the endpoint is deliberately token-authenticated
// (see the route comment). Everything else — the uniform envelope, the loading/disabled states —
// follows the house shape.
//
// AUT-05: the server returns one generic envelope for every outcome, so this component has no
// "that link was invalid" branch to render. It cannot: it is never told.

type State = "idle" | "saving" | "done" | "error";

export function UnsubscribeConfirm({ token, event, label }: { token: string; event: string; label: string }) {
  const [state, setState] = React.useState<State>("idle");
  const [message, setMessage] = React.useState<string>("");

  async function submit() {
    setState("saving");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, event }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setMessage(json?.message ?? "Something went wrong. Please try that link again.");
        setState("error");
        return;
      }
      setMessage(json?.message ?? "Those emails are switched off.");
      setState("done");
    } catch {
      setMessage("Something went wrong. Please try that link again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-sm leading-relaxed text-text-2">
        {message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-text-2">{label}</p>
      <div>
        <Button variant="primary" size="lg" loading={state === "saving"} disabled={state === "saving"} onClick={submit}>
          Confirm
        </Button>
      </div>
      {state === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
