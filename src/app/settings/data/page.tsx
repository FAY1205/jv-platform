"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Table, THead, TBody, Th, Tr, Td, Badge, Checkbox, Skeleton, EmptyState, useToast } from "@/components";
import { SettingsSection } from "../settings-section";

// WS-7g: Data & Export — export color coding (F-39, wired to the export routes), data
// retention (SET-07, read-only for now), and the recognized file formats (Source Profiles,
// SET-12 — relocated here from Rules).
interface Format {
  id: string;
  name: string;
  version: number;
  columns: number;
  strictness: "flexible" | "strict";
  source: "saved" | "builtin";
}
interface DataSettings {
  colorCoding: boolean;
  retentionDays: number;
  formats: Format[];
}

export default function DataSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error } = useQuery({ queryKey: ["settings-data"], queryFn: () => apiGet<DataSettings>("/api/settings/data") });

  const saveColor = useMutation({
    mutationFn: async (colorCoding: boolean) => {
      const res = await fetch("/api/settings/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ colorCoding }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "Save failed.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-data"] });
      toast("Saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  return (
    <SettingsSection title="Data & Export" description="Export options, retention, and recognized file formats.">
      {error ? (
        <Card><CardBody><EmptyState title="Couldn't load settings" description={(error as Error).message} /></CardBody></Card>
      ) : isPending || !data ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Exports</CardTitle></CardHeader>
            <CardBody>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-text">Color-code partner sections</p>
                  <p className="text-xs text-text-3">Full-row fills per partner in the .xlsx. The partner name + reference ID always appear regardless of color (PRN-14).</p>
                </div>
                <Checkbox checked={data.colorCoding} disabled={saveColor.isPending} onCheckedChange={(v) => saveColor.mutate(v)} ariaLabel="Color-code exports" />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Data retention</CardTitle></CardHeader>
            <CardBody>
              <p className="text-sm text-text-2">
                Original upload files are kept for <span className="num font-semibold">{data.retentionDays}</span> days.
              </p>
              <p className="mt-1 text-xs text-text-3">Editing the retention policy is coming soon.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>File formats</CardTitle></CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-text-3">The upload formats the app recognizes. Download a template to prepare a file with the right columns (ING-05, SET-12).</p>
              {data.formats.length === 0 ? (
                <EmptyState title="No file formats yet" description="Formats are created from the upload flow." />
              ) : (
                <Table>
                  <THead><Tr><Th>Format</Th><Th align="right">Columns</Th><Th>Match</Th><Th align="right">Template</Th></Tr></THead>
                  <TBody>
                    {data.formats.map((fmt) => (
                      <Tr key={fmt.id}>
                        <Td>
                          <span className="text-sm text-text">{fmt.name}</span> <span className="num text-xs text-text-3">v{fmt.version}</span>
                          {fmt.source === "saved" && <Badge variant="success" className="ml-2">saved</Badge>}
                        </Td>
                        <Td align="right"><span className="num text-sm text-text-2">{fmt.columns}</span></Td>
                        <Td><Badge variant={fmt.strictness === "strict" ? "warn" : "neutral"}>{fmt.strictness}</Badge></Td>
                        <Td align="right">
                          <a href={`/api/templates/${fmt.id}`} className="text-xs text-brand hover:underline">↓ Download</a>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </SettingsSection>
  );
}
