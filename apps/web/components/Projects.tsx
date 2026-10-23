"use client";

import { Film } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "../lib/jobs.ts";
import { FOOTAGE_KEPT } from "../lib/retention.ts";
import { formatBytes, formatLength } from "../lib/settings.ts";
import { cn, ICON_FRAME, LIST, META, SLUG } from "../lib/styles.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";

/** Earlier edits, to open again or delete, with the disk space each takes. */
export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT();
  const words = t.projects;
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The project whose Delete was clicked once, asking for a second click.
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch("/api/jobs")
      .then((response) => response.json() as Promise<ProjectSummary[]>)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!deleting) return;
    const timer = setTimeout(() => setDeleting(null), 4000);
    return () => clearTimeout(timer);
  }, [deleting]);

  const remove = async (id: string) => {
    setDeleting(null);
    const response = await fetch(`/api/jobs/${id}/remove`, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? words.notDeleted);
    } else setError(null);
    load();
  };

  const shown = projects?.filter((project) => project.status !== "uploading") ?? [];
  if (shown.length === 0) return null;
  const total = shown.reduce((sum, project) => sum + project.bytes, 0);
  return (
    <section
      className="flex flex-col gap-3 animate-in fade-in-0 duration-500"
      aria-label={words.title}
    >
      <div>
        <h2 className={SLUG}>{words.title}</h2>
        <p className={cn(META, "mt-1")}>
          {words.meta(shown.length, formatBytes(total), FOOTAGE_KEPT)}
        </p>
      </div>
      {error && <ErrorNote message={error} fallback={words.fallback} />}
      <ul className={LIST}>
        {shown.map((project) => (
          <li
            key={project.id}
            className="grid grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] max-sm:grid-cols-[32px_minmax(0,1fr)_auto]"
          >
            <span className={ICON_FRAME}>
              <Film aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col max-sm:col-span-2">
              <span className="truncate text-[13px] font-medium" title={project.name}>
                {project.name || words.untitled}
              </span>
              <span className={META}>
                {t.date(project.created)} ·{" "}
                {project.shorts === undefined
                  ? formatLength(project.length, t)
                  : words.shorts(project.shorts)}{" "}
                · {project.aspect} · {words.status[project.status]} · {formatBytes(project.bytes)}
                {project.status === "done" && !project.footage && words.footageRemoved}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-sm:col-start-2 max-sm:justify-self-start"
              onClick={() => onOpen(project.id)}
            >
              {words.open}
            </Button>
            <Button
              type="button"
              variant={deleting === project.id ? "danger" : "ghost"}
              size="sm"
              disabled={project.status === "running"}
              onClick={() =>
                deleting === project.id ? void remove(project.id) : setDeleting(project.id)
              }
            >
              {deleting === project.id ? words.sure : words.delete}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
